import { GeometryMetrics as GeometryMetricsType, TracedPoint } from "../model/TraceResult";
import { uniformFilter1dNearestOdd } from "../numerics/UniformFilter";
import { rfft, rfftfreq, irfft } from "../numerics/RealFFT";
import { mean } from "../numerics/Stats";
import { HF_CUTOFF_CYCLES_PER_ROW, HF_DETREND_WINDOW_ROWS, DIR_DEADBAND_PX } from "../model/Parameters";

export function hysteresisReversalCount(xsValid: ArrayLike<number>, delta: number): number {
  let count = 0;
  let direction = 0;
  let extreme = xsValid[0]!;
  for (let i = 1; i < xsValid.length; i++) {
    const v = xsValid[i]!;
    if (direction === 0) {
      if (v > extreme + delta) {
        direction = 1;
        extreme = v;
      } else if (v < extreme - delta) {
        direction = -1;
        extreme = v;
      }
    } else if (direction === 1) {
      if (v > extreme) {
        extreme = v;
      } else if (v < extreme - delta) {
        count += 1;
        direction = -1;
        extreme = v;
      }
    } else {
      if (v < extreme) {
        extreme = v;
      } else if (v > extreme + delta) {
        count += 1;
        direction = 1;
        extreme = v;
      }
    }
  }
  return count;
}

export function hysteresisDirChangesPer100(xsValid: ArrayLike<number>, delta = DIR_DEADBAND_PX): number {
  const n = xsValid.length;
  if (n < 3) return 0.0;
  return (100.0 * hysteresisReversalCount(xsValid, delta)) / Math.max(1, n - 1);
}

export function validSegments(xs: Float64Array): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let start: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    const ok = !Number.isNaN(xs[i]!);
    if (ok && start === null) {
      start = i;
    } else if (!ok && start !== null) {
      segs.push([start, i]);
      start = null;
    }
  }
  if (start !== null) segs.push([start, xs.length]);
  return segs;
}

export function geometryMetrics(pixelX: Float64Array): GeometryMetricsType {
  const xs = pixelX;
  const segs = validSegments(xs);
  const n = segs.reduce((acc, [a, b]) => acc + (b - a), 0);

  const zero: GeometryMetricsType = {
    n_valid: n,
    mean_abs_curvature_px: 0.0,
    direction_changes_per_100_rows: 0.0,
    hf_oscillation_index: 0.0,
    hf_rms_px: 0.0,
    total_variation_px: 0.0,
  };
  if (n < 3) return zero;

  const d2All: number[] = [];
  let tv = 0.0;
  let reversals = 0;
  let totalPower = 0.0;
  let hfPower = 0.0;
  let hfEnergy = 0.0;
  let hfRows = 0;

  for (const [a, b] of segs) {
    const seg = xs.subarray(a, b);
    const m = b - a;
    if (m >= 2) {
      for (let i = 1; i < m; i++) tv += Math.abs(seg[i]! - seg[i - 1]!);
    }
    if (m >= 3) {
      for (let i = 2; i < m; i++) d2All.push(seg[i]! - 2 * seg[i - 1]! + seg[i - 2]!);
      reversals += hysteresisReversalCount(seg, DIR_DEADBAND_PX);
    }
    if (m >= 16) {
      const trend = uniformFilter1dNearestOdd(seg, HF_DETREND_WINDOW_ROWS);
      const resid = new Float64Array(m);
      for (let i = 0; i < m; i++) resid[i] = seg[i]! - trend[i]!;
      const residMean = mean(resid);
      const centered = new Float64Array(m);
      for (let i = 0; i < m; i++) centered[i] = resid[i]! - residMean;

      const spec = rfft(centered);
      const freqs = rfftfreq(m);
      const nBins = spec.re.length;
      let segTotalPower = 0.0;
      let segHfPower = 0.0;
      const hfRe = new Float64Array(nBins);
      const hfIm = new Float64Array(nBins);
      for (let k = 0; k < nBins; k++) {
        const power = spec.re[k]! * spec.re[k]! + spec.im[k]! * spec.im[k]!;
        segTotalPower += power;
        if (freqs[k]! >= HF_CUTOFF_CYCLES_PER_ROW) {
          segHfPower += power;
          hfRe[k] = spec.re[k]!;
          hfIm[k] = spec.im[k]!;
        } else {
          hfRe[k] = 0.0;
          hfIm[k] = 0.0;
        }
      }
      totalPower += segTotalPower;
      hfPower += segHfPower;

      const hfOnly = irfft({ re: hfRe, im: hfIm }, m);
      let energy = 0.0;
      for (let i = 0; i < m; i++) energy += hfOnly[i]! * hfOnly[i]!;
      hfEnergy += energy;
      hfRows += m;
    }
  }

  let meanAbsCurvature = 0.0;
  if (d2All.length > 0) {
    let s = 0.0;
    for (const v of d2All) s += Math.abs(v);
    meanAbsCurvature = s / d2All.length;
  }

  return {
    n_valid: n,
    mean_abs_curvature_px: meanAbsCurvature,
    total_variation_px: tv,
    direction_changes_per_100_rows: (100.0 * reversals) / Math.max(1, n - 1),
    hf_oscillation_index: totalPower > 1e-12 ? hfPower / totalPower : 0.0,
    hf_rms_px: hfRows > 0 ? Math.sqrt(hfEnergy / hfRows) : 0.0,
  };
}

export class GeometryMetrics {
  public static computeQV2DForSegment(segment: TracedPoint[]): number {
    if (segment.length < 3) return 1.0;
    const xs = new Float64Array(segment.map(p => p.x));
    const metrics = geometryMetrics(xs);
    const cRef = 0.5;
    const dRef = 25.0;
    const hRefPx = 1.0;
    const gCurv = Math.min(1.0, Math.max(0.0, 1.0 - metrics.mean_abs_curvature_px / cRef));
    const gDir = Math.min(1.0, Math.max(0.0, 1.0 - metrics.direction_changes_per_100_rows / dRef));
    const gHfAbs = Math.min(1.0, Math.max(0.0, 1.0 - metrics.hf_rms_px / hRefPx));
    return Math.min(gCurv, gDir, gHfAbs);
  }
}
