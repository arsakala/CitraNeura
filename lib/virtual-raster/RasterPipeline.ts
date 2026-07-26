import { RasterSource, RasterMetadata, RasterProcessor, ProcessorContext, PipelineChangeEvent } from './types';

export class RasterPipeline implements RasterSource {
  private innerSource: RasterSource;
  private processors: RasterProcessor[] = [];
  public onPipelineChanged: ((event: PipelineChangeEvent) => void) | null = null;
  
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private messageIdCounter = 0;
  private pendingResolvers = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();
  public padding: number = 64;

  constructor(source: RasterSource, workerCount = 4, padding = 64) {
    this.innerSource = source;
    this.padding = padding;
    
    if (typeof window !== 'undefined') {
      for (let i = 0; i < workerCount; i++) {
        try {
          const worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url));
          worker.onmessage = this.handleMessage.bind(this);
          worker.onerror = (err) => {
            console.warn("RasterPipeline Web Worker error, falling back:", err);
            try {
              worker.terminate();
            } catch (ignore) {}
            this.workers = this.workers.filter(w => w !== worker);
          };
          this.workers.push(worker);
        } catch (e) {
          console.error("Failed to construct Web Worker for RasterPipeline:", e);
          break; // Avoid spamming multiple errors
        }
      }
    }
  }

  private handleMessage(e: MessageEvent) {
    const { type, id, payload } = e.data;
    const resolver = this.pendingResolvers.get(id);
    
    if (resolver) {
      if (type === 'PROCESS_RESULT') {
        resolver.resolve(payload.bitmap);
        this.pendingResolvers.delete(id);
      } else if (type === 'PROCESS_ERROR') {
        resolver.reject(new Error(payload.error));
        this.pendingResolvers.delete(id);
      }
    }
  }

  addProcessor(processor: RasterProcessor) {
    this.processors.push(processor);
    this.notifyChange({ type: 'added', processorId: processor.id });
  }

  removeProcessor(id: string) {
    this.processors = this.processors.filter(p => {
      if (p.id === id) {
        if (p.dispose) p.dispose();
        return false;
      }
      return true;
    });
    this.notifyChange({ type: 'removed', processorId: id });
  }
  
  updateProcessor(id: string, updates: Partial<RasterProcessor>) {
    const processor = this.processors.find(p => p.id === id);
    if (processor) {
      Object.assign(processor, updates);
      this.notifyChange({ type: 'updated', processorId: id });
    }
  }

  clearProcessors() {
    this.processors.forEach(p => {
      if (p.dispose) p.dispose();
    });
    this.processors = [];
    this.notifyChange({ type: 'cleared' });
  }
  
  getProcessors(): RasterProcessor[] {
    return this.processors;
  }
  
  private notifyChange(event: PipelineChangeEvent) {
    if (this.onPipelineChanged) {
      this.onPipelineChanged(event);
    }
  }

  async open(fileOrUrl: any): Promise<void> {
    return this.innerSource.open(fileOrUrl);
  }

  getMetadata(): RasterMetadata {
    return this.innerSource.getMetadata();
  }

  async getThumbnail(maxDimension: number): Promise<ImageBitmap | null> {
    if (this.innerSource.getThumbnail) {
      return this.innerSource.getThumbnail(maxDimension);
    }
    return null;
  }

  async getTile(level: number, tileIndex: number, bounds: { x: number, y: number, width: number, height: number }): Promise<ImageBitmap> {
    const activeProcessors = this.processors.filter(p => p.enabled);
    if (activeProcessors.length === 0) {
      return this.innerSource.getTile(level, tileIndex, bounds);
    }

    // Decoding halo/padding to prevent spatial artifacts at tile boundaries
    const padding = this.padding; 
    
    const meta = this.getMetadata();
    // Clamp padding to image boundaries
    const padLeft = Math.min(padding, bounds.x);
    const padTop = Math.min(padding, bounds.y);
    const padRight = Math.min(padding, meta.width - (bounds.x + bounds.width));
    const padBottom = Math.min(padding, meta.height - (bounds.y + bounds.height));

    const paddedBounds = {
      x: bounds.x - padLeft,
      y: bounds.y - padTop,
      width: bounds.width + padLeft + padRight,
      height: bounds.height + padTop + padBottom
    };

    let bitmap = await this.innerSource.getTile(level, tileIndex, paddedBounds);

    if (this.workers.length === 0) {
      // Fallback for non-browser environments or when workers fail
      const context: ProcessorContext = {
        level,
        tileIndex,
        bounds: { ...paddedBounds },
        metadata: { ...meta }
      };

      let imageData = this.bitmapToImageData(bitmap, paddedBounds.width, paddedBounds.height);
      bitmap.close();

      for (const processor of activeProcessors) {
        try {
          imageData = await processor.process(imageData, context);
        } catch (err) {
          console.error(`Processor ${processor.name} failed`, err);
        }
      }

      if (padLeft > 0 || padTop > 0 || padRight > 0 || padBottom > 0) {
        return await createImageBitmap(imageData, padLeft, padTop, bounds.width, bounds.height);
      } else {
        return await createImageBitmap(imageData);
      }
    }

    const id = this.messageIdCounter++;
    const workerIndex = this.nextWorkerIndex;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    const worker = this.workers[workerIndex];

    const processorsConfig = activeProcessors.map(p => {
       const config: any = { ...p };
       // Ensure methods are not passed
       return JSON.parse(JSON.stringify(config));
    });

    const context: ProcessorContext = {
      level,
      tileIndex,
      bounds: { ...paddedBounds },
      metadata: { ...meta }
    };

    let timeoutId: any;
    const timeoutPromise = new Promise<ImageBitmap>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Pipeline worker timeout"));
      }, 1500);
    });

    const workerPromise = new Promise<ImageBitmap>((resolve, reject) => {
      this.pendingResolvers.set(id, { 
        resolve: (b) => {
          clearTimeout(timeoutId);
          resolve(b);
        }, 
        reject: (e) => {
          clearTimeout(timeoutId);
          reject(e);
        } 
      });
      worker.postMessage({
        type: 'PROCESS_TILE',
        id,
        payload: {
          bitmap,
          bounds: { 
            width: paddedBounds.width, 
            height: paddedBounds.height,
            originalWidth: bounds.width,
            originalHeight: bounds.height
          },
          padding: {
            left: padLeft,
            top: padTop,
            right: padRight,
            bottom: padBottom
          },
          processorsConfig,
          context
        }
      }, [bitmap]); // Transfer the bitmap
    });

    try {
      return await Promise.race([workerPromise, timeoutPromise]);
    } catch (err) {
      console.warn("Pipeline worker stalled or failed, falling back to main-thread processing:", err);
      this.workers = [];
      
      const freshBitmap = await this.innerSource.getTile(level, tileIndex, paddedBounds);
      
      const fbContext: ProcessorContext = {
        level,
        tileIndex,
        bounds: { ...paddedBounds },
        metadata: { ...meta }
      };

      let imageData = this.bitmapToImageData(freshBitmap, paddedBounds.width, paddedBounds.height);
      freshBitmap.close();

      for (const processor of activeProcessors) {
        try {
          imageData = await processor.process(imageData, fbContext);
        } catch (procErr) {
          console.error(`Processor ${processor.name} failed`, procErr);
        }
      }

      if (padLeft > 0 || padTop > 0 || padRight > 0 || padBottom > 0) {
        return await createImageBitmap(imageData, padLeft, padTop, bounds.width, bounds.height);
      } else {
        return await createImageBitmap(imageData);
      }
    }
  }
  
  private bitmapToImageData(bitmap: ImageBitmap, width: number, height: number): ImageData {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }
    
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  cancelTile(level: number, tileIndex: number): void {
    if (this.innerSource.cancelTile) {
      this.innerSource.cancelTile(level, tileIndex);
    }
  }

  dispose(): void {
    this.clearProcessors();
    this.innerSource.dispose();
  }
}
