export type TileState = 'UNLOADED' | 'LOADING' | 'READY' | 'VISIBLE' | 'CACHED' | 'EVICTED' | 'ERROR';

export interface Tile {
  level: number;
  index: number;
  pixelBounds: { x: number; y: number; width: number; height: number };
  bitmap: ImageBitmap | null;
  state: TileState;
  lastAccess: number;
  memorySize: number;
}

export interface RasterMetadata {
  width: number;
  height: number;
  fileSize: number;
  checksum?: string;
  [key: string]: any;
}

export interface ProcessorContext {
  readonly level: number;
  readonly tileIndex: number;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly metadata: Readonly<RasterMetadata>;
}

export interface RasterProcessor {
  id: string;
  name: string;
  enabled: boolean;
  process(data: ImageData, context: ProcessorContext): Promise<ImageData>;
  dispose?(): void;
}

export type PipelineChangeType = 'added' | 'removed' | 'updated' | 'cleared' | 'reordered';

export interface PipelineChangeEvent {
  type: PipelineChangeType;
  processorId?: string;
}

export interface RasterSource {
  open(fileOrUrl: any): Promise<void>;
  getMetadata(): RasterMetadata;
  getTile(level: number, tileIndex: number, bounds: { x: number, y: number, width: number, height: number }): Promise<ImageBitmap>;
  getThumbnail?(maxDimension: number): Promise<ImageBitmap | null>;
  cancelTile?(level: number, tileIndex: number): void;
  dispose(): void;
}

export interface ViewportState {
  zoom: number;
  visibleBounds: { x: number; y: number; width: number; height: number };
  scrollVelocity: { x: number; y: number };
  direction: 'up' | 'down' | 'left' | 'right' | 'none';
}

export interface VirtualRasterConfig {
  maxCacheMemoryBytes: number;
  tileHeight: number;
  maxWorkers: number;
  prefetchForward: number;
  prefetchBackward: number;
}

export interface RasterDebugStats {
  activeTiles: number;
  cachedTiles: number;
  memoryUsage: number;
  cacheHitRatio: number;
  cacheMissRatio: number;
  decodeQueueLength: number;
  workerUtilization: number;
  peakWorkerUtilization: number;
  cancelledJobs: number;
  averageRenderLatency: number;
  averageFrameTime: number;
  averageTileExtractTime?: number;
  averageTileBitmapTime?: number;
}

export type JobPriority = 'VISIBLE' | 'INTERACTION' | 'PREFETCH' | 'BACKGROUND';

export interface DecodeJob {
  id: string;
  level: number;
  index: number;
  bounds: { x: number, y: number, width: number, height: number };
  priority: JobPriority;
  timestamp: number;
}
