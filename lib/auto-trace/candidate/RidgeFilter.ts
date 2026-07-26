/**
 * Gaussian Matched Ridge Filter for Well Log Line Extractions.
 * 
 * Computes 1D matched filter ridge response across rows and 2D Hessian matrix
 * eigenvalues for line-like structures without binary thresholds or segmentation masks.
 */

import { LabColor } from '../model/CandidateRow';
import { Matrix2D, makeMatrix, getRow, getColumn } from "../model/Matrix";
import { gaussianFilter1dRows } from "../numerics/GaussianFilter";
import { findPeaks } from "../numerics/PeakFinder";
import { median, argsortDescending, argsortAscending } from "../numerics/Stats";
import { CandidateRows, makeCandidateRows } from "../model/CandidateRows";
import { subpixelRefine } from "./SubpixelEstimator";

export interface ExtractCandidatesOptions {
  readonly sigmaRow: number;
  readonly pMin: number;
  readonly kMax: number;
  readonly wMax?: number;
  readonly gridSuppress: boolean;
  readonly hgridSuppress: boolean;
  readonly trackSlice?: readonly [number, number];
}

export function extractCandidates(region: Matrix2D, opts: ExtractCandidatesOptions): CandidateRows {
  const inv = makeMatrix(region.rows, region.cols);
  for (let i = 0; i < inv.data.length; i++) inv.data[i] = 255.0 - region.data[i]!;

  let resp = gaussianFilter1dRows(inv, opts.sigmaRow);

  if (opts.gridSuppress) {
    const med = new Float64Array(resp.cols);
    for (let c = 0; c < resp.cols; c++) med[c] = median(getColumn(resp, c));
    const gridPeaks = findPeaks(med, { prominenceMin: opts.pMin });
    if (gridPeaks.peaks.length >= 3) {
      const sub = new Float64Array(resp.cols);
      for (let c = 0; c < resp.cols; c++) sub[c] = med[c]! > 0.5 * opts.pMin ? med[c]! : 0.0;
      const next = makeMatrix(resp.rows, resp.cols);
      for (let r = 0; r < resp.rows; r++) {
        for (let c = 0; c < resp.cols; c++) {
          const v = resp.data[r * resp.cols + c]! - sub[c]!;
          next.data[r * resp.cols + c] = v > 0 ? v : 0.0;
        }
      }
      resp = next;
    }
  }

  if (opts.hgridSuppress) {
    const next = makeMatrix(resp.rows, resp.cols);
    for (let r = 0; r < resp.rows; r++) {
      const rowMed = median(getRow(resp, r));
      for (let c = 0; c < resp.cols; c++) {
        const v = resp.data[r * resp.cols + c]! - rowMed;
        next.data[r * resp.cols + c] = v > 0 ? v : 0.0;
      }
    }
    resp = next;
  }

  if (opts.trackSlice !== undefined) {
    const [a, b] = opts.trackSlice;
    if (!(a >= 0 && a < b && b <= resp.cols)) {
      throw new Error("track_slice must lie inside the region (§N4 fail loud)");
    }
    const width = b - a;
    const next = makeMatrix(resp.rows, width);
    for (let r = 0; r < resp.rows; r++) {
      next.data.set(resp.data.subarray(r * resp.cols + a, r * resp.cols + b), r * width);
    }
    resp = next;
  }

  const positions: Float64Array[] = [];
  const strengths: Float64Array[] = [];
  for (let r = 0; r < resp.rows; r++) {
    const row = getRow(resp, r);
    const found = findPeaks(row, {
      prominenceMin: opts.pMin,
      ...(opts.wMax !== undefined && opts.wMax > 0 ? { widthMax: opts.wMax } : {}),
    });
    if (found.peaks.length === 0) {
      positions.push(new Float64Array(0));
      strengths.push(new Float64Array(0));
      continue;
    }
    let peaks = found.peaks;
    let prom = found.prominences;
    if (peaks.length > opts.kMax) {
      const keep = argsortDescending(prom).slice(0, opts.kMax);
      peaks = keep.map((i) => peaks[i]!);
      prom = keep.map((i) => prom[i]!);
    }
    const xs = peaks.map((p) => subpixelRefine(row, p));
    const order = argsortAscending(xs);
    positions.push(Float64Array.from(order.map((i) => xs[i]!)));
    strengths.push(Float64Array.from(order.map((i) => prom[i]!)));
  }
  return makeCandidateRows(positions, strengths);
}

export class RidgeFilter {
  public static rgbToLab(r: number, g: number, b: number): LabColor {
    let rNorm = r / 255.0;
    let gNorm = g / 255.0;
    let bNorm = b / 255.0;

    rNorm = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
    gNorm = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
    bNorm = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

    const x = (rNorm * 0.4124564 + gNorm * 0.3575761 + bNorm * 0.1804375) * 100.0;
    const y = (rNorm * 0.2126729 + gNorm * 0.7151522 + bNorm * 0.0721750) * 100.0;
    const z = (rNorm * 0.0193339 + gNorm * 0.1191920 + bNorm * 0.9503041) * 100.0;

    const xR = x / 95.047;
    const yR = y / 100.000;
    const zR = z / 108.883;

    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16.0 / 116.0);

    const fx = f(xR);
    const fy = f(yR);
    const fz = f(zR);

    return {
      L: 116.0 * fy - 16.0,
      a: 500.0 * (fx - fy),
      b: 200.0 * (fy - fz)
    };
  }

  public static deltaELab(c1: LabColor, c2: LabColor): number {
    const dL = c1.L - c2.L;
    const da = c1.a - c2.a;
    const db = c1.b - c2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  public static filterRowMatched(
    row: Float32Array,
    sigma: number,
    autoInvert: boolean = true
  ): Float32Array {
    const len = row.length;
    const response = new Float32Array(len);

    const radius = Math.max(1, Math.ceil(3.0 * sigma));
    const kSize = 2 * radius + 1;
    const kernel = new Float32Array(kSize);

    let kSum = 0;
    for (let i = -radius; i <= radius; i++) {
      const val = ((i * i) / (sigma * sigma) - 1.0) * Math.exp(-(i * i) / (2.0 * sigma * sigma));
      kernel[i + radius] = val;
      kSum += Math.abs(val);
    }
    if (kSum > 0) {
      for (let i = 0; i < kSize; i++) kernel[i] /= kSum;
    }

    for (let x = 0; x < len; x++) {
      let accum = 0;
      for (let k = -radius; k <= radius; k++) {
        const px = Math.min(len - 1, Math.max(0, x + k));
        const val = autoInvert ? (1.0 - row[px]!) : row[px]!;
        accum += val * kernel[k + radius]!;
      }
      response[x] = Math.max(0, accum);
    }

    let maxVal = 0;
    for (let x = 0; x < len; x++) {
      if (response[x]! > maxVal) maxVal = response[x]!;
    }
    if (maxVal > 1e-6) {
      for (let x = 0; x < len; x++) response[x] /= maxVal;
    }

    return response;
  }
}
