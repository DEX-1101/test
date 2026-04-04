import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, Save, X, Image as ImageIcon, Tag, Send, Undo2, Redo2, Crop as CropIcon, Plus, Settings, Wand2, Trash2 } from 'lucide-react';
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
import { wdTagger, deleteModelFromDB, checkModelExists } from '../lib/wdTagger';

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
          imageHandle.getFile().then(async file => {
            const buffer = await file.arrayBuffer();
            const blob = new Blob([buffer], { type: file.type });
            const newUrl = URL.createObjectURL(blob);
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
      className={`flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-100 px-3 py-1.5 rounded-md text-sm font-medium group transition-colors hover:bg-blue-500/20 cursor-grab active:cursor-grabbing relative ${isDragging ? 'shadow-lg shadow-black/50 scale-105 z-50' : ''}`}
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

  const [imageState, setImageState] = useState<{
    history: string[];
    index: number;
  }>({
    history: [],
    index: 0
  });

  const [newTag, setNewTag] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [crop, setCrop] = useState<Crop>();
  const [isCropping, setIsCropping] = useState(false);
  const previewImgRef = useRef<HTMLImageElement>(null);
  const urlCache = useRef<Map<string, string>>(new Map());

  // Auto Tag & Batch Processing State
  const [isAutoTagModalOpen, setIsAutoTagModalOpen] = useState(false);
  const [batchActivationTags, setBatchActivationTags] = useState('');
  const [batchEmphasizeTags, setBatchEmphasizeTags] = useState('');
  const [batchRemoveTags, setBatchRemoveTags] = useState('');
  const [batchRename, setBatchRename] = useState(false);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [batchProgress, setBatchProgress] = useState(0);

  // WD Tagger State
  const [selectedModelId, setSelectedModelId] = useState('eva02-v3');
  const [wdStatus, setWdStatus] = useState<'idle' | 'loading' | 'processing' | 'done'>('idle');
  const [wdProgress, setWdProgress] = useState(0);
  const [wdProgressText, setWdProgressText] = useState('');
  const [wdThreshold, setWdThreshold] = useState(0.35);
  const [wdCharThreshold, setWdCharThreshold] = useState(0.85);
  const [wdOverwrite, setWdOverwrite] = useState(false);
  const [wdModelExists, setWdModelExists] = useState(false);

  useEffect(() => {
    checkModelExists(selectedModelId).then(exists => setWdModelExists(exists));
  }, [isAutoTagModalOpen, selectedModelId]);

  const handleWdProcess = async () => {
    if (!directoryHandle) return;
    setWdStatus('loading');
    setWdProgress(0);
    setWdProgressText('Initializing WD Tagger...');

    try {
      await wdTagger.init(selectedModelId, (progress, status) => {
        setWdProgress(progress);
        setWdProgressText(status);
      });

      setWdStatus('processing');
      const updatedFiles = [...files];
      const totalSteps = updatedFiles.length;

      for (let i = 0; i < updatedFiles.length; i++) {
        const file = updatedFiles[i];
        
        // Skip if not overwriting and tags already exist
        if (!wdOverwrite && file.tags.length > 0) {
          setWdProgress(Math.round(((i + 1) / totalSteps) * 100));
          setWdProgressText(`Skipping ${file.name}...`);
          continue;
        }

        setWdProgress(Math.round(((i + 1) / totalSteps) * 100));
        setWdProgressText(`Tagging ${file.name}...`);

        // Load image to HTMLImageElement
        const imgFile = await file.imageHandle.getFile();
        const imgUrl = URL.createObjectURL(imgFile);
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imgUrl;
        });

        const generatedTags = await wdTagger.predict(img, wdThreshold, wdCharThreshold);
        URL.revokeObjectURL(imgUrl);

        updatedFiles[i].tags = generatedTags;

        let txtHandle = file.textHandle;
        if (!txtHandle) {
          txtHandle = await directoryHandle.getFileHandle(`${file.baseName}.txt`, { create: true });
          updatedFiles[i].textHandle = txtHandle;
        }
        
        // @ts-ignore
        const writable = await txtHandle.createWritable();
        await writable.write(generatedTags.join(', '));
        await writable.close();
      }

      setFiles(updatedFiles);
      if (selectedIndex !== -1) {
        setTagState({
          current: updatedFiles[selectedIndex].tags,
          history: [updatedFiles[selectedIndex].tags],
          index: 0
        });
      }
      setWdStatus('done');
      setWdProgress(100);
      setWdProgressText('Done!');
      setTimeout(() => {
        setWdStatus('idle');
        setWdProgress(0);
        setWdProgressText('');
      }, 1500);

    } catch (err) {
      console.error(err);
      alert('Failed to process WD Tagger.');
      setWdStatus('idle');
      setWdProgress(0);
      setWdProgressText('');
    }
  };

  const handleDeleteModel = async () => {
    if (confirm('Are you sure you want to delete the downloaded model? It will need to be downloaded again.')) {
      await deleteModelFromDB(selectedModelId);
      setWdModelExists(false);
    }
  };

  const cleanAndSplitTags = (tagsStr: string) => {
    return tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  };

  const handleBatchProcess = async () => {
    if (!directoryHandle) return;
    setBatchStatus('processing');
    setBatchProgress(0);

    try {
      const actTags = cleanAndSplitTags(batchActivationTags);
      const emphTags = cleanAndSplitTags(batchEmphasizeTags);
      const remTags = cleanAndSplitTags(batchRemoveTags);

      let previousActTags: string[] = [];
      try {
        const metaHandle = await directoryHandle.getFileHandle('.last_activation_tags.txt');
        const metaFile = await metaHandle.getFile();
        const metaText = await metaFile.text();
        previousActTags = cleanAndSplitTags(metaText);
      } catch (e) {
        // Ignore if not found
      }

      const tagsToDrop = [...remTags, ...previousActTags];
      const updatedFiles = [...files];
      
      const totalSteps = updatedFiles.length * (batchRename ? 2 : 1);
      let currentStep = 0;

      for (let i = 0; i < updatedFiles.length; i++) {
        const file = updatedFiles[i];
        let currentTags = [...file.tags];
        const originalTags = [...currentTags];

        currentTags = currentTags.filter(t => !tagsToDrop.includes(t));
        const validEmphTags = emphTags.filter(t => originalTags.includes(t));
        currentTags = currentTags.filter(t => !validEmphTags.includes(t) && !actTags.includes(t));
        
        const finalTags = [...actTags, ...validEmphTags, ...currentTags];
        const uniqueTags = Array.from(new Set(finalTags));

        updatedFiles[i].tags = uniqueTags;

        let txtHandle = file.textHandle;
        if (!txtHandle) {
          txtHandle = await directoryHandle.getFileHandle(`${file.baseName}.txt`, { create: true });
          updatedFiles[i].textHandle = txtHandle;
        }
        
        // @ts-ignore
        const writable = await txtHandle.createWritable();
        await writable.write(uniqueTags.join(', '));
        await writable.close();
        
        currentStep++;
        setBatchProgress(Math.round((currentStep / totalSteps) * 100));
      }

      try {
        const metaHandle = await directoryHandle.getFileHandle('.last_activation_tags.txt', { create: true });
        // @ts-ignore
        const writable = await metaHandle.createWritable();
        await writable.write(batchActivationTags);
        await writable.close();
      } catch (e) {
        console.error("Failed to save meta file", e);
      }

      if (batchRename) {
        let counter = 1;
        for (let i = 0; i < updatedFiles.length; i++) {
          const file = updatedFiles[i];
          const ext = file.name.substring(file.name.lastIndexOf('.'));
          const newImgName = `${counter}${ext}`;
          const newTxtName = `${counter}.txt`;

          if (file.name !== newImgName) {
            const newImgHandle = await directoryHandle.getFileHandle(newImgName, { create: true });
            const imgFile = await file.imageHandle.getFile();
            // @ts-ignore
            const imgWritable = await newImgHandle.createWritable();
            await imgWritable.write(imgFile);
            await imgWritable.close();
            await directoryHandle.removeEntry(file.name);
            updatedFiles[i].imageHandle = newImgHandle;
            updatedFiles[i].name = newImgName;
            updatedFiles[i].baseName = `${counter}`;
          }

          if (file.textHandle && file.textHandle.name !== newTxtName) {
            const newTxtHandle = await directoryHandle.getFileHandle(newTxtName, { create: true });
            const txtFile = await file.textHandle.getFile();
            // @ts-ignore
            const txtWritable = await newTxtHandle.createWritable();
            await txtWritable.write(txtFile);
            await txtWritable.close();
            await directoryHandle.removeEntry(file.textHandle.name);
            updatedFiles[i].textHandle = newTxtHandle;
          }
          counter++;
          
          currentStep++;
          setBatchProgress(Math.round((currentStep / totalSteps) * 100));
        }
      }

      setFiles(updatedFiles);
      if (selectedIndex !== -1) {
        setTagState({
          current: updatedFiles[selectedIndex].tags,
          history: [updatedFiles[selectedIndex].tags],
          index: 0
        });
      }
      setBatchStatus('done');
      setBatchProgress(100);
      setTimeout(() => {
        setBatchStatus('idle');
        setBatchProgress(0);
      }, 1500);

    } catch (err) {
      console.error(err);
      alert('Failed to process batch.');
      setBatchStatus('idle');
      setBatchProgress(0);
    }
  };

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

  const lastLoadedIndex = useRef<number>(-1);

  const currentImageHandle = files[selectedIndex]?.imageHandle;
  useEffect(() => {
    if (currentImageHandle) {
      const name = currentImageHandle.name;
      const cached = urlCache.current.get(name);
      
      const isNewImage = lastLoadedIndex.current !== selectedIndex;
      if (isNewImage) {
        lastLoadedIndex.current = selectedIndex;
      }

      if (cached) {
        setPreviewUrl(cached);
        if (isNewImage) {
          setImageState({ history: [cached], index: 0 });
        }
      } else {
        currentImageHandle.getFile().then(async file => {
          const buffer = await file.arrayBuffer();
          const blob = new Blob([buffer], { type: file.type });
          const objectUrl = URL.createObjectURL(blob);
          urlCache.current.set(name, objectUrl);
          // Only update state if we haven't switched to another image while loading
          if (lastLoadedIndex.current === selectedIndex) {
            setPreviewUrl(objectUrl);
            if (isNewImage) {
              setImageState({ history: [objectUrl], index: 0 });
            }
          }
        });
      }
    } else {
      setPreviewUrl('');
      setImageState({ history: [], index: 0 });
      lastLoadedIndex.current = -1;
    }
  }, [currentImageHandle, selectedIndex]);

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
            const buffer = await file.arrayBuffer();
            const blob = new Blob([buffer], { type: file.type });
            urlCache.current.set(name, URL.createObjectURL(blob));
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
          
          setImageState(prev => {
            const newHistory = prev.history.slice(0, prev.index + 1);
            newHistory.push(newObjectUrl);
            return { history: newHistory, index: newHistory.length - 1 };
          });

          setCrop(undefined); // reset crop
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

  const handleUndoCrop = async () => {
    if (imageState.index > 0) {
      const newIndex = imageState.index - 1;
      const previousUrl = imageState.history[newIndex];
      setImageState(prev => ({ ...prev, index: newIndex }));
      setPreviewUrl(previousUrl);
      urlCache.current.set(files[selectedIndex].name, previousUrl);
      
      try {
        const response = await fetch(previousUrl);
        const blob = await response.blob();
        // @ts-ignore
        const writableImg = await files[selectedIndex].imageHandle.createWritable();
        await writableImg.write(blob);
        await writableImg.close();
      } catch (e) {
        console.error("Failed to write undo crop to disk", e);
      }
    }
  };

  const handleRedoCrop = async () => {
    if (imageState.index < imageState.history.length - 1) {
      const newIndex = imageState.index + 1;
      const nextUrl = imageState.history[newIndex];
      setImageState(prev => ({ ...prev, index: newIndex }));
      setPreviewUrl(nextUrl);
      urlCache.current.set(files[selectedIndex].name, nextUrl);
      
      try {
        const response = await fetch(nextUrl);
        const blob = await response.blob();
        // @ts-ignore
        const writableImg = await files[selectedIndex].imageHandle.createWritable();
        await writableImg.write(blob);
        await writableImg.close();
      } catch (e) {
        console.error("Failed to write redo crop to disk", e);
      }
    }
  };

  const commitNewTag = () => {
    if (newTag.trim()) {
      const tagsToAdd = newTag.split(',').map(t => t.trim()).filter(t => t.length > 0);
      updateTags(prev => {
        const newTags = [...prev, ...tagsToAdd.filter(t => !prev.includes(t))];
        return newTags;
      });
      setNewTag('');
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitNewTag();
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
        <div className="p-4 border-b border-white/5 flex flex-col gap-2">
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
            {/* Image Area */}
            {isCropping ? (
              <div className="w-full h-full flex items-center justify-center p-8">
                <ReactCrop crop={crop} onChange={c => setCrop(c)}>
                  <img 
                    ref={previewImgRef}
                    src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                    alt={files[selectedIndex].name}
                    className={`max-w-full max-h-[85vh] object-contain transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
                  />
                </ReactCrop>
              </div>
            ) : (
              <TransformWrapper centerOnInit minScale={0.1} maxScale={10} wheel={{ step: 0.1 }}>
                <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img 
                    ref={previewImgRef}
                    src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                    alt={files[selectedIndex].name}
                    className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
                  />
                </TransformComponent>
              </TransformWrapper>
            )}

            {/* Floating Tag Editor Overlay (Centered Landscape) */}
            <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 w-[800px] max-w-[95vw] max-h-[85%] flex flex-col bg-black/60 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl z-50 overflow-hidden transition-all duration-300 ease-in-out ${isCropping || isAutoTagModalOpen ? 'opacity-0 translate-y-8 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
               
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
                    <div className="flex items-center bg-white/5 rounded-lg overflow-hidden border border-white/10">
                      <button 
                        onClick={handleUndo} 
                        disabled={tagState.index <= 0} 
                        className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors border-r border-white/10 flex items-center gap-1"
                        title="Undo Tag (Ctrl+Z)"
                      >
                        <Undo2 size={16}/> <span className="text-xs font-medium">Tag</span>
                      </button>
                      <button 
                        onClick={handleRedo} 
                        disabled={tagState.index >= tagState.history.length - 1} 
                        className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors flex items-center gap-1"
                        title="Redo Tag (Ctrl+Shift+Z)"
                      >
                        <Redo2 size={16}/> <span className="text-xs font-medium">Tag</span>
                      </button>
                    </div>

                    <button 
                      onClick={() => setIsAutoTagModalOpen(true)} 
                      className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-white/10 bg-white/5 hover:bg-white/10 text-white"
                      title="Auto-tag & Batch Process"
                    >
                      <Wand2 size={16}/> Auto Tag
                    </button>

                    <button 
                      onClick={() => setIsCropping(true)} 
                      className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-white/10 bg-white/5 hover:bg-white/10 text-white"
                    >
                      <CropIcon size={16}/> Crop
                    </button>
                  </div>

                  {/* Right: Input & Save */}
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 flex items-center">
                      <input 
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={handleAddTag}
                        placeholder="Add tags (comma separated)..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-4 pr-10 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
                      />
                      <button
                        onClick={commitNewTag}
                        disabled={!newTag.trim()}
                        className="absolute right-2 p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                        title="Add Tag"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
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

            {/* Floating Crop Controls */}
            <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/80 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl z-50 p-3 transition-all duration-300 ease-in-out ${isCropping ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
              <div className="flex items-center bg-white/5 rounded-lg overflow-hidden border border-white/10 mr-2">
                <button 
                  onClick={handleUndoCrop} 
                  disabled={imageState.index <= 0} 
                  className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors border-r border-white/10 flex items-center gap-1"
                  title="Undo Crop"
                >
                  <Undo2 size={16}/>
                </button>
                <button 
                  onClick={handleRedoCrop} 
                  disabled={imageState.index >= imageState.history.length - 1} 
                  className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors flex items-center gap-1"
                  title="Redo Crop"
                >
                  <Redo2 size={16}/>
                </button>
              </div>
              <button 
                onClick={() => {
                  setIsCropping(false);
                  setCrop(undefined);
                }} 
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors bg-white/10 hover:bg-white/20 text-white"
              >
                <X size={16}/> Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saveStatus === 'saving' || !crop || crop.width === 0}
                className="px-6 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {saveStatus === 'saving' ? (
                  <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                ) : (
                  <CropIcon size={16} />
                )}
                {saveStatus === 'saving' ? 'Applying...' : 'Apply Crop'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-500 gap-4">
            <ImageIcon size={64} strokeWidth={1} className="opacity-50" />
            <p>Select an image from the sidebar</p>
          </div>
        )}
      </div>

      {/* Floating Auto Tag & Batch Processing Overlay */}
      <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 w-[800px] max-w-[95vw] max-h-[85%] flex flex-col bg-[#18181b] rounded-2xl border border-white/10 shadow-2xl z-50 overflow-hidden transition-all duration-300 ease-in-out ${isAutoTagModalOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/40">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Wand2 size={18} className="text-purple-400" />
            Auto Tag & Batch Process
          </h2>
          <button 
            onClick={() => setIsAutoTagModalOpen(false)}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        <div className="p-5 grid grid-cols-2 gap-6 overflow-y-auto custom-scrollbar flex-1">
          {/* Left Column: Tag Generation */}
          <div className="flex flex-col gap-4">
            <h3 className="font-medium text-white border-b border-white/10 pb-2 flex items-center gap-2">
              <Wand2 size={16} className="text-zinc-400" /> 1. Generate Tags
            </h3>
            
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm text-zinc-300">Model</label>
                {wdModelExists && (
                  <button onClick={handleDeleteModel} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                    <Trash2 size={12} /> Delete Cached Model
                  </button>
                )}
              </div>
              <select 
                value={selectedModelId} 
                onChange={e => setSelectedModelId(e.target.value)} 
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              >
                <option value="eva02-v3">EVA02 Large v3 (~1.2GB)</option>
                <option value="vit-v3">ViT Large v3 (~1.2GB)</option>
                <option value="swinv2-v2">SwinV2 v2 (~1.1GB)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300 flex justify-between">
                  <span>General Thresh</span>
                  <span className="text-zinc-500">{wdThreshold.toFixed(2)}</span>
                </label>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={wdThreshold} onChange={e => setWdThreshold(parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300 flex justify-between">
                  <span>Char Thresh</span>
                  <span className="text-zinc-500">{wdCharThreshold.toFixed(2)}</span>
                </label>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={wdCharThreshold} onChange={e => setWdCharThreshold(parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5 mt-auto">
              <input 
                type="checkbox" id="wdOverwrite"
                checked={wdOverwrite} onChange={e => setWdOverwrite(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/50 text-purple-500 focus:ring-purple-500/50 focus:ring-offset-0"
              />
              <label htmlFor="wdOverwrite" className="text-sm font-medium text-zinc-300 cursor-pointer select-none leading-tight">
                Overwrite existing tags
              </label>
            </div>

            <button 
              onClick={handleWdProcess}
              disabled={wdStatus !== 'idle' || batchStatus !== 'idle'}
              className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {wdStatus === 'loading' || wdStatus === 'processing' ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : wdStatus === 'done' ? (
                <Save size={16} />
              ) : (
                <Wand2 size={16} />
              )}
              {wdStatus === 'loading' ? 'Loading Model...' : wdStatus === 'processing' ? 'Tagging...' : wdStatus === 'done' ? 'Done!' : 'Generate Tags'}
            </button>
          </div>

          {/* Right Column: Batch Processing */}
          <div className="flex flex-col gap-4">
            <h3 className="font-medium text-white border-b border-white/10 pb-2 flex items-center gap-2">
              <Settings size={16} className="text-zinc-400" /> 2. Batch Process
            </h3>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Activation Tags</label>
              <input 
                type="text" value={batchActivationTags} onChange={e => setBatchActivationTags(e.target.value)}
                placeholder="e.g., sakura, 1girl"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Tags to Emphasize</label>
              <input 
                type="text" value={batchEmphasizeTags} onChange={e => setBatchEmphasizeTags(e.target.value)}
                placeholder="e.g., solo, long hair"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Tags to Remove</label>
              <input 
                type="text" value={batchRemoveTags} onChange={e => setBatchRemoveTags(e.target.value)}
                placeholder="e.g., blurry, bad anatomy"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5 mt-auto">
              <input 
                type="checkbox" id="renameSeq"
                checked={batchRename} onChange={e => setBatchRename(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/50 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0"
              />
              <label htmlFor="renameSeq" className="text-sm font-medium text-zinc-300 cursor-pointer select-none leading-tight">
                Rename files sequentially (1.jpg, 1.txt)
              </label>
            </div>

            <button 
              onClick={handleBatchProcess}
              disabled={batchStatus !== 'idle' || wdStatus !== 'idle'}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {batchStatus === 'processing' ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : batchStatus === 'done' ? (
                <Save size={16} />
              ) : (
                <Settings size={16} />
              )}
              {batchStatus === 'processing' ? 'Processing...' : batchStatus === 'done' ? 'Done!' : 'Process Batch'}
            </button>
          </div>
        </div>

        {/* Shared Progress Bar Area */}
        {(wdStatus !== 'idle' || batchStatus !== 'idle') && (
          <div className="px-5 pb-4 bg-black/20 pt-3 border-t border-white/10">
            <div className="flex justify-between text-xs text-zinc-400 font-medium mb-1.5">
              <span>{wdStatus !== 'idle' ? wdProgressText : 'Processing batch...'}</span>
              <span>{wdStatus !== 'idle' ? wdProgress : batchProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ease-out ${wdStatus !== 'idle' ? 'bg-purple-500' : 'bg-blue-500'}`}
                style={{ width: `${wdStatus !== 'idle' ? wdProgress : batchProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
