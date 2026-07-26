import { VirtualRaster } from './VirtualRaster';
import { DummyRasterSource } from './DummyRasterSource';

export class BenchmarkHarness {
  private vr: VirtualRaster;

  constructor() {
    // 50 MB cache limit for quicker eviction testing
    this.vr = new VirtualRaster({ maxCacheMemoryBytes: 50 * 1024 * 1024 });
  }

  async runSuite() {
    console.log("Starting Benchmark Suite...");
    const source = new DummyRasterSource();
    await this.vr.load(source);
    
    console.log("Loaded Metadata:", this.vr.getMetadata());

    // Simulate fast scrolling
    console.log("Simulating fast scrolling down...");
    for (let y = 0; y < 20000; y += 500) {
      this.vr.updateViewport({
        zoom: 1,
        visibleBounds: { x: 0, y, width: 2048, height: 1000 },
        scrollVelocity: { x: 0, y: 100 },
        direction: 'down'
      });
      // Small pause to allow scheduler to kick in
      await new Promise(r => setTimeout(r, 10));
    }
    
    this.printStats("After scrolling to Y=20000");

    // Wait for jobs to settle
    await new Promise(r => setTimeout(r, 1000));
    this.printStats("After settling");

    // Random access jumps
    console.log("Simulating random access jumps...");
    const jumps = [0, 45000, 10000, 30000];
    for (const y of jumps) {
      this.vr.updateViewport({
        zoom: 1,
        visibleBounds: { x: 0, y, width: 2048, height: 1000 },
        scrollVelocity: { x: 0, y: 0 },
        direction: 'none'
      });
      await new Promise(r => setTimeout(r, 50));
    }
    
    // Wait for jobs to settle
    await new Promise(r => setTimeout(r, 1000));
    this.printStats("After random jumps");

    console.log("Benchmark Suite Finished.");
  }

  private printStats(label: string) {
    const stats = this.vr.getDebugStats();
    console.log(`\n--- Stats: ${label} ---`);
    console.log(`Cached Tiles: ${stats.cachedTiles}`);
    console.log(`Memory Usage: ${(stats.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Hit Ratio: ${(stats.cacheHitRatio * 100).toFixed(1)}%`);
    console.log(`Miss Ratio: ${(stats.cacheMissRatio * 100).toFixed(1)}%`);
    console.log(`Queue Length: ${stats.decodeQueueLength}`);
    console.log(`Worker Utilization: ${(stats.workerUtilization * 100).toFixed(1)}%`);
    console.log(`Cancelled Jobs: ${stats.cancelledJobs}`);
  }
}
