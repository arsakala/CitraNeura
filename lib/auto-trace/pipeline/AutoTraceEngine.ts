/**
 * Scientific Core Auto-Trace Engine.
 * 
 * Coordinates:
 * 1. Candidate Extraction (Ridge Filter + Peak Prominence + Grid Suppression + Subpixel Estimation)
 * 2. Second-Order Dynamic Programming
 * 3. Honest Gap Refinement (NaN Semantics)
 * 4. Geometry Quality Assessment (Q_v2d Worst-Of Aggregation)
 * 5. Deterministic Hash Verification
 */

import { AutoTraceParameters, validateParameters } from '../model/Parameters';
import { RowCandidateSet, CandidatePoint } from '../model/CandidateRow';
import { AutoTraceResult } from '../model/TraceResult';
import { RidgeFilter } from '../candidate/RidgeFilter';
import { PeakDetector } from '../candidate/PeakDetector';
import { SubpixelEstimator } from '../candidate/SubpixelEstimator';
import { GridSuppressor } from '../candidate/GridSuppressor';
import { DynamicProgram } from '../dp/DynamicProgram';
import { GapRefiner } from '../dp/GapRefiner';
import { QualityScore } from '../quality/QualityScore';
import { autotraceV2 } from './autotraceV2';
import { Matrix2D } from '../model/Matrix';

export interface RawRasterInput {
  imageData: ImageData;
  trackLeft: number;
  trackRight: number;
  seedX: number;
  seedY: number;
  targetRGB: { r: number; g: number; b: number };
}

export class AutoTraceEngine {
  /**
   * Simple deterministic FNV-1a 32-bit hash function for string inputs.
   */
  private static computeHash(data: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Executes full production auto-trace pipeline over a raster track section.
   * 
   * @param input Raw raster input parameters
   * @param rawParams Optional override parameters (validated strictly)
   * @returns Fully structured, deterministic AutoTraceResult
   */
  public static execute(input: RawRasterInput, rawParams?: unknown): AutoTraceResult {
    const startTime = performance.now();

    // 1. Validate parameters with fail-loud behavior
    const params: AutoTraceParameters = validateParameters(rawParams || {});

    const { imageData, trackLeft, trackRight, targetRGB } = input;
    const width = imageData.width;
    const height = imageData.height;

    if (trackLeft < 0 || trackRight >= width || trackLeft >= trackRight) {
      throw new RangeError(`[AutoTraceEngine] Invalid track boundaries [${trackLeft}, ${trackRight}] for raster width ${width}.`);
    }

    const data = imageData.data;
    const targetLab = RidgeFilter.rgbToLab(targetRGB.r, targetRGB.g, targetRGB.b);

    // Initialize Grid Suppressor
    const gridSuppressor = new GridSuppressor();
    gridSuppressor.analyzeGridStructure(imageData, trackLeft, trackRight);

    // 2. Candidate Extraction across every row y = 0 .. height-1
    const rowCandidateSets: RowCandidateSet[] = [];

    for (let y = 0; y < height; y++) {
      const rowLen = trackRight - trackLeft + 1;
      const rowGray = new Float32Array(rowLen);

      // Extract row grayscale and compute CIELAB color distances
      for (let x = trackLeft; x <= trackRight; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const localX = x - trackLeft;
        rowGray[localX] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
      }

      // 2a. Gaussian matched filter ridge response along row
      const ridgeResponse = RidgeFilter.filterRowMatched(rowGray, params.lineWidthSigma, true);

      // 2b. Peak prominence detection
      const rawPeaks = PeakDetector.findPeaks(ridgeResponse, params.minProminence, params.maxCandidatesPerRow);

      // 2c. Build CandidatePoints with parabolic subpixel estimation
      const candidates: CandidatePoint[] = [];

      for (let i = 0; i < rawPeaks.length; i++) {
        const p = rawPeaks[i];
        const globalX = trackLeft + p.x;
        const subOffset = SubpixelEstimator.estimateOffset(ridgeResponse, p.x);
        const subX = globalX + subOffset;

        const idx = (y * width + globalX) * 4;
        const pixelLab = RidgeFilter.rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
        const colorDist = RidgeFilter.deltaELab(pixelLab, targetLab);

        candidates.push({
          x: globalX,
          subpixelX: subX,
          subpixelOffset: subOffset,
          intensity: rowGray[p.x],
          ridgeResponse: p.ridgeVal,
          prominence: p.prominence,
          colorDistance: colorDist,
          labColor: pixelLab,
          isGridLine: false
        });
      }

      // 2d. Apply grid suppression
      const filteredCandidates = gridSuppressor.filterCandidates(candidates, y);

      rowCandidateSets.push({
        rowIndex: y,
        candidates: filteredCandidates,
        isEmpty: filteredCandidates.length === 0
      });
    }

    // 3. Second-Order Dynamic Programming Path Optimization
    const dpSolution = DynamicProgram.solve(rowCandidateSets, params);

    // 4. Gap Refinement & NaN Semantics
    const { points, gaps } = GapRefiner.refine(dpSolution);

    // 5. Quality Scoring (Q_v2d Worst-Of Aggregation)
    const quality = QualityScore.evaluate(points, gaps);

    const executionTimeMs = Number((performance.now() - startTime).toFixed(2));

    // 6. Compute Deterministic SHA/Hex Checksum
    const serializedOutput = points.map(p => `${p.y}:${Number.isNaN(p.x) ? 'NaN' : p.x.toFixed(3)}`).join(';');
    const deterministicHash = this.computeHash(serializedOutput);

    let v2Result;
    if (height >= 3) {
      try {
        const regionData = new Float64Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            regionData[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
          }
        }
        const region: Matrix2D = { rows: height, cols: width, data: regionData };
        v2Result = autotraceV2(region, { colOffset: trackLeft, rowOffset: 0 });
      } catch {
        // v2 estimator optional fallback
      }
    }

    return {
      points,
      gaps,
      quality,
      executionTimeMs,
      deterministicHash,
      v2Result
    };
  }
}
