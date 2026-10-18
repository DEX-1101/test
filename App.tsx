
import React, { useState, useRef, useEffect } from 'react';
import { ImageUploader } from './components/ImageUploader';
import { CollageDisplay } from './components/CollageDisplay';
import { MosaicEditor } from './components/MosaicEditor';
import { TagEditor } from './components/TagEditor';
import { UpscaleEditor } from './components/UpscaleEditor';
import { GifMaker } from './components/GifMaker';
import { generateCollageLayout, generateBackgroundTexture, detectFaceCenters } from './services/geminiService';
import { saveMixerState, loadMixerState } from './services/mixerStorage';
import { ImageItem, CollageLayout, AppStatus, LogEntry, AspectRatio, WatermarkSettings, GlobalBlurSettings } from './types';
import { AlertCircle, Layers, Grid2X2, Loader2, Tag, Maximize, Search, Film, UserCircle } from 'lucide-react';
import { DanbooruSearch } from './components/DanbooruSearch';
import { PixivSearch } from './components/PixivSearch';
import { AdetailerEditor } from './components/AdetailerEditor';

const MAX_IMAGES = 6;

type AppMode = 'MIX' | 'MOSAIC' | 'TAGS' | 'UPSCALE' | 'DANBOORU_SEARCH' | 'PIXIV_SEARCH' | 'GIF' | 'ADETAILER';

type NavItem = { id: AppMode; label: string; desc: string; Icon: React.ComponentType<{ size?: number }> };
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Create', items: [
    { id: 'MIX', label: 'Mix', desc: 'Blend up to 6 images into an AI-designed collage.', Icon: Layers },
    { id: 'MOSAIC', label: 'Mosaic', desc: 'Compose custom image grids and mosaics.', Icon: Grid2X2 },
    { id: 'GIF', label: 'GIF', desc: 'Turn frames and clips into animated GIFs.', Icon: Film },
  ]},
  { title: 'Edit', items: [
    { id: 'TAGS', label: 'Tag Editor', desc: 'Auto-tag, edit and inpaint your dataset images.', Icon: Tag },
    { id: 'UPSCALE', label: 'Upscale', desc: 'Enlarge images with on-device or cloud upscalers.', Icon: Maximize },
    { id: 'ADETAILER', label: 'ADetailer', desc: 'Detail and fix faces with prompts and masks.', Icon: UserCircle },
  ]},
  { title: 'Discover', items: [
    { id: 'DANBOORU_SEARCH', label: 'Danbooru Search', desc: 'Search posts and tags on Danbooru.', Icon: Search },
    { id: 'PIXIV_SEARCH', label: 'Pixiv', desc: 'Browse illustrations from Pixiv.', Icon: Search },
  ]},
];
const ALL_NAV = NAV_GROUPS.flatMap(g => g.items);

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
    const minLoadTime = new Promise(resolve => setTimeout(resolve, 2500)); // Smooth 2.5s splash
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
  }, [images, layout, backgroundUrl, showBorders, labelScale, aspectRatio, watermark, globalBlur]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    setLogs(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timeString,
        message,
        type
    }]);
  };

  const handleAddImages = (files: File[]) => {
    const newImages = files.slice(0, MAX_IMAGES - images.length).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      file
    }));
    setImages(prev => [...prev, ...newImages]);
    if (files.length > 0) {
        addLog(`Buffered ${files.length} new image(s).`, 'info');
    }
  };

  const handleRemoveImage = (id: string) => {
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
        abortControllerRef.current = null;
    }
  };

  const isBusy = status === AppStatus.ANALYZING_FACES || status === AppStatus.GENERATING_LAYOUT || status === AppStatus.GENERATING_BACKGROUND;

  const current = ALL_NAV.find(n => n.id === mode)!;
  const isFixed = mode === 'MOSAIC' || mode === 'TAGS' || mode === 'UPSCALE';

  return (
    <div className="h-screen w-full flex bg-background text-white selection:bg-accent selection:text-black overflow-hidden">

      {/* --- SPLASH SCREEN --- */}
      <div
        className={`fixed inset-0 z-[9999] bg-[#0a0a0f] flex flex-col items-center justify-center transition-all duration-700 ${isAppLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
          <div className="flex flex-col items-center gap-5">
              <div className="splash-ring animate-win-spin" />
              <p className="text-sm text-zinc-400">Loading workspace…</p>
          </div>
      </div>

      {/* --- SIDEBAR --- */}
      <aside className="app-sidebar hidden md:flex md:w-[68px] lg:w-64 shrink-0 flex-col px-3 py-4 overflow-y-auto">
          <div className="flex items-center gap-3 px-2 pb-2">
              <img src="https://raw.githubusercontent.com/DEX-1101/SecretNAI/refs/heads/main/avatar.png" alt="" className="w-8 h-8 rounded-lg" />
              <div className="hidden lg:block leading-tight">
                  <div className="text-sm font-semibold">x1101</div>
                  <div className="text-[11px] text-zinc-500">Workspace</div>
              </div>
          </div>
          <nav className="flex flex-col">
              {NAV_GROUPS.map(group => (
                  <div key={group.title}>
                      <div className="nav-label hidden lg:block">{group.title}</div>
                      <div className="h-3 lg:hidden" />
                      <div className="flex flex-col gap-0.5">
                          {group.items.map(({ id, label, Icon }) => (
                              <button
                                  key={id}
                                  onClick={() => setMode(id)}
                                  aria-current={mode === id ? 'page' : undefined}
                                  title={label}
                                  className="nav-item md:justify-center lg:justify-start"
                              >
                                  <Icon size={18} />
                                  <span className="hidden lg:inline">{label}</span>
                              </button>
                          ))}
                      </div>
                  </div>
              ))}
          </nav>
      </aside>

      {/* --- MAIN COLUMN --- */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Mobile tab strip */}
        <div className="md:hidden flex gap-1 overflow-x-auto no-scrollbar p-2 border-b border-white/10 shrink-0">
            {ALL_NAV.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setMode(id)} aria-current={mode === id ? 'page' : undefined} className="nav-item !w-auto whitespace-nowrap">
                    <Icon size={16} /> {label}
                </button>
            ))}
        </div>

        {/* Page header */}
        <header className="page-head shrink-0 px-6 lg:px-10 pt-6 pb-4">
            <h1>{current.label}</h1>
            <p>{current.desc}</p>
        </header>

        {/* Scrollable page body */}
        <main className={`flex-1 min-h-0 px-6 lg:px-10 pb-6 ${isFixed ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className={`w-full flex flex-col gap-6 ${isFixed ? 'h-full' : 'min-h-full'} max-w-[1600px] mx-auto`}>
        
        {/* MIX MODE */}
        <div className={`w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'MIX' ? 'block' : 'hidden'}`}>
            <CollageDisplay 
                layout={layout} 
                images={images} 
                backgroundUrl={backgroundUrl}
                showBorders={showBorders}
                labelScale={labelScale}
                aspectRatio={aspectRatio}
                onLayoutUpdate={setLayout}
                watermark={watermark}
                onWatermarkUpdate={setWatermark}
                globalBlur={globalBlur}
            />

            {/* Error Message */}
            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex gap-3 items-start shadow-lg backdrop-blur-md">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <h3 className="text-red-400 text-sm font-semibold mb-1">Generation Interrupted</h3>
                        <p className="text-red-200/90 text-sm leading-relaxed break-words">
                            {error}
                        </p>
                    </div>
                </div>
            )}

            {/* Unified Inputs & Actions Panel */}
            <div className="w-full bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-6">
                <ImageUploader 
                    images={images} 
                    onAddImages={handleAddImages} 
                    onRemoveImage={handleRemoveImage}
                    onClear={handleClearMix}
                    maxImages={MAX_IMAGES}
                    logs={logs}
                    status={status}
                    onGenerate={handleMix}
                    onCancel={handleCancel}
                    // Visual Props
                    aspectRatio={aspectRatio}
                    onAspectRatioChange={setAspectRatio}
                    showBorders={showBorders}
                    onToggleBorders={() => setShowBorders(prev => !prev)}
                    labelScale={labelScale}
                    onAdjustLabelScale={adjustLabelScale}
                    isBusy={isBusy}
                    watermark={watermark}
                    onWatermarkChange={setWatermark}
                    globalBlur={globalBlur}
                    onGlobalBlurChange={setGlobalBlur}
                />
            </div>
        </div>

        {/* MOSAIC MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'MOSAIC' ? 'block' : 'hidden'}`}>
            <MosaicEditor />
        </div>

        {/* TAGS MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'TAGS' ? 'block' : 'hidden'}`}>
            <TagEditor />
        </div>

        {/* UPSCALE MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'UPSCALE' ? 'block' : 'hidden'}`}>
            <UpscaleEditor />
        </div>

        {/* GIF MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'GIF' ? 'block' : 'hidden'}`}>
            <GifMaker />
        </div>

        {/* DANBOORU SEARCH MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'DANBOORU_SEARCH' ? 'block' : 'hidden'}`}>
            <DanbooruSearch />
        </div>

        {/* PIXIV SEARCH MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'PIXIV_SEARCH' ? 'block' : 'hidden'}`}>
            <PixivSearch />
        </div>

        {/* ADETAILER MODE */}
        <div className={`w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${mode === 'ADETAILER' ? 'block' : 'hidden'}`}>
            <AdetailerEditor />
        </div>

      </div>
        </main>
      </div>
    </div>
  );
};

export default App;
