import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, Save, X, Image as ImageIcon, Tag } from 'lucide-react';
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
      className={`flex items-center gap-1.5 bg-[#2a2d45] border border-[#3a3d55] text-[#d0d2e6] px-3 py-1.5 rounded-md text-sm font-medium group transition-colors hover:bg-[#323652] cursor-grab active:cursor-grabbing relative ${isDragging ? 'shadow-lg shadow-black/50 scale-105' : ''}`}
    >
      <span>{tag}</span>
      <button 
        onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking X
        onClick={() => onRemove(tag)}
        className="text-zinc-400 hover:text-white opacity-60 group-hover:opacity-100 transition-opacity ml-1"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export const TagEditor: React.FC = () => {
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const urlCache = useRef<Map<string, string>>(new Map());

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
      setActiveTags(fileList[0].tags);
    }
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
      alert('Failed to save tags.');
      setSaveStatus('idle');
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTag.trim()) {
      const tagsToAdd = newTag.split(',').map(t => t.trim()).filter(t => t.length > 0);
      setActiveTags(prev => {
        const newTags = [...prev, ...tagsToAdd.filter(t => !prev.includes(t))];
        return newTags;
      });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setActiveTags(prev => prev.filter(t => t !== tagToRemove));
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
      setActiveTags((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className="w-full h-full flex bg-zinc-900/80 rounded-xl border border-white/5 backdrop-blur-sm overflow-hidden">
      {/* Sidebar */}
      <div className="w-[400px] border-r border-white/5 flex flex-col bg-black/20 shrink-0">
        <div className="p-4 border-b border-white/5">
          <button 
            onClick={handleOpenFolder}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white py-2.5 px-4 rounded-lg transition-colors font-medium text-sm border border-white/10"
          >
            <FolderOpen size={16} />
            Open Folder
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <div className="grid grid-cols-4 gap-2">
            {files.map((file, idx) => (
              <div 
                key={file.name}
                onClick={() => {
                  setSelectedIndex(idx);
                  setActiveTags(file.tags);
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
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-3 mt-20">
              <ImageIcon size={32} className="opacity-40" />
              <p className="text-sm text-center px-6">Select a folder to view images and edit tags</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedIndex !== -1 && files[selectedIndex] ? (
          <div className="flex-1 p-6 flex flex-col min-h-0 gap-6">
            {/* Image Preview - Medium Size */}
            <div className="h-[35vh] min-h-[200px] max-h-[400px] shrink-0 bg-black/40 rounded-xl border border-white/5 flex items-center justify-center p-4 relative overflow-hidden group">
              <img 
                src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                alt={files[selectedIndex].name}
                className={`max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
              />
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-md border border-white/10 text-xs font-medium text-zinc-300">
                {files[selectedIndex].name}
              </div>
            </div>

            {/* Tags Editor - Flex 1 */}
            <div className="flex-1 flex flex-col bg-black/20 rounded-xl border border-white/5 p-5 min-h-0">
                <div className="flex items-center justify-between mb-4 shrink-0">
                    <div className="flex items-center gap-2 text-zinc-300">
                        <Tag size={16} />
                        <h3 className="text-sm font-medium">Danbooru Tags</h3>
                    </div>
                    <button 
                        onClick={handleSave}
                        disabled={saveStatus === 'saving'}
                        className="flex items-center gap-2 bg-white hover:bg-zinc-200 text-black py-2 px-5 rounded-xl transition-all text-sm font-bold disabled:opacity-50 shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95"
                    >
                        <Save size={16} />
                        {saveStatus === 'saving' ? 'SAVING...' : saveStatus === 'saved' ? 'SAVED!' : 'SAVE TAGS'}
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar mb-4 bg-black/20 rounded-lg border border-white/5 p-4">
                    <DndContext 
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext 
                            items={activeTags}
                            strategy={rectSortingStrategy}
                        >
                            <div className="flex flex-wrap gap-2">
                                {activeTags.map((tag) => (
                                    <SortableTag key={tag} tag={tag} onRemove={handleRemoveTag} />
                                ))}
                                {activeTags.length === 0 && (
                                    <span className="text-zinc-500 text-sm italic p-1">No tags found. Add some below!</span>
                                )}
                            </div>
                        </SortableContext>
                    </DndContext>
                </div>

                <div className="mt-auto shrink-0">
                    <input 
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={handleAddTag}
                        placeholder="Add tag and press Enter (comma separated for multiple)..."
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <p>No image selected</p>
          </div>
        )}
      </div>
    </div>
  );
};
