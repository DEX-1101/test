
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageUploader } from './components/ImageUploader';
import { CollageDisplay } from './components/CollageDisplay';
import { MosaicEditor } from './components/MosaicEditor';
import { TagEditor } from './components/TagEditor';
import { UpscaleEditor } from './components/UpscaleEditor';
import { GifMaker } from './components/GifMaker';
import { generateCollageLayout, generateBackgroundTexture, detectFaceCenters } from './services/geminiService';
import { saveMixerState, loadMixerState } from './services/mixerStorage';
import { ImageItem, CollageLayout, AppStatus, LogEntry, AspectRatio, WatermarkSettings, GlobalBlurSettings } from './types';
import { AlertCircle, Layers, Grid2X2, Loader2, Tag, Maximize, Minimize, Search, Film, UserCircle, PanelLeft } from 'lucide-react';
import { DanbooruSearch } from './components/DanbooruSearch';
import { PixivSearch } from './components/PixivSearch';
import { AdetailerEditor } from './components/AdetailerEditor';

const MAX_IMAGES = 6;

type AppMode = 'MIX' | 'MOSAIC' | 'TAGS' | 'UPSCALE' | 'DANBOORU_SEARCH' | 'PIXIV_SEARCH' | 'GIF' | 'ADETAILER';

// Panes stay mounted (so every editor keeps its state) and only fade in when shown.
// Defined at module level so React never remounts the children between renders.
const Pane: React.FC<{ active: boolean; fixed?: boolean; children: React.ReactNode }> = ({ active, fixed, children }) => (
  <motion.section
    initial={false}
    animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 14, transition: { duration: 0 } }}
    transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.8 }}
    style={{ display: active ? 'block' : 'none' }}
    className={`w-full ${fixed ? 'h-full' : 'min-h-full'}`}
    aria-hidden={!active}
  >
    {children}
  </motion.section>
);

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('MIX');
  
  // --- LOADING STATE ---
  const [isAppLoading, setIsAppLoading] = useState(true);

  // --- MIXER STATE ---
  const [images, setImages] = useState<ImageItem[]>([]);
  const [layout, setLayout] = useState<CollageLayout | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [showBorders, setShowBorders] = useState<boolean>(true);
  const [labelScale, setLabelScale] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("3:2");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Visual Settings
  const [watermark, setWatermark] = useState<WatermarkSettings>({
      enabled: false,
      text: '',
      icon: 'none',
      x: 50,
      y: 50,
      opacity: 0.8,
      size: 1,
      iconScale: 1
  });

  const [globalBlur, setGlobalBlur] = useState<GlobalBlurSettings>({
      enabled: false,
      amount: 8
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // Persistence: Load
  useEffect(() => {
    const minLoadTime = new Promise(resolve => setTimeout(resolve, 1200)); // short splash
    const dataLoad = loadMixerState();

    Promise.all([dataLoad, minLoadTime]).then(([data]) => {
        if (data.images.length > 0) setImages(data.images);
        if (data.state) {
            setLayout(data.state.layout);
            setBackgroundUrl(data.state.backgroundUrl);
            setShowBorders(data.state.showBorders);
            setLabelScale(data.state.labelScale);
            setAspectRatio(data.state.aspectRatio);
            // Merge settings to ensure new properties exist if loading old state
            setWatermark(prev => ({ ...prev, ...data.state.watermark }));
            if (data.state.globalBlur) {
                setGlobalBlur(data.state.globalBlur);
            }
        }
        setIsAppLoading(false);
    });
  }, []);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const originalTitleRef = useRef(document.title);
  useEffect(() => {
    if (status === AppStatus.ANALYZING_FACES) {
      document.title = "Analyzing Faces...";
    } else if (status === AppStatus.GENERATING_LAYOUT) {
      document.title = "Generating Layout...";
    } else if (status === AppStatus.GENERATING_BACKGROUND) {
      document.title = "Generating Background...";
    } else {
      document.title = originalTitleRef.current;
    }
    return () => {
      document.title = originalTitleRef.current;
    };
  }, [status]);

  // Persistence: Save (Debounced)
  useEffect(() => {
    if (isAppLoading) return;
    const t = setTimeout(() => {
        saveMixerState(images, {
            layout,
            backgroundUrl,
            showBorders,
            labelScale,
            aspectRatio,
            watermark,
            globalBlur
        });
    }, 1000);
    return () => clearTimeout(t);
  }, [isAppLoading, images, layout, backgroundUrl, showBorders, labelScale, aspectRatio, watermark, globalBlur]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    setLogs(prev => [...prev.slice(-299), {
        id: Math.random().toString(36).slice(2, 11),
        timestamp: timeString,
        message,
        type
    }]);
  };

  const handleAddImages = (files: File[]) => {
    const room = Math.max(0, MAX_IMAGES - images.length);
    const newImages = files.slice(0, room).map(file => ({
      id: Math.random().toString(36).slice(2, 11),
      url: URL.createObjectURL(file),
      file
    }));
    if (newImages.length === 0) {
        if (files.length > 0) addLog(`Buffer full (max ${MAX_IMAGES} images).`, 'warning');
        return;
    }
    setImages(prev => [...prev, ...newImages].slice(0, MAX_IMAGES));
    addLog(`Buffered ${newImages.length} new image(s).`, 'info');
  };

  const handleRemoveImage = (id: string) => {
    const target = images.find(img => img.id === id);
    if (target) URL.revokeObjectURL(target.url);
    setImages(prev => prev.filter(img => img.id !== id));
    addLog(`Image removed from buffer.`, 'warning');
  };

  const handleClearMix = () => {
    // Abort pending requests if clearing
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }

    // Cleanup memory
    images.forEach(img => URL.revokeObjectURL(img.url));

    setImages([]);
    setLayout(null);
    setBackgroundUrl(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    setLogs([]);
    addLog("Workspace cleared.", 'info');
  };

  const adjustLabelScale = (delta: number) => {
    setLabelScale(prev => {
        const newVal = Math.max(0.5, Math.min(2.0, prev + delta));
        return parseFloat(newVal.toFixed(1));
    });
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setStatus(AppStatus.IDLE);
    addLog("Generation sequence cancelled by user.", 'warning');
  };

  const handleMix = async () => {
    if (images.length === 0) return;
    
    // Setup cancellation
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setError(null);
    setLayout(null);
    setBackgroundUrl(null);
    setLogs(prev => []); 
    addLog("Initializing sequence...", 'info');

    try {
      // 1. Analyze Images for Faces (Gemini Vision)
      if (signal.aborted) throw new Error("Cancelled");
      setStatus(AppStatus.ANALYZING_FACES);
      
      const startTime = performance.now();
      const faceData = await detectFaceCenters(images, (msg) => addLog(msg, 'info'));
      
      if (signal.aborted) throw new Error("Cancelled");
      const visionTime = ((performance.now() - startTime) / 1000).toFixed(2);
      addLog(`Subjects identified in ${visionTime}s.`, 'success');
      
      // Update images with focus points
      const updatedImages = images.map((img, i) => {
        const face = faceData.find(f => f.index === i);
        return face ? { ...img, focusPoint: { x: face.x, y: face.y } } : img;
      });
      setImages(updatedImages);

      // 2. Generate Layout Logic (Gemini 3 Flash)
      if (signal.aborted) throw new Error("Cancelled");
      setStatus(AppStatus.GENERATING_LAYOUT);
      
      const layoutStart = performance.now();
      // Pass a throttled logger for high-frequency stream updates if needed, or just raw
      const layoutData = await generateCollageLayout(images.length, aspectRatio, (msg) => addLog(msg, 'info'));
      
      if (signal.aborted) throw new Error("Cancelled");
      const layoutTime = ((performance.now() - layoutStart) / 1000).toFixed(2);
      addLog(`Topology generated with ${layoutData.regions.length} regions (${layoutTime}s).`, 'success');
      
      setLayout(layoutData);
      
      // 3. Generate Background (Nano Banana / Gemini 2.5 Flash Image)
      if (signal.aborted) throw new Error("Cancelled");
      setStatus(AppStatus.GENERATING_BACKGROUND);
      
      const bgStart = performance.now();
      const bg = await generateBackgroundTexture((msg) => addLog(msg, 'info'));
      
      if (signal.aborted) throw new Error("Cancelled");
      const bgTime = ((performance.now() - bgStart) / 1000).toFixed(2);
      
      if (bg) {
        addLog(`Background synthesis complete (${bgTime}s).`, 'success');
        setBackgroundUrl(bg);
      } else {
        addLog(`Background generation skipped.`, 'warning');
      }

      setStatus(AppStatus.READY);
      addLog(`Mix sequence completed successfully.`, 'success');

    } catch (err: any) {
      if (err.message === "Cancelled") {
         return; // Silent exit
      }
      console.error(err);
      
      const detailedError = err instanceof Error ? err.message : String(err);
      setError(detailedError);
      
      addLog(detailedError, 'error');
      setStatus(AppStatus.ERROR);
    } finally {
        // Only clear if a newer run hasn't replaced our controller
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  };

  const isBusy = status === AppStatus.ANALYZING_FACES || status === AppStatus.GENERATING_LAYOUT || status === AppStatus.GENERATING_BACKGROUND;

  // --- SHELL STATE ---
  const [navOpen, setNavOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const NAV: { id: AppMode; label: string; icon: React.ElementType; fixed?: boolean }[] = [
    { id: 'MIX', label: 'Mix', icon: Layers },
    { id: 'MOSAIC', label: 'Mosaic', icon: Grid2X2, fixed: true },
    { id: 'TAGS', label: 'Tag Editor', icon: Tag, fixed: true },
    { id: 'UPSCALE', label: 'Upscale', icon: Maximize, fixed: true },
    { id: 'GIF', label: 'GIF Maker', icon: Film },
    { id: 'DANBOORU_SEARCH', label: 'Danbooru', icon: Search },
    { id: 'PIXIV_SEARCH', label: 'Pixiv', icon: Search },
    { id: 'ADETAILER', label: 'ADetailer', icon: UserCircle },
  ];
  const current = NAV.find(n => n.id === mode)!;

  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col text-white bg-[#1c1c1c] relative">
      {/* Mica-style backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-70"
           style={{ background: 'radial-gradient(900px 500px at 8% 0%, rgba(96,205,255,.10), transparent 60%), radial-gradient(700px 500px at 100% 100%, rgba(139,92,246,.09), transparent 60%)' }} />

      {/* --- SPLASH --- */}
      <AnimatePresence>
        {isAppLoading && (
          <motion.div
            key="splash"
            className="fixed inset-0 z-[9999] bg-[#1c1c1c] flex flex-col items-center justify-center gap-8"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.04, filter: 'blur(12px)' }}
            transition={{ duration: 0.6, ease }}
          >
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.7, ease }}
              className="w-16 h-16 rounded-2xl grid place-items-center bg-gradient-to-br from-[#60cdff] to-[#0067c0] shadow-[0_0_60px_rgba(96,205,255,.35)]">
              <Layers size={30} className="text-white" />
            </motion.div>
            <div className="flex flex-col items-center gap-3">
              <div className="text-sm font-semibold tracking-wide text-white/90">x1101 Workspace</div>
              <div className="relative w-40 h-[3px] rounded-full bg-white/10 overflow-hidden">
                <motion.div className="absolute inset-y-0 w-1/3 rounded-full bg-[#60cdff]"
                  animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- TITLE BAR --- */}
      <header className="relative z-20 h-11 shrink-0 flex items-center gap-3 px-3 border-b border-white/[0.06] bg-[#202020]/70 backdrop-blur-xl">
        <button onClick={() => setNavOpen(o => !o)} title="Toggle navigation"
          className="w-8 h-8 grid place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
          <PanelLeft size={16} />
        </button>
        <div className="flex items-center gap-2 text-[13px] text-white/80">
          <span className="w-4 h-4 rounded bg-gradient-to-br from-[#60cdff] to-[#0067c0] grid place-items-center"><Layers size={10} /></span>
          <span className="font-medium">x1101</span>
          <span className="text-white/30">/</span>
          <AnimatePresence mode="wait">
            <motion.span key={mode} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: 0.18 }} className="text-white/60">
              {current.label}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="flex-1" />
        <AnimatePresence>
          {isBusy && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => setMode('MIX')}
              className="flex items-center gap-2 h-7 px-3 rounded-full bg-[#60cdff]/10 border border-[#60cdff]/30 text-[12px] text-[#60cdff]">
              <Loader2 size={12} className="animate-spin" />
              {status === AppStatus.ANALYZING_FACES ? 'Analyzing faces' : status === AppStatus.GENERATING_LAYOUT ? 'Generating layout' : 'Generating background'}
            </motion.button>
          )}
        </AnimatePresence>
        <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          className="w-8 h-8 grid place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
      </header>

      <div className="relative z-10 flex-1 min-h-0 flex">
        {/* --- NAVIGATION PANE --- */}
        <motion.nav
          initial={false}
          animate={{ width: navOpen ? 208 : 52 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="shrink-0 h-full flex flex-col gap-1 p-1.5 overflow-hidden"
        >
          {NAV.map(item => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button key={item.id} onClick={() => setMode(item.id)} title={item.label}
                className={`relative h-10 shrink-0 flex items-center gap-3 px-3 rounded-md text-[13px] whitespace-nowrap ${active ? 'text-white' : 'text-white/65 hover:text-white hover:bg-white/[0.06]'}`}>
                {active && (
                  <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-white/[0.09]"
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[#60cdff]" />
                  </motion.span>
                )}
                <span className="relative shrink-0">
                  {item.id === 'MIX' && isBusy ? <Loader2 size={17} className="animate-spin text-[#60cdff]" /> : <Icon size={17} />}
                </span>
                <motion.span className="relative" animate={{ opacity: navOpen ? 1 : 0 }} transition={{ duration: 0.15 }}>{item.label}</motion.span>
              </button>
            );
          })}
        </motion.nav>

        {/* --- CONTENT --- */}
        <main className="flex-1 min-w-0 h-full pr-2 pb-2">
          <div className={`h-full rounded-xl border border-white/[0.07] bg-[#272727]/55 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,.3)] ${current.fixed ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
            <div className={`${current.fixed ? 'h-full' : 'min-h-full'} p-4 md:p-6`}>

              <Pane active={mode === 'MIX'}>
                <div className="w-full max-w-6xl mx-auto space-y-6">
                  <CollageDisplay
                    layout={layout} images={images} backgroundUrl={backgroundUrl}
                    showBorders={showBorders} labelScale={labelScale} aspectRatio={aspectRatio}
                    onLayoutUpdate={setLayout} watermark={watermark} onWatermarkUpdate={setWatermark} globalBlur={globalBlur}
                  />

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="p-4 bg-red-500/10 border border-red-500/25 rounded-xl flex gap-3 items-start overflow-hidden"
                      >
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-red-400 text-xs font-semibold uppercase mb-1 tracking-wider">Generation Interrupted</h3>
                          <p className="text-red-200/90 text-sm leading-relaxed break-words selectable">{error}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="w-full bg-white/5 border border-white/10 rounded-xl p-5 md:p-6">
                    <ImageUploader
                      images={images} onAddImages={handleAddImages} onRemoveImage={handleRemoveImage} onClear={handleClearMix}
                      maxImages={MAX_IMAGES} logs={logs} status={status} onGenerate={handleMix} onCancel={handleCancel}
                      aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio}
                      showBorders={showBorders} onToggleBorders={() => setShowBorders(prev => !prev)}
                      labelScale={labelScale} onAdjustLabelScale={adjustLabelScale} isBusy={isBusy}
                      watermark={watermark} onWatermarkChange={setWatermark}
                      globalBlur={globalBlur} onGlobalBlurChange={setGlobalBlur}
                    />
                  </div>
                </div>
              </Pane>

              <Pane active={mode === 'MOSAIC'} fixed><MosaicEditor /></Pane>
              <Pane active={mode === 'TAGS'} fixed><TagEditor /></Pane>
              <Pane active={mode === 'UPSCALE'} fixed><UpscaleEditor /></Pane>
              <Pane active={mode === 'GIF'}><GifMaker /></Pane>
              <Pane active={mode === 'DANBOORU_SEARCH'}><DanbooruSearch /></Pane>
              <Pane active={mode === 'PIXIV_SEARCH'}><PixivSearch /></Pane>
              <Pane active={mode === 'ADETAILER'}><AdetailerEditor /></Pane>

            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
