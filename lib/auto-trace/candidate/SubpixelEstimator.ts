/**
 * Subpixel Estimator for Ridge Peak Centerline Localization.
 * 
 * Uses quadratic / parabolic polynomial fitting around discrete local maxima:
 * f(x) = a x^2 + b x + c
 * Subpixel peak offset delta = (y_-1 - y_+1) / (2 * (y_-1 - 2*y_0 + y_+1))
 * 
 * Guarantees strict subpixel shift bounds [-0.5, 0.5] and numerical stability.
 */

export function subpixelRefine(row: Float64Array, peakIdx: number): number {
  if (peakIdx <= 0 || peakIdx >= row.length - 1) return peakIdx;
  const alpha = row[peakIdx - 1]!;
  const beta = row[peakIdx]!;
  const gamma = row[peakIdx + 1]!;
  const denom = alpha - 2 * beta + gamma;
  if (Math.abs(denom) < 1e-8) return peakIdx;
  const delta = (0.5 * (alpha - gamma)) / denom;
  const clampedDelta = Math.max(-0.5, Math.min(0.5, delta));
  return peakIdx + clampedDelta;
}

export class SubpixelEstimator {
  /**
   * Computes subpixel shift for a local maximum at discrete position x0.
   * 
   * @param signal Array of response values
   * @param x0 Discrete peak index
   * @returns Subpixel offset in [-0.5, 0.5]
   */
  public static estimateOffset(signal: Float32Array | number[], x0: number): number {
    if (x0 <= 0 || x0 >= signal.length - 1) {
      return 0.0;
    }

    const yLeft = signal[x0 - 1]!;
    const yCenter = signal[x0]!;
    const yRight = signal[x0 + 1]!;

    const denom = yLeft - 2.0 * yCenter + yRight;

    if (Math.abs(denom) < 1e-7 || denom >= 0) {
      return 0.0;
    }

    const offset = (yLeft - yRight) / (2.0 * denom);

    if (offset < -0.5) return -0.5;
    if (offset > 0.5) return 0.5;
    if (Number.isNaN(offset) || !Number.isFinite(offset)) return 0.0;

    return offset;
  }
}
