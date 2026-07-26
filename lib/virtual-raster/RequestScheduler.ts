import { DecodeJob, JobPriority } from './types';
import { WorkerPool } from './WorkerPool';

export class RequestScheduler {
  private queue: DecodeJob[] = [];
  private workerPool: WorkerPool;
  private pendingJobs: Map<string, Promise<ImageBitmap>> = new Map();
  private processingJobs: Set<string> = new Set();
  
  // Priority values: lower number = higher priority
  private priorityMap: Record<JobPriority, number> = {
    'VISIBLE': 0,
    'INTERACTION': 1,
    'PREFETCH': 2,
    'BACKGROUND': 3
  };

  constructor(workerPool: WorkerPool) {
    this.workerPool = workerPool;
  }

  schedule(job: DecodeJob): Promise<ImageBitmap> {
    if (this.pendingJobs.has(job.id)) {
      // If we schedule the same job but maybe with different priority, update it
      const existingJob = this.queue.find(j => j.id === job.id);
      if (existingJob && this.priorityMap[job.priority] < this.priorityMap[existingJob.priority]) {
        existingJob.priority = job.priority;
        this.sortQueue();
      }
      return this.pendingJobs.get(job.id)!;
    }

    const promise = new Promise<ImageBitmap>((resolve, reject) => {
      // In a real scheduler, we would store resolve/reject and call them later
      // For now, we will just use an async loop or event-based approach.
      // We will attach them to the job object for internal tracking if needed.
      (job as any).resolve = resolve;
      (job as any).reject = reject;
    });

    this.pendingJobs.set(job.id, promise);
    this.queue.push(job);
    this.sortQueue();
    
    this.processQueue();
    
    return promise;
  }

  cancel(jobId: string) {
    const jobIndex = this.queue.findIndex(j => j.id === jobId);
    if (jobIndex >= 0) {
      const job = this.queue[jobIndex];
      this.queue.splice(jobIndex, 1);
      (job as any).reject(new Error(`Job ${jobId} cancelled`));
      this.pendingJobs.delete(jobId);
    } else if (this.processingJobs.has(jobId)) {
      this.workerPool.cancel(jobId);
      // The promise will reject from the worker pool
    }
  }

  private sortQueue() {
    this.queue.sort((a, b) => {
      if (this.priorityMap[a.priority] !== this.priorityMap[b.priority]) {
        return this.priorityMap[a.priority] - this.priorityMap[b.priority];
      }
      // If same priority, newer jobs first (LIFO for prefetch/visible might be better)
      return b.timestamp - a.timestamp;
    });
  }

  private async processQueue() {
    if (this.queue.length === 0) return;
    if (this.workerPool.activeCount >= this.workerPool.maxCount) return;

    const job = this.queue.shift()!;
    this.processingJobs.add(job.id);
    
    try {
      const bitmap = await this.workerPool.dispatch(job);
      this.pendingJobs.delete(job.id);
      this.processingJobs.delete(job.id);
      (job as any).resolve(bitmap);
    } catch (err) {
      this.pendingJobs.delete(job.id);
      this.processingJobs.delete(job.id);
      (job as any).reject(err);
    }

    // Try to process more
    this.processQueue();
  }
  
  get queueLength() {
    return this.queue.length + this.processingJobs.size;
  }
}
