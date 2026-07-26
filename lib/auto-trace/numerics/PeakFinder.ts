export interface PeakFinderOpts {
  prominenceMin: number;
  widthMax?: number;
}

export interface PeakFinderResult {
  peaks: number[];
  prominences: number[];
}

export function findPeaks(row: Float64Array, opts: PeakFinderOpts): PeakFinderResult {
  const peaks: number[] = [];
  const prominences: number[] = [];
  const len = row.length;

  for (let i = 1; i < len - 1; i++) {
    const val = row[i]!;
    if (val > row[i - 1]! && val >= row[i + 1]!) {
      let leftMin = val;
      for (let l = i - 1; l >= 0; l--) {
        if (row[l]! < leftMin) leftMin = row[l]!;
        if (row[l]! > val) break;
      }

      let rightMin = val;
      for (let r = i + 1; r < len; r++) {
        if (row[r]! < rightMin) rightMin = row[r]!;
        if (row[r]! > val) break;
      }

      const baseline = Math.max(leftMin, rightMin);
      const prominence = val - baseline;

      if (prominence >= opts.prominenceMin) {
        if (opts.widthMax !== undefined && opts.widthMax > 0) {
          const halfVal = val - 0.5 * prominence;
          let leftX = i;
          while (leftX > 0 && row[leftX]! > halfVal) leftX--;
          let rightX = i;
          while (rightX < len - 1 && row[rightX]! > halfVal) rightX++;
          const width = rightX - leftX;
          if (width > opts.widthMax) continue;
        }

        peaks.push(i);
        prominences.push(prominence);
      }
    }
  }

  return { peaks, prominences };
}
