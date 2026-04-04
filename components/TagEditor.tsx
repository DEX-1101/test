import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, Save, X, Image as ImageIcon, Tag, Send, Undo2, Redo2, Crop as CropIcon } from 'lucide-react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  rectSortingStrategy, 
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

interface FileEntry {
  imageHandle: FileSystemFileHandle;
  textHandle?: FileSystemFileHandle;
  name: string;
  baseName: string;
  tags: string[];
}

const Thumbnail = ({ imageHandle, name, urlCache }: { imageHandle: FileSystemFileHandle, name: string, urlCache: React.MutableRefObject<Map<string, string>> }) => {
  const [url, setUrl] = useState<string>(urlCache.current.get(name) || '');
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (url) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        const cached = urlCache.current.get(name);
        if (cached) {
          setUrl(cached);
        } else {
          imageHandle.getFile().then(file => {
            const newUrl = URL.createObjectURL(file);
            urlCache.current.set(name, newUrl);
            setUrl(newUrl);
          });
        }
        observer.disconnect();
      }
    }, { rootMargin: '200px' });

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [imageHandle, name, url, urlCache]);

  return (
    <img 
      ref={imgRef}
      src={url || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
      alt={name} 
      className={`w-full h-full object-cover transition-opacity duration-300 ${url ? 'opacity-100' : 'opacity-0'}`} 
    />
  );
};

const SortableTag = ({ tag, onRemove }: { tag: string, onRemove: (t: string) => void }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tag });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-100 px-3 py-1.5 rounded-2xl text-sm font-medium group transition-colors hover:bg-blue-500/20 cursor-grab active:cursor-grabbing relative ${isDragging ? 'shadow-lg shadow-black/50 scale-105 z-50' : ''}`}
    >
      <span>{tag}</span>
      <button 
        onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking X
        onClick={() => onRemove(tag)}
        className="text-blue-300 hover:text-white opacity-60 group-hover:opacity-100 transition-opacity ml-1 bg-blue-500/20 rounded-full p-0.5"
      >
        <X size={12} />
      </button>
    </div>
  );
};

export const TagEditor: React.FC = () => {
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  
  const [tagState, setTagState] = useState<{
    current: string[];
    history: string[][];
    index: number;
  }>({
    current: [],
    history: [[]],
    index: 0
  });
  const activeTags = tagState.current;

  const [newTag, setNewTag] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [crop, setCrop] = useState<Crop>();
  const [isCropping, setIsCropping] = useState(false);
  const previewImgRef = useRef<HTMLImageElement>(null);
  const urlCache = useRef<Map<string, string>>(new Map());

  const updateTags = (updater: string[] | ((prev: string[]) => string[])) => {
    setTagState(prev => {
      const resolvedTags = typeof updater === 'function' ? updater(prev.current) : updater;
      if (JSON.stringify(resolvedTags) === JSON.stringify(prev.current)) {
        return prev;
      }
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(resolvedTags);
      return {
        current: resolvedTags,
        history: newHistory,
        index: newHistory.length - 1
      };
    });
  };

  const handleUndo = () => {
    setTagState(prev => {
      if (prev.index > 0) {
        const newIndex = prev.index - 1;
        return { ...prev, current: prev.history[newIndex], index: newIndex };
      }
      return prev;
    });
  };

  const handleRedo = () => {
    setTagState(prev => {
      if (prev.index < prev.history.length - 1) {
        const newIndex = prev.index + 1;
        return { ...prev, current: prev.history[newIndex], index: newIndex };
      }
      return prev;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      urlCache.current.forEach(url => URL.revokeObjectURL(url));
      urlCache.current.clear();
    };
  }, []);

  const currentImageHandle = files[selectedIndex]?.imageHandle;
  useEffect(() => {
    if (currentImageHandle) {
      const name = currentImageHandle.name;
      const cached = urlCache.current.get(name);
      if (cached) {
        setPreviewUrl(cached);
      } else {
        currentImageHandle.getFile().then(file => {
          const objectUrl = URL.createObjectURL(file);
          urlCache.current.set(name, objectUrl);
          if (files[selectedIndex]?.name === name) {
            setPreviewUrl(objectUrl);
          }
        });
      }
    } else {
      setPreviewUrl('');
    }
  }, [currentImageHandle, selectedIndex, files]);

  // Preload adjacent images for instant switching
  useEffect(() => {
    if (selectedIndex === -1) return;
    
    const preloadIndex = async (idx: number) => {
      if (idx >= 0 && idx < files.length) {
        const handle = files[idx].imageHandle;
        const name = handle.name;
        if (!urlCache.current.has(name)) {
          try {
            const file = await handle.getFile();
            urlCache.current.set(name, URL.createObjectURL(file));
          } catch (e) {
            // ignore
          }
        }
      }
    };

    preloadIndex(selectedIndex + 1);
    preloadIndex(selectedIndex - 1);
  }, [selectedIndex, files]);

  const handleOpenFolder = async () => {
    try {
      // @ts-ignore - File System Access API
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      
      // Clear cache when opening a new folder
      urlCache.current.forEach(url => URL.revokeObjectURL(url));
      urlCache.current.clear();
      
      setDirectoryHandle(dirHandle);
      await loadFiles(dirHandle);
    } catch (err) {
      console.error(err);
    }
  };

  const loadFiles = async (dirHandle: any) => {
    const entries: any[] = [];
    for await (const entry of dirHandle.values()) {
      entries.push(entry);
    }

    const imageEntries = entries.filter((e: any) => e.kind === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(e.name));
    const textEntries = entries.filter((e: any) => e.kind === 'file' && /\.txt$/i.test(e.name));

    const fileList: FileEntry[] = imageEntries.map((imgHandle: any) => {
      const baseName = imgHandle.name.substring(0, imgHandle.name.lastIndexOf('.'));
      const txtHandle = textEntries.find((t: any) => t.name === `${baseName}.txt`);
      return {
        imageHandle: imgHandle,
        textHandle: txtHandle,
        name: imgHandle.name,
        baseName,
        tags: []
      };
    });

    // Load tags concurrently
    await Promise.all(fileList.map(async (file) => {
      if (file.textHandle) {
        try {
          const txtFile = await file.textHandle.getFile();
          const text = await txtFile.text();
          file.tags = text.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
        } catch (e) {
          console.error("Error reading tags for", file.name, e);
        }
      }
    }));

    setFiles(fileList);
    if (fileList.length > 0) {
      setSelectedIndex(0);
      setTagState({
        current: fileList[0].tags,
        history: [fileList[0].tags],
        index: 0
      });
    }
  };

  const getCroppedImg = async (image: HTMLImageElement, crop: Crop): Promise<Blob | null> => {
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    ctx.drawImage(
      image,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width,
      crop.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 1);
    });
  };

  const handleSave = async () => {
    if (selectedIndex === -1 || !directoryHandle) return;
    setSaveStatus('saving');
    try {
      const currentFile = files[selectedIndex];
      let txtHandle = currentFile.textHandle;
      
      if (!txtHandle) {
        // @ts-ignore
        txtHandle = await directoryHandle.getFileHandle(`${currentFile.baseName}.txt`, { create: true });
      }

      // @ts-ignore
      const writable = await txtHandle.createWritable();
      await writable.write(activeTags.join(', '));
      await writable.close();

      // Save Crop if exists
      if (crop && crop.width > 0 && crop.height > 0 && previewImgRef.current) {
        const croppedBlob = await getCroppedImg(previewImgRef.current, crop);
        if (croppedBlob) {
          // @ts-ignore
          const writableImg = await currentFile.imageHandle.createWritable();
          await writableImg.write(croppedBlob);
          await writableImg.close();
          
          // Update preview URL to reflect new crop
          const newObjectUrl = URL.createObjectURL(croppedBlob);
          urlCache.current.set(currentFile.name, newObjectUrl);
          setPreviewUrl(newObjectUrl);
          setCrop(undefined); // reset crop
          setIsCropping(false);
        }
      }

      // Update state to reflect that it now has a text handle and updated tags
      setFiles(prev => {
        const newFiles = [...prev];
        newFiles[selectedIndex] = { ...newFiles[selectedIndex], textHandle: txtHandle, tags: activeTags };
        return newFiles;
      });
      
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      alert('Failed to save.');
      setSaveStatus('idle');
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTag.trim()) {
      const tagsToAdd = newTag.split(',').map(t => t.trim()).filter(t => t.length > 0);
      updateTags(prev => {
        const newTags = [...prev, ...tagsToAdd.filter(t => !prev.includes(t))];
        return newTags;
      });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    updateTags(prev => prev.filter(t => t !== tagToRemove));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts, allows clicking buttons
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      updateTags((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className="w-full h-full flex flex-row overflow-hidden bg-[#09090b]">
      {/* Sidebar (Left) */}
      <div className="w-[300px] flex flex-col bg-black/40 border-r border-white/5 shrink-0 overflow-hidden z-10">
        <div className="p-4 border-b border-white/5">
          <button 
            onClick={handleOpenFolder}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white py-2.5 px-4 rounded-xl transition-colors font-medium text-sm border border-white/10"
          >
            <FolderOpen size={16} />
            Open Folder
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <div className="grid grid-cols-3 gap-2">
            {files.map((file, idx) => (
              <div 
                key={file.name}
                onClick={() => {
                  setSelectedIndex(idx);
                  setTagState({
                    current: file.tags,
                    history: [file.tags],
                    index: 0
                  });
                }}
                className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 ${idx === selectedIndex ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.3)] z-10 scale-105' : 'border-transparent hover:border-white/30'}`}
              >
                <Thumbnail imageHandle={file.imageHandle} name={file.name} urlCache={urlCache} />
                <div className="absolute bottom-1 right-1 bg-black/80 backdrop-blur-sm text-[10px] px-1.5 py-0.5 rounded text-white font-medium border border-white/10">
                  {file.tags.length}
                </div>
              </div>
            ))}
          </div>
          {files.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 opacity-50">
              <ImageIcon size={48} strokeWidth={1} />
              <p className="text-sm text-center px-4">Select a folder to load images and tags.</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Fullscreen Image & Overlay */}
      <div className="flex-1 relative overflow-hidden bg-black/90 flex items-center justify-center">
        {selectedIndex !== -1 ? (
          <>
            {/* Fullscreen Zoomable/Pannable Image */}
            <TransformWrapper disabled={isCropping} centerOnInit minScale={0.1} maxScale={10} wheel={{ step: 0.1 }}>
              <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isCropping ? (
                  <ReactCrop crop={crop} onChange={c => setCrop(c)} className="max-w-full max-h-full flex items-center justify-center">
                    <img 
                      ref={previewImgRef}
                      src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                      alt={files[selectedIndex].name}
                      className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
                    />
                  </ReactCrop>
                ) : (
                  <img 
                    ref={previewImgRef}
                    src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                    alt={files[selectedIndex].name}
                    className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
                  />
                )}
              </TransformComponent>
            </TransformWrapper>

            {/* Floating Tag Editor Overlay (Centered Landscape) */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[800px] max-w-[95vw] max-h-[85%] flex flex-col bg-black/60 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl z-50 overflow-hidden">
               
               {/* Tags Area (Top) */}
               <div className="p-5 min-h-[120px] max-h-[30vh] overflow-y-auto custom-scrollbar">
                 <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                   <SortableContext items={activeTags} strategy={rectSortingStrategy}>
                     <div className="flex flex-wrap gap-2 content-start">
                       {activeTags.map((tag) => (
                         <SortableTag key={tag} tag={tag} onRemove={handleRemoveTag} />
                       ))}
                       {activeTags.length === 0 && (
                         <div className="w-full text-left text-zinc-400 text-sm italic p-2">
                           No tags yet. Type below to add!
                         </div>
                       )}
                     </div>
                   </SortableContext>
                 </DndContext>
               </div>

               {/* Bottom Control Bar */}
               <div className="flex items-center justify-between p-3 bg-black/40 border-t border-white/10 gap-4">
                  {/* Left: Other Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={handleUndo} 
                      disabled={tagState.index <= 0} 
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white disabled:opacity-30 transition-colors"
                      title="Undo (Ctrl+Z)"
                    >
                      <Undo2 size={18}/>
                    </button>
                    <button 
                      onClick={handleRedo} 
                      disabled={tagState.index >= tagState.history.length - 1} 
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white disabled:opacity-30 transition-colors"
                      title="Redo (Ctrl+Shift+Z)"
                    >
                      <Redo2 size={18}/>
                    </button>
                    <button 
                      onClick={() => setIsCropping(!isCropping)} 
                      className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${isCropping ? 'bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                    >
                      <CropIcon size={16}/> {isCropping ? 'Cancel Crop' : 'Crop'}
                    </button>
                  </div>

                  {/* Right: Input & Save */}
                  <div className="flex items-center gap-2 flex-1">
                    <input 
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={handleAddTag}
                      placeholder="Add tags (comma separated)..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
                    />
                    <button 
                      onClick={handleSave}
                      disabled={saveStatus === 'saving'}
                      className="shrink-0 px-6 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                    >
                      {saveStatus === 'saving' ? (
                        <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      ) : saveStatus === 'saved' ? (
                        <Save size={16} />
                      ) : (
                        <Save size={16} />
                      )}
                      {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}
                    </button>
                  </div>
               </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-500 gap-4">
            <ImageIcon size={64} strokeWidth={1} className="opacity-50" />
            <p>Select an image from the sidebar</p>
          </div>
        )}
      </div>
    </div>
  );
};
