import { RasterPipeline } from './RasterPipeline';
import { CLAHEProcessor } from './CLAHEProcessor';
import { DummyRasterSource } from './DummyRasterSource';

export class PipelineBenchmark {
  public static async runSuite() {
    console.log("%c=== Raster Pipeline Benchmark Suite ===", "color: blue; font-weight: bold; font-size: 14px;");
    await this.runBaselineVsPipeline();
    await this.runOverlapBenchmark();
    console.log("%c=== Benchmark Suite Completed ===", "color: blue; font-weight: bold;");
    
    console.log("%c--- Visual Validation Instructions ---", "font-weight: bold; color: green;");
    console.log("To validate halo/overlap artifacts:");
    console.log("1. Enable the CLAHE filter from the Raster Pipeline panel.");
    console.log("2. Zoom in very close (400% - 800%) to a region with high contrast changes.");
    console.log("3. Pan slowly across the image.");
    console.log("4. Ensure there are no sudden jumps in brightness, no visible seams, and the contrast remains continuous across tile boundaries.");
  }

  private static async runBaselineVsPipeline() {
    console.log("%c--- Test 1: Architecture Overhead ---", "font-weight: bold;");
    const source = new DummyRasterSource();
    await source.open(null);
    
    const tileBounds = { x: 1000, y: 1000, width: 256, height: 256 };

    // 1. Baseline
    let t0 = performance.now();
    for (let i = 0; i < 50; i++) {
       const bm = await source.getTile(0, 0, tileBounds);
       bm.close();
    }
    const baselineTime = performance.now() - t0;
    
    // 2. Pipeline Empty (Worker Transfer overhead)
    const pipelineEmpty = new RasterPipeline(source);
    t0 = performance.now();
    for (let i = 0; i < 50; i++) {
       const bm = await pipelineEmpty.getTile(0, 0, tileBounds);
       bm.close();
    }
    const emptyPipelineTime = performance.now() - t0;

    // 3. Pipeline + CLAHE
    const pipelineClahe = new RasterPipeline(source);
    pipelineClahe.addProcessor(new CLAHEProcessor());
    t0 = performance.now();
    for (let i = 0; i < 50; i++) {
       const bm = await pipelineClahe.getTile(0, 0, tileBounds);
       bm.close();
    }
    const claheTime = performance.now() - t0;

    console.table({
      "Baseline (No Pipeline)": { "Time (ms/tile)": (baselineTime / 50).toFixed(2) },
      "Pipeline (Empty)": { "Time (ms/tile)": (emptyPipelineTime / 50).toFixed(2) },
      "Pipeline (CLAHE)": { "Time (ms/tile)": (claheTime / 50).toFixed(2) }
    });
  }

  public static async runOverlapBenchmark() {
    console.log("%c--- Test 2: Halo/Padding Impact ---", "font-weight: bold;");
    const overlaps = [0, 32, 64, 128];
    const source = new DummyRasterSource();
    await source.open(null);
    const tileBounds = { x: 1000, y: 1000, width: 256, height: 256 };
    
    const results: Record<string, any> = {};

    for (const pad of overlaps) {
       const pipeline = new RasterPipeline(source, 4, pad);
       pipeline.addProcessor(new CLAHEProcessor());
       
       let total = 0;
       for(let i = 0; i < 10; i++) {
         const t0 = performance.now();
         const bm = await pipeline.getTile(0, 0, tileBounds);
         total += (performance.now() - t0);
         bm.close();
       }
       results[`Padding ${pad}px`] = { "Total Latency (ms/tile)": (total / 10).toFixed(2) };
    }
    
    console.table(results);
  }
}
