import { 
  Tile, 
  RasterSource, 
  ViewportState, 
  RasterMetadata, 
  RasterDebugStats,
  DecodeJob,
  VirtualRasterConfig
} from './types';
import { LRUCache } from './LRUCache';
import { WorkerPool } from './WorkerPool';
import { RequestScheduler } from './RequestScheduler';

export class VirtualRaster {
  private source: RasterSource | null = null;
  private cache: LRUCache;
  private workerPool: WorkerPool;
  private scheduler: RequestScheduler;
  
  private metadata: RasterMetadata | null = null;
  public config: VirtualRasterConfig;
  private isPaused: boolean = false;
  
  // Stats
  private stats: RasterDebugStats = {
    activeTiles: 0,
    cachedTiles: 0,
    memoryUsage: 0,
    cacheHitRatio: 0,
    cacheMissRatio: 0,
    decodeQueueLength: 0,
    workerUtilization: 0,
    peakWorkerUtilization: 0,
    cancelledJobs: 0,
    averageRenderLatency: 0,
    averageFrameTime: 0
  };
  
  private hits = 0;
  private misses = 0;

  public onTileLoaded?: (tile: Tile) => void;
  public onQueueStateChanged?: (queueLength: number) => void;

  public setOnTileLoaded(callback: (tile: Tile) => void) {
    this.onTileLoaded = callback;
  }
  
  public setOnQueueStateChanged(callback: (queueLength: number) => void) {
    this.onQueueStateChanged = callback;
  }

  constructor(config?: Partial<VirtualRasterConfig>) {
    this.config = {
      maxCacheMemoryBytes: config?.maxCacheMemoryBytes || 100 * 1024 * 1024,
      tileHeight: config?.tileHeight || 2048,
      maxWorkers: config?.maxWorkers || (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4),
      prefetchForward: config?.prefetchForward ?? 2,
      prefetchBackward: config?.prefetchBackward ?? 1
    };

    this.cache = new LRUCache(this.config.maxCacheMemoryBytes);
    this.workerPool = new WorkerPool(this.config.maxWorkers);
    this.scheduler = new RequestScheduler(this.workerPool);
  }

  getConfig(): VirtualRasterConfig {
    return this.config;
  }

  async load(source: RasterSource): Promise<void> {
    this.dispose();
    this.source = source;
    this.workerPool.setSource(source);
    
    if ('onPipelineChanged' in source) {
      (source as any).onPipelineChanged = (event: any) => {
        this.clearCache();
        // The next render cycle will automatically request the visible tiles.
        // Or we could proactively call updateViewport if we kept track of the last viewport state.
      };
    }

    // We expect source.open() to have been called by the consumer, or we can call it here.
    // Let's assume the consumer calls source.open(), but we get metadata here.
    this.metadata = this.source.getMetadata();
  }

  dispose(): void {
    this.clearCache();
    if (this.source) {
      this.source.dispose();
      this.source = null;
    }
    this.metadata = null;
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  reset(): void {
    this.clearCache();
    // Additional reset logic if needed
  }

  getTile(level: number, index: number): Tile {
    if (!this.metadata) {
      throw new Error("VirtualRaster not loaded");
    }

    const id = `${level}-${index}`;
    let tile = this.cache.get(level, index);

    if (!tile) {
      // Create metadata entry if it doesn't exist
      const y = index * this.config.tileHeight;
      const h = Math.min(this.config.tileHeight, this.metadata.height - y);
      
      tile = {
        level,
        index,
        pixelBounds: { x: 0, y, width: this.metadata.width, height: h },
        bitmap: null,
        state: 'UNLOADED',
        lastAccess: Date.now(),
        // Estimate memory size (width * height * 4 bytes for RGBA)
        memorySize: this.metadata.width * h * 4 
      };
      this.cache.set(tile);
    }

    if (tile.state === 'UNLOADED' || tile.state === 'EVICTED') {
      this.misses++;
      this.requestTileLoad(tile, 'VISIBLE'); // Default priority if requested directly
    } else if (tile.state === 'READY' || tile.state === 'VISIBLE' || tile.state === 'CACHED') {
      this.hits++;
    }

    this.updateStats();
    return tile;
  }

  updateViewport(viewport: ViewportState): void {
    if (this.isPaused || !this.metadata) return;

    const startY = viewport.visibleBounds.y;
    const endY = viewport.visibleBounds.y + viewport.visibleBounds.height;
    
    const startIdx = Math.floor(Math.max(0, startY) / this.config.tileHeight);
    const endIdx = Math.floor(Math.min(this.metadata.height, endY) / this.config.tileHeight);
    
    const visibleIndices = new Set<number>();
    for (let i = startIdx; i <= endIdx; i++) {
      visibleIndices.add(i);
    }

    // Prefetch logic
    let prefetchIndices = new Set<number>();
    if (viewport.direction === 'down') {
      for (let i = 1; i <= this.config.prefetchForward; i++) prefetchIndices.add(endIdx + i);
      for (let i = 1; i <= this.config.prefetchBackward; i++) prefetchIndices.add(startIdx - i);
    } else if (viewport.direction === 'up') {
      for (let i = 1; i <= this.config.prefetchForward; i++) prefetchIndices.add(startIdx - i);
      for (let i = 1; i <= this.config.prefetchBackward; i++) prefetchIndices.add(endIdx + i);
    }

    // Schedule Visible Tiles
    for (const idx of visibleIndices) {
      if (idx >= 0 && idx * this.config.tileHeight < this.metadata.height) {
        const tile = this.getTile(0, idx); // Always level 0 for now
        tile.state = tile.bitmap ? 'VISIBLE' : tile.state;
        if (tile.state === 'UNLOADED' || tile.state === 'EVICTED') {
          this.requestTileLoad(tile, 'VISIBLE');
        }
      }
    }

    // Schedule Prefetch Tiles
    for (const idx of prefetchIndices) {
      if (idx >= 0 && idx * this.config.tileHeight < this.metadata.height) {
        if (!visibleIndices.has(idx)) {
          const tile = this.getTile(0, idx);
          if (tile.state === 'UNLOADED' || tile.state === 'EVICTED') {
            this.requestTileLoad(tile, 'PREFETCH');
          } else if (tile.bitmap) {
            tile.state = 'CACHED';
          }
        }
      }
    }

    const requiredIndices = new Set([...visibleIndices, ...prefetchIndices]);
    
    // Cancel jobs and update states for tiles no longer needed
    const maxIndex = Math.ceil(this.metadata.height / this.config.tileHeight);
    for (let i = 0; i <= maxIndex; i++) {
      if (!requiredIndices.has(i)) {
        const tile = this.cache.get(0, i);
        if (tile && tile.state === 'LOADING') {
          tile.state = 'UNLOADED';
          this.scheduler.cancel(`0-${i}`);
        } else if (tile && (tile.state === 'VISIBLE' || tile.state === 'READY')) {
          tile.state = 'CACHED';
        }
      }
    }
  }

  private requestTileLoad(tile: Tile, priority: 'VISIBLE' | 'PREFETCH') {
    tile.state = 'LOADING';
    const job: DecodeJob = {
      id: `${tile.level}-${tile.index}`,
      level: tile.level,
      index: tile.index,
      bounds: tile.pixelBounds,
      priority,
      timestamp: Date.now()
    };

    const promise = this.scheduler.schedule(job);
    this.updateStats();
    
    promise.then(bitmap => {
      // It's possible the tile was evicted while loading
      const currentTile = this.cache.get(tile.level, tile.index);
      if (currentTile) {
        currentTile.bitmap = bitmap;
        currentTile.state = priority === 'VISIBLE' ? 'VISIBLE' : 'READY';
        this.cache.notifyTileUpdated(); // Updates memory accounting
        if (this.onTileLoaded) this.onTileLoaded(currentTile);
      } else {
        bitmap.close(); // Tile was removed from cache metadata
      }
      this.updateStats();
    }).catch(err => {
      this.updateStats();
      if (err.message.includes('cancelled')) return; // Ignore cancellations
      console.warn(`Failed to load tile ${job.id}`, err);
      const currentTile = this.cache.get(tile.level, tile.index);
      if (currentTile) {
        currentTile.state = 'ERROR';
      }
    });
  }

  clearCache(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.updateStats();
  }

  getMetadata(): RasterMetadata {
    if (!this.metadata) throw new Error("Not loaded");
    return this.metadata;
  }

  async getThumbnail(maxDimension: number = 1000): Promise<ImageBitmap | null> {
    if (!this.source) throw new Error("Not loaded");
    if (this.source.getThumbnail) {
      return this.source.getThumbnail(maxDimension);
    }
    return null;
  }

  getCachedImageData(x: number, y: number, width: number, height: number): ImageData | null {
    if (!this.metadata) return null;

    // Create a temporary canvas to aggregate pixels
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const startIdx = Math.floor(y / this.config.tileHeight);
    const endIdx = Math.floor((y + height - 1) / this.config.tileHeight);

    for (let i = startIdx; i <= endIdx; i++) {
      const tile = this.cache.get(0, i);
      if (tile && tile.bitmap) {
        // Draw the part of the tile that intersects the requested rect
        const tileY = i * this.config.tileHeight;
        
        const srcX = x; // assuming we need the full width from x
        const srcY = Math.max(0, y - tileY);
        const srcW = width;
        const srcH = Math.min(this.config.tileHeight - srcY, height - (Math.max(0, tileY - y)));

        const destX = 0;
        const destY = Math.max(0, tileY - y);

        // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        // Wait, if x + width is beyond tile.pixelBounds.width, we need to clamp.
        const clampSrcW = Math.min(srcW, tile.pixelBounds.width - srcX);
        if (clampSrcW > 0 && srcH > 0) {
           ctx.drawImage(tile.bitmap, srcX, srcY, clampSrcW, srcH, destX, destY, clampSrcW, srcH);
        }
      } else {
         // If a tile is missing, we might want to return what we have (transparent pixels for that part)
      }
    }

    return ctx.getImageData(0, 0, width, height);
  }

  async getImageData(x: number, y: number, width: number, height: number): Promise<ImageData | null> {
    if (!this.metadata) return null;
    
    // First, try cached
    let allCached = true;
    const startIdx = Math.floor(y / this.config.tileHeight);
    const endIdx = Math.floor((y + height - 1) / this.config.tileHeight);
    
    for (let i = startIdx; i <= endIdx; i++) {
      const tile = this.cache.get(0, i);
      if (!tile || !tile.bitmap) {
        allCached = false;
        break;
      }
    }
    
    if (allCached) {
      return this.getCachedImageData(x, y, width, height);
    }
    
    // Some tiles are missing, wait for them
    const promises: Promise<ImageBitmap>[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const tile = this.getTile(0, i);
      if (tile.bitmap) {
        promises.push(Promise.resolve(tile.bitmap));
      } else {
        // Schedule it manually if it's not already loading, or wait for it.
        // Actually, requestTileLoad doesn't return a promise.
        // Let's create a temporary job directly.
        if (!this.source) throw new Error("No source");
        const job = {
          id: `sync-${Date.now()}-${i}`,
          level: 0,
          index: i,
          bounds: tile.pixelBounds,
          priority: 'INTERACTION' as any,
          timestamp: Date.now()
        };
        promises.push(this.scheduler.schedule(job).then(bitmap => {
          // Cache it for future use
          const currentTile = this.cache.get(0, i);
          if (currentTile) {
            currentTile.bitmap = bitmap;
            currentTile.state = 'READY';
          }
          return bitmap;
        }));
      }
    }
    
    await Promise.all(promises);
    return this.getCachedImageData(x, y, width, height);
  }

  getDebugStats(): RasterDebugStats {
    this.updateStats(false);
    return this.stats;
  }

  private updateStats(triggerCallback: boolean = true) {
    const totalRequests = this.hits + this.misses;
    
    this.stats.activeTiles = 0; // Requires tracking visible states better
    this.stats.cachedTiles = this.cache.getTilesCount();
    this.stats.memoryUsage = this.cache.getMemoryUsage();
    this.stats.cacheHitRatio = totalRequests > 0 ? this.hits / totalRequests : 0;
    this.stats.cacheMissRatio = totalRequests > 0 ? this.misses / totalRequests : 0;
    this.stats.decodeQueueLength = this.scheduler.queueLength;
    this.stats.workerUtilization = this.workerPool.stats.utilization;
    this.stats.peakWorkerUtilization = this.workerPool.stats.peakUtilization;
    this.stats.cancelledJobs = this.workerPool.stats.cancelledJobs;
    
    if (this.source && (this.source as any).metrics) {
       this.stats.averageTileExtractTime = (this.source as any).metrics.averageTileExtractTime;
       this.stats.averageTileBitmapTime = (this.source as any).metrics.averageTileBitmapTime;
    }
    
    if (triggerCallback && this.onQueueStateChanged) {
      if (this.stats.decodeQueueLength !== (this as any)._lastReportedQueueLength) {
        (this as any)._lastReportedQueueLength = this.stats.decodeQueueLength;
        this.onQueueStateChanged(this.stats.decodeQueueLength);
      }
    }
  }
}
