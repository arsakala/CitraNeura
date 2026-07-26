import { VerticalRunFlag } from "../model/TraceResult";
import { VRUN_MIN_ROWS, VRUN_TOL_PX } from "../model/Parameters";

/**
 * Maximal runs of >= VRUN_MIN_ROWS consecutive valid rows whose x stays
 * within a +/-VRUN_TOL_PX band — direct port of vertical_runs. The engine
 * cannot know whether such a run is a captured grid line or a real
 * pegged/flatlining curve, so these are FLAGS for human review (§N5), never
 * corrections: points are not touched.
 */
export function verticalRuns(pixelX: Float64Array): VerticalRunFlag[] {
  const xs = pixelX;
  const out: VerticalRunFlag[] = [];
  const n = xs.length;
  let i = 0;
  while (i < n) {
    if (Number.isNaN(xs[i]!)) {
      i += 1;
      continue;
    }
    let j = i;
    let lo = xs[i]!;
    let hi = xs[i]!;
    while (j + 1 < n && !Number.isNaN(xs[j + 1]!)) {
      const nlo = Math.min(lo, xs[j + 1]!);
      const nhi = Math.max(hi, xs[j + 1]!);
      if (nhi - nlo > 2.0 * VRUN_TOL_PX) break;
      lo = nlo;
      hi = nhi;
      j += 1;
    }
    if (j - i + 1 >= VRUN_MIN_ROWS) {
      let sum = 0.0;
      for (let r = i; r <= j; r++) sum += xs[r]!;
      out.push({ rowStart: i, rowEndExclusive: j + 1, meanX: sum / (j - i + 1) });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}
