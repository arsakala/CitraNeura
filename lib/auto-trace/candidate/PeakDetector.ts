/**
 * Peak Detector with Peak Prominence Extraction.
 * 
 * Identifies local maxima in continuous ridge response signals and computes
 * topological peak prominence (height of peak above local baseline valleys).
 */

export interface RawPeak {
  x: number;
  ridgeVal: number;
  prominence: number;
}

export class PeakDetector {
  /**
   * Finds local maxima and calculates peak prominence for a 1D response array.
   * 
   * @param response 1D ridge response values [0, 1]
   * @param minProminence Minimum prominence required to retain peak
   * @param maxCandidates Maximum number of candidates to return (sorted by prominence)
   */
  public static findPeaks(
    response: Float32Array,
    minProminence: number,
    maxCandidates: number = 8
  ): RawPeak[] {
    const len = response.length;
    const rawPeaks: RawPeak[] = [];

    // 1. Identify local maxima: r[x-1] < r[x] >= r[x+1]
    for (let x = 1; x < len - 1; x++) {
      const val = response[x];
      if (val > response[x - 1] && val >= response[x + 1] && val > 0.01) {
        
        // 2. Compute peak prominence:
        // Extend left until finding a point higher than val, or boundary
        let leftMin = val;
        for (let l = x - 1; l >= 0; l--) {
          if (response[l] > val) break;
          if (response[l] < leftMin) leftMin = response[l];
        }

        // Extend right until finding a point higher than val, or boundary
        let rightMin = val;
        for (let r = x + 1; r < len; r++) {
          if (response[r] > val) break;
          if (response[r] < rightMin) rightMin = response[r];
        }

        // Prominence is peak height above highest of the two surrounding valleys
        const baseline = Math.max(leftMin, rightMin);
        const prominence = Math.max(0, val - baseline);

        if (prominence >= minProminence) {
          rawPeaks.push({
            x,
            ridgeVal: val,
            prominence
          });
        }
      }
    }

    // Sort by prominence descending
    rawPeaks.sort((a, b) => b.prominence - a.prominence);

    // Limit to maxCandidates
    return rawPeaks.slice(0, maxCandidates);
  }
}
