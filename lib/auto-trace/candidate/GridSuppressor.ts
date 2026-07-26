/**
 * Periodic Grid Line Artifact Suppressor.
 * 
 * Identifies vertical and horizontal grid lines running across well log tracks and penalizes / suppresses
 * peak candidates that coincide with background grid lines rather than physical log curves.
 */

import { CandidatePoint } from '../model/CandidateRow';

export class GridSuppressor {
  private gridXPositions: Set<number> = new Set();
  private gridYPositions: Set<number> = new Set();
  private gridTolerance: number = 1; // +/- 1 pixel

  /**
   * Scans a full raster region to detect vertical and horizontal grid lines using relative local prominence.
   */
  public analyzeGridStructure(imageData: ImageData, trackLeft: number, trackRight: number): void {
    this.gridXPositions.clear();
    this.gridYPositions.clear();

    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const rowLen = Math.max(1, trackRight - trackLeft + 1);

    const colSums = new Float32Array(width);
    const rowSums = new Float32Array(height);

    for (let y = 0; y < height; y++) {
      for (let x = trackLeft; x <= trackRight && x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const darkVal = 255.0 - (0.299 * r + 0.587 * g + 0.114 * b);
        colSums[x] += darkVal;
        rowSums[y] += darkVal;
      }
    }

    // 1. Detect Vertical Grid Lines via Column Local Prominence
    const colMeans = new Float32Array(width);
    for (let x = trackLeft; x <= trackRight && x < width; x++) {
      colMeans[x] = colSums[x] / Math.max(1, height);
    }

    for (let x = trackLeft + 1; x < trackRight && x < width - 1; x++) {
      // Calculate local background excluding column x
      let bgSum = 0;
      let bgCount = 0;
      for (let dx = -4; dx <= 4; dx++) {
        if (dx === 0) continue;
        const neighborX = x + dx;
        if (neighborX >= trackLeft && neighborX <= trackRight) {
          bgSum += colMeans[neighborX];
          bgCount++;
        }
      }
      const localBg = bgCount > 0 ? bgSum / bgCount : colMeans[x];
      const prominence = colMeans[x] - localBg;

      // Vertical grid lines are persistent vertical features that stick out above local background
      if (prominence > 2.5) {
        this.gridXPositions.add(x);
        if (prominence > 5.0) {
          this.gridXPositions.add(x - 1);
          this.gridXPositions.add(x + 1);
        }
      }
    }

    // 2. Detect Horizontal Grid Lines via Row Local Prominence
    const rowMeans = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      rowMeans[y] = rowSums[y] / rowLen;
    }

    for (let y = 2; y < height - 2; y++) {
      let bgSum = 0;
      let bgCount = 0;
      for (let dy = -3; dy <= 3; dy++) {
        if (dy === 0) continue;
        const neighborY = y + dy;
        if (neighborY >= 0 && neighborY < height) {
          bgSum += rowMeans[neighborY];
          bgCount++;
        }
      }
      const localBg = bgCount > 0 ? bgSum / bgCount : rowMeans[y];
      const prominence = rowMeans[y] - localBg;

      if (prominence > 3.5) {
        this.gridYPositions.add(y);
        this.gridYPositions.add(y - 1);
        this.gridYPositions.add(y + 1);
      }
    }
  }

  /**
   * Annotates candidate points with grid line flags and heavily suppresses grid line response.
   */
  public filterCandidates(candidates: CandidatePoint[], yIndex?: number): CandidatePoint[] {
    const isHorizontalGridRow = yIndex !== undefined && this.gridYPositions.has(yIndex);

    return candidates.map(c => {
      let isVertGrid = false;
      for (let dx = -this.gridTolerance; dx <= this.gridTolerance; dx++) {
        if (this.gridXPositions.has(Math.round(c.x + dx))) {
          isVertGrid = true;
          break;
        }
      }

      if (isVertGrid || isHorizontalGridRow) {
        return {
          ...c,
          isGridLine: true,
          ridgeResponse: c.ridgeResponse * 0.1, // Heavily reduce ridge response for grid lines
          prominence: c.prominence * 0.1
        };
      }

      return c;
    });
  }
}

