import * as ort from 'onnxruntime-web';

// Set WASM paths to CDN to avoid Vite bundling issues
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/";

const MODEL_URL = "https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/model.onnx";
const TAGS_URL = "https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/raw/main/selected_tags.csv";
const DB_NAME = "WDTaggerCache";
const STORE_NAME = "models";

export interface TagInfo {
  name: string;
  category: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getModelFromDB(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('model.onnx');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn("IndexedDB not available or failed", e);
    return null;
  }
}

async function saveModelToDB(buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(buffer, 'model.onnx');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn("Failed to save model to IndexedDB", e);
  }
}

export async function deleteModelFromDB(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete('model.onnx');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn("Failed to delete model from IndexedDB", e);
  }
}

export async function checkModelExists(): Promise<boolean> {
  const model = await getModelFromDB();
  return model !== null;
}

export class WDTagger {
  private session: ort.InferenceSession | null = null;
  private tags: TagInfo[] = [];

  async init(onProgress?: (progress: number, status: string) => void) {
    if (this.session) return;

    if (onProgress) onProgress(0, 'Loading tags...');
    if (this.tags.length === 0) {
      const response = await fetch(TAGS_URL);
      const text = await response.text();
      const lines = text.trim().split('\n');
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 3) {
          this.tags.push({
            name: parts[1],
            category: parseInt(parts[2], 10)
          });
        }
      }
    }

    if (onProgress) onProgress(0, 'Checking cache...');
    let modelBuffer = await getModelFromDB();
    
    if (!modelBuffer) {
      if (onProgress) onProgress(0, 'Downloading model (1.2GB)...');
      const response = await fetch(MODEL_URL);
      if (!response.ok) throw new Error(`Failed to fetch model: ${response.statusText}`);
      
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 1260435999; // Fallback to known size
      let loaded = 0;
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to get reader");
      
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          if (onProgress) {
            onProgress(Math.round((loaded / total) * 100), `Downloading model (${Math.round(loaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)...`);
          }
        }
      }
      
      if (onProgress) onProgress(100, 'Processing model buffer...');
      const buffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      modelBuffer = buffer.buffer;
      
      if (onProgress) onProgress(100, 'Saving to cache...');
      await saveModelToDB(modelBuffer);
    } else {
      if (onProgress) onProgress(100, 'Model loaded from cache.');
    }

    if (onProgress) onProgress(100, 'Initializing ONNX session...');
    this.session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm']
    });
    
    if (onProgress) onProgress(100, 'Ready');
  }

  preprocessImage(image: HTMLImageElement): Float32Array {
    const targetSize = 448;
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas 2D context not available");

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetSize, targetSize);

    const scale = Math.min(targetSize / image.width, targetSize / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = (targetSize - w) / 2;
    const y = (targetSize - h) / 2;

    ctx.drawImage(image, x, y, w, h);

    const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
    const data = imageData.data;
    
    const float32Data = new Float32Array(3 * targetSize * targetSize);
    
    for (let i = 0; i < targetSize * targetSize; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      
      float32Data[i] = r / 127.5 - 1.0;
      float32Data[targetSize * targetSize + i] = g / 127.5 - 1.0;
      float32Data[2 * targetSize * targetSize + i] = b / 127.5 - 1.0;
    }
    
    return float32Data;
  }

  async predict(image: HTMLImageElement, threshold: number = 0.35, characterThreshold: number = 0.85): Promise<string[]> {
    if (!this.session) throw new Error("Session not initialized");
    
    const inputData = this.preprocessImage(image);
    const tensor = new ort.Tensor('float32', inputData, [1, 3, 448, 448]);
    
    const feeds: Record<string, ort.Tensor> = {};
    feeds[this.session.inputNames[0]] = tensor;
    
    const results = await this.session.run(feeds);
    const output = results[this.session.outputNames[0]].data as Float32Array;
    
    const tags: Record<string, number> = {};
    
    for (let i = 4; i < output.length; i++) {
      const prob = output[i];
      const tagInfo = this.tags[i];
      if (!tagInfo) continue;
      
      const isCharacter = tagInfo.category === 4;
      const thresh = isCharacter ? characterThreshold : threshold;
      
      if (prob > thresh) {
        tags[tagInfo.name] = prob;
      }
    }
    
    const sortedTags = Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
      
    return sortedTags;
  }
}

export const wdTagger = new WDTagger();
