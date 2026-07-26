import { DecodeJob, RasterSource } from './types';

export class WorkerPool {
  private maxWorkers: number;
  private activeWorkers: number = 0;
  private rasterSource: RasterSource | null = null;
  // To track cancellations
  private cancelledJobs: Set<string> = new Set();
  public stats = {
    utilization: 0,
    peakUtilization: 0,
    cancelledJobs: 0
  };

  constructor(maxWorkers: number = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4) {
    this.maxWorkers = maxWorkers;
  }

  setSource(source: RasterSource) {
    this.rasterSource = source;
  }

  async dispatch(job: DecodeJob): Promise<ImageBitmap> {
    if (!this.rasterSource) {
      throw new Error("RasterSource not set in WorkerPool");
    }

    if (this.cancelledJobs.has(job.id)) {
      this.cancelledJobs.delete(job.id);
      throw new Error(`Job ${job.id} cancelled`);
    }

    this.activeWorkers++;
    this.updateUtilization();

    try {
      // In Phase 1, we directly call the source. 
      // In the future, this will use postMessage to actual Web Workers.
      const bitmap = await this.rasterSource.getTile(job.level, job.index, job.bounds);
      
      if (this.cancelledJobs.has(job.id)) {
        this.cancelledJobs.delete(job.id);
        bitmap.close();
        throw new Error(`Job ${job.id} cancelled after decode`);
      }
      return bitmap;
    } finally {
      this.activeWorkers--;
      this.updateUtilization();
    }
  }

  cancel(jobId: string) {
    this.cancelledJobs.add(jobId);
    this.stats.cancelledJobs++;
    
    if (this.rasterSource && this.rasterSource.cancelTile) {
      const parts = jobId.split('-');
      if (parts.length === 2) {
        this.rasterSource.cancelTile(parseInt(parts[0]), parseInt(parts[1]));
      }
    }
  }
  
  get activeCount() {
    return this.activeWorkers;
  }
  
  get maxCount() {
    return this.maxWorkers;
  }

  private updateUtilization() {
    this.stats.utilization = this.activeWorkers / this.maxWorkers;
    if (this.stats.utilization > this.stats.peakUtilization) {
      this.stats.peakUtilization = this.stats.utilization;
    }
  }
}
