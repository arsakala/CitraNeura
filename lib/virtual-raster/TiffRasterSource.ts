import { RasterSource, RasterMetadata } from './types';
import { fromBlob, GeoTIFF, GeoTIFFImage } from 'geotiff';

export class TiffRasterSource implements RasterSource {
  private metadata: RasterMetadata | null = null;
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private blobSize: number = 0;
  
  // Main-thread fallback properties
  private fallbackTiff: GeoTIFF | null = null;
  private fallbackImage: GeoTIFFImage | null = null;
  
  private messageIdCounter = 0;
  private pendingResolvers = new Map<number, { resolve: Function, reject: Function }>();
  private activeJobs = new Map<string, { id: number, workerIndex: number }>();

  public metrics = {
    metadataTime: 0,
    decodeImageTime: 0,
    rgbaTime: 0,
    fullDecodeTime: 0,
    averageTileWaitTime: 0,
    averageTileExtractTime: 0,
    averageTileBitmapTime: 0,
    tileCount: 0
  };

  public onTrace?: (msg: string) => void;

  constructor(workerCount: number = 4) {
    if (typeof window !== 'undefined') {
      for (let i = 0; i < workerCount; i++) {
        try {
          const worker = new Worker(new URL('./tiff.worker.ts', import.meta.url));
          worker.onmessage = this.handleMessage.bind(this);
          worker.onerror = (err) => {
            console.warn("TiffRasterSource Web Worker error, falling back:", err);
            try {
              worker.terminate();
            } catch (ignore) {}
            this.workers = this.workers.filter(w => w !== worker);
          };
          this.workers.push(worker);
        } catch (e) {
          console.error("Failed to construct Web Worker for TiffRasterSource:", e);
          break; // Avoid spamming multiple errors if sandboxed
        }
      }
    }
  }

  private handleMessage(e: MessageEvent) {
    const { type, id, payload, error } = e.data;
    
    if (type === 'TRACE') {
      if (this.onTrace) this.onTrace(payload);
      return;
    }
    
    if (type === 'METRICS') {
      this.metrics.metadataTime = payload.metadataTime;
      this.metrics.decodeImageTime = payload.decodeImageTime;
      this.metrics.rgbaTime = payload.rgbaTime;
      this.metrics.fullDecodeTime = payload.fullDecodeTime;
      return;
    }
    
    if (type === 'ERROR') {
      if (error === 'Cancelled') {
        if (this.onTrace) this.onTrace(`[Worker] Job cancelled`);
      } else {
        if (this.onTrace) this.onTrace(`[Worker Error] ${error}`);
      }
      if (id !== undefined) {
        const resolver = this.pendingResolvers.get(id);
        if (resolver) {
          this.pendingResolvers.delete(id);
          resolver.reject(new Error(error));
        }
      }
      return;
    }
    
    if (id !== undefined) {
      const resolver = this.pendingResolvers.get(id);
      if (resolver) {
        this.pendingResolvers.delete(id);
        resolver.resolve(payload);
      }
    }
  }

  private postMessageAsync(workerIndex: number, type: string, payload: any, transfer: Transferable[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const worker = this.workers[workerIndex];
      if (!worker) return reject(new Error("Worker not initialized"));
      const id = this.messageIdCounter++;
      this.pendingResolvers.set(id, { resolve, reject });
      worker.postMessage({ type, payload, id }, transfer);
    });
  }

  async open(fileOrUrl: Blob | string): Promise<void> {
    let fileBlob: Blob;
    
    if (typeof fileOrUrl === 'string') {
      const response = await fetch(fileOrUrl);
      fileBlob = await response.blob();
    } else {
      fileBlob = fileOrUrl;
    }
    this.blobSize = fileBlob.size;

    if (this.workers.length > 0) {
      try {
        // Send OPEN to all workers, wait for the first one to return metadata
        const openPromises = this.workers.map((_, i) => this.postMessageAsync(i, 'OPEN', { file: fileBlob }));
        
        // Timeout race: if workers do not respond within 1.5s, fall back to main thread
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Worker open timeout - script blocked or failed to load")), 1500)
        );
        
        const results = await Promise.race([
          Promise.all(openPromises),
          timeoutPromise
        ]);
        const workerMeta = results[0];
        
        this.metadata = {
          width: workerMeta.width,
          height: workerMeta.height,
          fileSize: this.blobSize,
          checksum: `tiff-${this.blobSize}-${Date.now()}`,
          tiffLayout: workerMeta.tiffLayout
        };
      } catch (err) {
        console.warn("Workers failed to open TIFF, falling back to main thread:", err);
        // Clear workers so subsequent calls use fallback
        this.workers = [];
        await this.open(fileOrUrl);
      }
    } else {
      // Main-thread fallback
      if (this.onTrace) this.onTrace('Workers not available, parsing TIFF on main thread...');
      const t0 = performance.now();
      this.fallbackTiff = await fromBlob(fileBlob);
      this.fallbackImage = await this.fallbackTiff.getImage();
      const t2 = performance.now();

      const fd = this.fallbackImage.getFileDirectory() as any;
      const layout = {
        compression: fd.Compression,
        predictor: fd.Predictor,
        rowsPerStrip: fd.RowsPerStrip,
        tileWidth: fd.TileWidth,
        tileLength: fd.TileLength,
        planarConfiguration: fd.PlanarConfiguration,
        bitsPerSample: fd.BitsPerSample,
        samplesPerPixel: fd.SamplesPerPixel,
        photometricInterpretation: fd.PhotometricInterpretation,
      };

      this.metadata = {
        width: this.fallbackImage.getWidth(),
        height: this.fallbackImage.getHeight(),
        fileSize: this.blobSize,
        checksum: `tiff-${this.blobSize}-${Date.now()}`,
        tiffLayout: layout
      };

      if (this.onTrace) {
        this.onTrace(`Metadata parsed (${this.metadata.width}x${this.metadata.height}) on main thread in ${Math.round(t2 - t0)}ms`);
      }
    }
  }

  getMetadata(): RasterMetadata {
    if (!this.metadata) throw new Error("Source not opened");
    return this.metadata;
  }

  async getTile(level: number, tileIndex: number, bounds: { x: number, y: number, width: number, height: number }): Promise<ImageBitmap> {
    if (!this.metadata) throw new Error("Source not opened");
    
    if (this.workers.length > 0) {
      const jobId = `${level}-${tileIndex}`;
      const id = this.messageIdCounter++;
      const workerIndex = this.nextWorkerIndex;
      this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
      
      this.activeJobs.set(jobId, { id, workerIndex });

      try {
        const res: any = await new Promise((resolve, reject) => {
          const worker = this.workers[workerIndex];
          if (!worker) return reject(new Error("Worker not initialized"));
          this.pendingResolvers.set(id, { resolve, reject });
          worker.postMessage({ type: 'GET_TILE', payload: { bounds }, id });
        });
        
        this.activeJobs.delete(jobId);

        this.metrics.tileCount++;
        this.metrics.averageTileWaitTime += (res.waitTime - this.metrics.averageTileWaitTime) / this.metrics.tileCount;
        this.metrics.averageTileExtractTime += (res.extractTime - this.metrics.averageTileExtractTime) / this.metrics.tileCount;
        this.metrics.averageTileBitmapTime += (res.bitmapTime - this.metrics.averageTileBitmapTime) / this.metrics.tileCount;

        return res.bitmap;
      } catch (err) {
        console.warn(`Worker tile extraction failed, falling back to main thread:`, err);
        return this.getTileMainThread(bounds);
      }
    } else {
      return this.getTileMainThread(bounds);
    }
  }

  private async getTileMainThread(bounds: { x: number, y: number, width: number, height: number }): Promise<ImageBitmap> {
    if (!this.fallbackImage) throw new Error("Source fallback image not loaded");
    
    const destWidth = bounds.width;
    const destHeight = bounds.height;
    
    const window = [
      bounds.x,
      bounds.y,
      bounds.x + destWidth,
      bounds.y + destHeight
    ];

    if (this.onTrace) {
      this.onTrace(`Tile [y:${bounds.y}] decoding on main thread...`);
    }

    const rasters = await this.fallbackImage.readRasters({ 
      window,
      interleave: true 
    });
    
    const rasterData = rasters as any;
    const samplesPerPixel = this.fallbackImage.getSamplesPerPixel();
    
    let imgData: ImageData;
    
    if (samplesPerPixel === 4 && rasterData instanceof Uint8Array) {
      imgData = new ImageData(new Uint8ClampedArray(rasterData.buffer, rasterData.byteOffset, rasterData.byteLength) as any, destWidth, destHeight);
    } else {
      imgData = new ImageData(destWidth, destHeight);
      for (let i = 0, j = 0; i < destWidth * destHeight; i++) {
        if (samplesPerPixel === 1) {
          const val = rasterData[i];
          const normalized = rasterData instanceof Uint16Array ? (val >> 8) : val;
          imgData.data[j++] = normalized;
          imgData.data[j++] = normalized;
          imgData.data[j++] = normalized;
          imgData.data[j++] = 255;
        } else if (samplesPerPixel >= 3) {
          const r = rasterData[i * samplesPerPixel];
          const g = rasterData[i * samplesPerPixel + 1];
          const b = rasterData[i * samplesPerPixel + 2];
          const a = samplesPerPixel >= 4 ? rasterData[i * samplesPerPixel + 3] : 255;
          
          if (rasterData instanceof Uint16Array) {
            imgData.data[j++] = r >> 8;
            imgData.data[j++] = g >> 8;
            imgData.data[j++] = b >> 8;
            imgData.data[j++] = a === 255 ? 255 : (a >> 8);
          } else {
            imgData.data[j++] = r;
            imgData.data[j++] = g;
            imgData.data[j++] = b;
            imgData.data[j++] = a;
          }
        }
      }
    }
    
    return await createImageBitmap(imgData);
  }

  async getThumbnail(maxDimension: number): Promise<ImageBitmap | null> {
    if (this.workers.length > 0) {
      try {
        const workerIndex = this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
        const worker = this.workers[workerIndex];
        
        return new Promise((resolve, reject) => {
          const id = this.messageIdCounter++;
          this.pendingResolvers.set(id, { resolve, reject });
          
          worker.postMessage({
            type: 'THUMBNAIL',
            id,
            payload: { maxDimension }
          });
        }).then((res: any) => res.bitmap);
      } catch (err) {
        console.warn("Worker thumbnail extraction failed, falling back to main thread:", err);
        return this.getThumbnailMainThread(maxDimension);
      }
    } else {
      return this.getThumbnailMainThread(maxDimension);
    }
  }

  private async getThumbnailMainThread(maxDimension: number): Promise<ImageBitmap | null> {
    if (!this.fallbackImage || !this.metadata) return null;
    
    let scale = 1.0;
    const targetWidth = Math.min(this.metadata.width, 600);
    scale = targetWidth / this.metadata.width;
    
    let proposedHeight = Math.round(this.metadata.height * scale);
    if (proposedHeight > 16384) {
      scale = 16384 / this.metadata.height;
    }
    
    let destWidth = Math.round(this.metadata.width * scale);
    let destHeight = Math.round(this.metadata.height * scale);
    
    destWidth = Math.max(1, destWidth);
    destHeight = Math.max(1, destHeight);

    const rasters = await this.fallbackImage.readRasters({ 
      width: destWidth,
      height: destHeight,
      interleave: true
    });
    
    const rasterData = rasters as any;
    const samplesPerPixel = this.fallbackImage.getSamplesPerPixel();
    
    let imgData: ImageData;
    
    if (samplesPerPixel === 4 && rasterData instanceof Uint8Array) {
      imgData = new ImageData(new Uint8ClampedArray(rasterData.buffer, rasterData.byteOffset, rasterData.byteLength) as any, destWidth, destHeight);
    } else {
      imgData = new ImageData(destWidth, destHeight);
      for (let i = 0, j = 0; i < destWidth * destHeight; i++) {
        if (samplesPerPixel === 1) {
          const val = rasterData[i];
          const normalized = rasterData instanceof Uint16Array ? (val >> 8) : val;
          imgData.data[j++] = normalized;
          imgData.data[j++] = normalized;
          imgData.data[j++] = normalized;
          imgData.data[j++] = 255;
        } else if (samplesPerPixel >= 3) {
          const r = rasterData[i * samplesPerPixel];
          const g = rasterData[i * samplesPerPixel + 1];
          const b = rasterData[i * samplesPerPixel + 2];
          const a = samplesPerPixel >= 4 ? rasterData[i * samplesPerPixel + 3] : 255;
          
          if (rasterData instanceof Uint16Array) {
            imgData.data[j++] = r >> 8;
            imgData.data[j++] = g >> 8;
            imgData.data[j++] = b >> 8;
            imgData.data[j++] = a === 255 ? 255 : (a >> 8);
          } else {
            imgData.data[j++] = r;
            imgData.data[j++] = g;
            imgData.data[j++] = b;
            imgData.data[j++] = a;
          }
        }
      }
    }
    
    return await createImageBitmap(imgData);
  }

  cancelTile(level: number, tileIndex: number): void {
    const jobId = `${level}-${tileIndex}`;
    const job = this.activeJobs.get(jobId);
    if (job !== undefined) {
      const worker = this.workers[job.workerIndex];
      if (worker) {
        worker.postMessage({ type: 'CANCEL', id: job.id });
      }
      
      const resolver = this.pendingResolvers.get(job.id);
      if (resolver) {
        this.pendingResolvers.delete(job.id);
        resolver.reject(new Error("Cancelled"));
      }
      this.activeJobs.delete(jobId);
    }
  }

  dispose(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.metadata = null;
    this.fallbackTiff = null;
    this.fallbackImage = null;
    this.pendingResolvers.clear();
  }
}
