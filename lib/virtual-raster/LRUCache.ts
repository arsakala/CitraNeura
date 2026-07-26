import { Tile } from './types';

export class LRUCache {
  private tiles: Map<string, Tile> = new Map();
  private maxMemoryBytes: number;
  private currentMemoryBytes: number = 0;

  constructor(maxMemoryBytes: number = 100 * 1024 * 1024) { // Default 100 MB
    this.maxMemoryBytes = maxMemoryBytes;
  }

  private getTileId(level: number, index: number): string {
    return `${level}-${index}`;
  }

  getMetadata(id: string): Tile | undefined {
    return this.tiles.get(id);
  }

  getBitmap(id: string): ImageBitmap | null {
    const tile = this.tiles.get(id);
    if (tile && tile.bitmap) {
      tile.lastAccess = Date.now();
      return tile.bitmap;
    }
    return null;
  }

  set(tile: Tile) {
    const id = this.getTileId(tile.level, tile.index);
    const existing = this.tiles.get(id);

    if (existing && existing !== tile && existing.bitmap) {
      existing.bitmap.close();
    }

    this.tiles.set(id, tile);
    this.recalculateMemory();
    this.evictToFit();
  }

  notifyTileUpdated() {
    this.recalculateMemory();
    this.evictToFit();
  }

  private recalculateMemory() {
    let mem = 0;
    for (const t of this.tiles.values()) {
      if (t.bitmap) mem += t.memorySize;
    }
    this.currentMemoryBytes = mem;
  }
  
  has(level: number, index: number): boolean {
    return this.tiles.has(this.getTileId(level, index));
  }
  
  get(level: number, index: number): Tile | undefined {
    const tile = this.tiles.get(this.getTileId(level, index));
    if (tile) {
      tile.lastAccess = Date.now();
    }
    return tile;
  }

  private evictToFit() {
    while (this.currentMemoryBytes > this.maxMemoryBytes && this.tiles.size > 0) {
      this.evictOldest();
    }
  }

  evictOldest() {
    let oldestId: string | null = null;
    let oldestAccess = Infinity;

    for (const [id, tile] of this.tiles.entries()) {
      // Only evict tiles that have a bitmap (to reclaim memory) and are not currently VISIBLE
      if (tile.bitmap && tile.state !== 'VISIBLE' && tile.state !== 'LOADING') {
        if (tile.lastAccess < oldestAccess) {
          oldestAccess = tile.lastAccess;
          oldestId = id;
        }
      }
    }

    if (oldestId) {
      const tile = this.tiles.get(oldestId)!;
      if (tile.bitmap) {
        this.currentMemoryBytes -= tile.memorySize;
        tile.bitmap.close();
        tile.bitmap = null;
      }
      tile.state = 'EVICTED';
    }
  }

  clear() {
    for (const tile of this.tiles.values()) {
      if (tile.bitmap) {
        tile.bitmap.close();
      }
      tile.state = 'UNLOADED';
      tile.bitmap = null;
    }
    this.currentMemoryBytes = 0;
    this.tiles.clear();
  }

  getMemoryUsage(): number {
    return this.currentMemoryBytes;
  }
  
  getMaxMemory(): number {
    return this.maxMemoryBytes;
  }
  
  getTilesCount(): number {
    return this.tiles.size;
  }
}
