import React, { useState } from 'react';
import { FolderOpen, Save, X, Image as ImageIcon, Tag } from 'lucide-react';
import { motion } from 'motion/react';

interface FileEntry {
  imageHandle: FileSystemFileHandle;
  textHandle?: FileSystemFileHandle;
  name: string;
  baseName: string;
  imageUrl: string;
  tags: string[];
}

export const TagEditor: React.FC = () => {
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [newTag, setNewTag] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const handleOpenFolder = async () => {
    try {
      // @ts-ignore - File System Access API
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
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

    const fileList: FileEntry[] = [];

    for (const imgHandle of imageEntries) {
      const baseName = imgHandle.name.substring(0, imgHandle.name.lastIndexOf('.'));
      const txtHandle = textEntries.find((t: any) => t.name === `${baseName}.txt`);
      
      const file = await imgHandle.getFile();
      const imageUrl = URL.createObjectURL(file);
      
      let tags: string[] = [];
      if (txtHandle) {
        const txtFile = await txtHandle.getFile();
        const text = await txtFile.text();
        tags = text.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      }

      fileList.push({
        imageHandle: imgHandle,
        textHandle: txtHandle,
        name: imgHandle.name,
        baseName,
        imageUrl,
        tags
      });
    }

    setFiles(fileList);
    if (fileList.length > 0) {
      setSelectedIndex(0);
    }
  };

  const handleSave = async () => {
    if (selectedIndex === -1 || !directoryHandle) return;
    setIsSaving(true);
    try {
      const currentFile = files[selectedIndex];
      let txtHandle = currentFile.textHandle;
      
      if (!txtHandle) {
        // @ts-ignore
        txtHandle = await directoryHandle.getFileHandle(`${currentFile.baseName}.txt`, { create: true });
      }

      // @ts-ignore
      const writable = await txtHandle.createWritable();
      await writable.write(currentFile.tags.join(', '));
      await writable.close();
      
      // Update state to reflect that it now has a text handle
      setFiles(prev => {
        const newFiles = [...prev];
        newFiles[selectedIndex] = { ...newFiles[selectedIndex], textHandle: txtHandle };
        return newFiles;
      });
      
      alert('Tags saved successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to save tags.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTag.trim()) {
      const tagsToAdd = newTag.split(',').map(t => t.trim()).filter(t => t.length > 0);
      setFiles(prev => {
        const newFiles = [...prev];
        const currentTags = newFiles[selectedIndex].tags;
        newFiles[selectedIndex].tags = [...currentTags, ...tagsToAdd.filter(t => !currentTags.includes(t))];
        return newFiles;
      });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles[selectedIndex].tags = newFiles[selectedIndex].tags.filter(t => t !== tagToRemove);
      return newFiles;
    });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
    // Optional: set drag image to transparent to rely on framer-motion layout
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === index) return;
    
    setFiles(prev => {
      const newFiles = [...prev];
      const tags = [...newFiles[selectedIndex].tags];
      const draggedTag = tags[draggedIdx];
      
      tags.splice(draggedIdx, 1);
      tags.splice(index, 0, draggedTag);
      
      newFiles[selectedIndex].tags = tags;
      return newFiles;
    });
    setDraggedIdx(index);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
  };

  return (
    <div className="w-full h-full min-h-[600px] flex bg-zinc-900/80 rounded-xl border border-white/5 backdrop-blur-sm overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 border-r border-white/5 flex flex-col bg-black/20 shrink-0">
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
          <div className="grid grid-cols-3 gap-2">
            {files.map((file, idx) => (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                key={file.name}
                onClick={() => setSelectedIndex(idx)}
                className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-200 ${idx === selectedIndex ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.3)] z-10 scale-105' : 'border-transparent hover:border-white/30'}`}
              >
                <img src={file.imageUrl} alt={file.name} className="w-full h-full object-cover" />
                <div className="absolute bottom-1 right-1 bg-black/80 backdrop-blur-sm text-[10px] px-1.5 py-0.5 rounded text-white font-medium border border-white/10">
                  {file.tags.length}
                </div>
              </motion.div>
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
                src={files[selectedIndex].imageUrl} 
                alt={files[selectedIndex].name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
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
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-white hover:bg-zinc-200 text-black py-2 px-5 rounded-xl transition-all text-sm font-bold disabled:opacity-50 shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95"
                    >
                        <Save size={16} />
                        {isSaving ? 'SAVING...' : 'SAVE TAGS'}
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar mb-4 bg-black/20 rounded-lg border border-white/5 p-4">
                    <div className="flex flex-wrap gap-2">
                        {files[selectedIndex].tags.map((tag, idx) => (
                            <motion.div 
                                layout
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                key={tag} 
                                draggable
                                onDragStart={(e: any) => handleDragStart(e, idx)}
                                onDragOver={(e: any) => handleDragOver(e, idx)}
                                onDragEnd={handleDragEnd}
                                className={`flex items-center gap-1.5 bg-[#2a2d45] border border-[#3a3d55] text-[#d0d2e6] px-3 py-1.5 rounded-md text-sm font-medium group transition-colors hover:bg-[#323652] cursor-grab active:cursor-grabbing ${draggedIdx === idx ? 'opacity-50' : ''}`}
                            >
                                <span>{tag}</span>
                                <button 
                                    onClick={() => handleRemoveTag(tag)}
                                    className="text-zinc-400 hover:text-white opacity-60 group-hover:opacity-100 transition-opacity ml-1"
                                >
                                    <X size={14} />
                                </button>
                            </motion.div>
                        ))}
                        {files[selectedIndex].tags.length === 0 && (
                            <span className="text-zinc-500 text-sm italic p-1">No tags found. Add some below!</span>
                        )}
                    </div>
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
