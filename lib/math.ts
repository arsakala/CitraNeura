// Scientific Mathematical Transformations & Uncertainty Engine following CitraNeura Blueprint Chapters 7 and 15

import { DepthTransform, ValueTransform, DigitizedPoint, DepthControlPoint } from './types';

/**
 * PCHIP (Piecewise Cubic Hermite Interpolating Polynomial) Implementation in TypeScript
 * Precomputes mono-preserving slopes as specified by Fritsch & Carlson (1980) or PCHIP in SciPy.
 * It strictly guarantees monotonicity and avoids the oscillatory overshoots of standard cubic splines.
 */
export class PchipInterpolator {
  private x: number[] = [];
  private y: number[] = [];
  private d: number[] = []; // Slopes (derivatives) at x_i
  private n: number = 0;

  constructor(points: DepthControlPoint[]) {
    // Sort control points by pixelY (x coordinate of the interpolator)
    const sorted = [...points].sort((a, b) => a.pixelY - b.pixelY);
    this.x = sorted.map(p => p.pixelY);
    this.y = sorted.map(p => p.depth);
    this.n = sorted.length;

    if (this.n >= 2) {
      this.computeSlopes();
    }
  }

  private computeSlopes() {
    const n = this.n;
    const h: number[] = [];
    const delta: number[] = []; // Finite differences (y[i+1]-y[i])/h[i]

    for (let i = 0; i < n - 1; i++) {
      h[i] = this.x[i + 1] - this.x[i];
      // Avoid division by zero if control points have exact same pixelY
      const xDiff = h[i] === 0 ? 1e-9 : h[i];
      delta[i] = (this.y[i + 1] - this.y[i]) / xDiff;
    }

    // Initialize slopes
    this.d = new Array(n).fill(0);

    // Standard PCHIP algorithm for slope computation
    // Internal derivatives
    for (let i = 1; i < n - 1; i++) {
      const d1 = delta[i - 1];
      const d2 = delta[i];
      const h1 = h[i - 1];
      const h2 = h[i];

      // Sign check: if slopes are of different signs or either is 0,
      // the derivative at the knot must be 0 to maintain monotonicity.
      if (d1 * d2 <= 0) {
        this.d[i] = 0;
      } else {
        // Weighted harmonic mean of finite differences
        const w1 = 2 * h2 + h1;
        const w2 = h2 + 2 * h1;
        this.d[i] = (w1 + w2) / (w1 / d1 + w2 / d2);
      }
    }

    // Boundary derivatives (one-sided formulas)
    if (n >= 2) {
      // Start boundary
      this.d[0] = this.computeBoundarySlope(h[0], h[1], delta[0], delta[1]);
      // End boundary
      this.d[n - 1] = this.computeBoundarySlope(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3], true);
    }
  }

  private computeBoundarySlope(h0: number, h1: number, d0: number, d1: number, isEnd = false) {
    if (isNaN(d1)) {
      return d0;
    }
    // Standard PCHIP edge slopes derivative calculation
    const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    const signD0 = Math.sign(d0);
    const signSlope = Math.sign(slope);

    if (signSlope !== signD0) {
      return 0;
    } else if (Math.sign(d1) !== signD0 && Math.abs(slope) > 3 * Math.abs(d0)) {
      return 3 * d0;
    }
    return slope;
  }

  public interpolate(pixelY: number): { depth: number; localSlope: number } {
    const n = this.n;
    if (n === 0) return { depth: 0, localSlope: 1 };
    if (n === 1) return { depth: this.y[0], localSlope: 1 };

    // Find the interval
    let idx = -1;
    if (pixelY <= this.x[0]) {
      // Underflow / Extrapolate left
      const localSlope = this.d[0];
      const depth = this.y[0] + localSlope * (pixelY - this.x[0]);
      return { depth, localSlope };
    }
    if (pixelY >= this.x[n - 1]) {
      // Overflow / Extrapolate right
      const localSlope = this.d[n - 1];
      const depth = this.y[n - 1] + localSlope * (pixelY - this.x[n - 1]);
      return { depth, localSlope };
    }

    // Binary search for interval
    let low = 0;
    let high = n - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.x[mid] <= pixelY && pixelY <= this.x[mid + 1]) {
        idx = mid;
        break;
      } else if (this.x[mid] > pixelY) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (idx === -1) idx = 0; // Fallback

    const x0 = this.x[idx];
    const x1 = this.x[idx + 1];
    const y0 = this.y[idx];
    const y1 = this.y[idx + 1];
    const d0 = this.d[idx];
    const d1 = this.d[idx + 1];
    const h = x1 - x0;

    // Hermite basis functions
    const t = (pixelY - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const depth = h00 * y0 + h10 * h * d0 + h01 * y1 + h11 * h * d1;

    // Derivative of Hermite spline for local slope
    // d/dx t = 1/h
    const dh00 = 6 * t2 - 6 * t;
    const dh10 = 3 * t2 - 4 * t + 1;
    const dh01 = -6 * t2 + 6 * t;
    const dh11 = 3 * t2 - 2 * t;

    const localSlope = (dh00 * y0 + dh10 * h * d0 + dh01 * y1 + dh11 * h * d1) / h;

    return { depth, localSlope };
  }
}

export function getEffectiveY(cp: DepthControlPoint, pixelX?: number): number {
  if (cp.isSlanted && cp.leftX !== undefined && cp.leftY !== undefined && cp.rightX !== undefined && cp.rightY !== undefined && pixelX !== undefined) {
    const dx = cp.rightX - cp.leftX;
    if (dx === 0) return cp.leftY;
    const t = (pixelX - cp.leftX) / dx;
    return cp.leftY + t * (cp.rightY - cp.leftY);
  }
  return cp.pixelY;
}

/**
 * Transforms global pixel_y coordinate to depth value using selected DepthTransform configuration.
 */
export function pixelYToDepth(pixelY: number, transform: DepthTransform, pixelX?: number): { depth: number; localSlope: number } {
  const points = transform.controlPoints;

  // Compute effective Y coordinates if pixelX is provided
  const mappedPoints = points.map(p => ({
    pixelY: getEffectiveY(p, pixelX),
    depth: p.depth
  }));

  if (transform.type === 'linear' || mappedPoints.length < 2) {
    if (mappedPoints.length >= 2) {
      // Calculate or fetch scale & offset
      const p1 = mappedPoints[0];
      const p2 = mappedPoints[1];
      const scale = (p2.depth - p1.depth) / (p2.pixelY - p1.pixelY);
      const offset = p1.depth - scale * p1.pixelY;
      const depth = scale * pixelY + offset;
      return { depth, localSlope: scale };
    }
    // Fallback if less than 2 points are set
    const fallbackScale = 1.0;
    const fallbackOffset = 0.0;
    return { depth: fallbackScale * pixelY + fallbackOffset, localSlope: fallbackScale };
  }

  if (transform.type === 'piecewise-linear') {
    // Sort control points
    const sorted = [...mappedPoints].sort((a, b) => a.pixelY - b.pixelY);
    const n = sorted.length;

    if (pixelY <= sorted[0].pixelY) {
      // Left extrapolation
      const dy = sorted[1].pixelY - sorted[0].pixelY;
      const slope = dy === 0 ? 1 : (sorted[1].depth - sorted[0].depth) / dy;
      return { depth: sorted[0].depth + slope * (pixelY - sorted[0].pixelY), localSlope: slope };
    }
    if (pixelY >= sorted[n - 1].pixelY) {
      // Right extrapolation
      const dy = sorted[n - 1].pixelY - sorted[n - 2].pixelY;
      const slope = dy === 0 ? 1 : (sorted[n - 1].depth - sorted[n - 2].depth) / dy;
      return { depth: sorted[n - 1].depth + slope * (pixelY - sorted[n - 1].pixelY), localSlope: slope };
    }

    // Binary search/linear interpolation
    for (let i = 0; i < n - 1; i++) {
      if (pixelY >= sorted[i].pixelY && pixelY <= sorted[i + 1].pixelY) {
        const p1 = sorted[i];
        const p2 = sorted[i + 1];
        const dy = p2.pixelY - p1.pixelY;
        const slope = dy === 0 ? 1 : (p2.depth - p1.depth) / dy;
        const depth = p1.depth + slope * (pixelY - p1.pixelY);
        return { depth, localSlope: slope };
      }
    }
    return { depth: pixelY, localSlope: 1 };
  }

  if (transform.type === 'spline') {
    const pchip = new PchipInterpolator(mappedPoints);
    return pchip.interpolate(pixelY);
  }

  return { depth: pixelY, localSlope: 1 };
}

/**
 * Transforms physical depth value to global pixel_y coordinate using selected DepthTransform configuration.
 */
export function depthToPixelY(depth: number, transform: DepthTransform): number {
  const points = transform.controlPoints;
  if (!points || points.length === 0) return depth;

  const mappedPoints = points.map(p => ({
    pixelY: p.pixelY,
    depth: p.depth
  }));

  if (transform.type === 'linear' || mappedPoints.length < 2) {
    if (mappedPoints.length >= 2) {
      const p1 = mappedPoints[0];
      const p2 = mappedPoints[1];
      const scale = (p2.depth - p1.depth) / (p2.pixelY - p1.pixelY);
      if (scale === 0) return p1.pixelY;
      const offset = p1.depth - scale * p1.pixelY;
      return (depth - offset) / scale;
    }
    return depth;
  }

  const sorted = [...mappedPoints].sort((a, b) => a.depth - b.depth);
  const n = sorted.length;

  if (depth <= sorted[0].depth) {
    const dd = sorted[1].depth - sorted[0].depth;
    const slope = dd === 0 ? 1 : (sorted[1].pixelY - sorted[0].pixelY) / dd;
    return sorted[0].pixelY + slope * (depth - sorted[0].depth);
  }
  if (depth >= sorted[n - 1].depth) {
    const dd = sorted[n - 1].depth - sorted[n - 2].depth;
    const slope = dd === 0 ? 1 : (sorted[n - 1].pixelY - sorted[n - 2].pixelY) / dd;
    return sorted[n - 1].pixelY + slope * (depth - sorted[n - 1].depth);
  }

  for (let i = 0; i < n - 1; i++) {
    if (depth >= sorted[i].depth && depth <= sorted[i + 1].depth) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      const dd = p2.depth - p1.depth;
      const slope = dd === 0 ? 1 : (p2.pixelY - p1.pixelY) / dd;
      return p1.pixelY + slope * (depth - p1.depth);
    }
  }

  return depth;
}

/**
 * Transforms global pixel_x coordinate to curve physical log value.
 */
export function pixelXToValue(pixelX: number, transform: ValueTransform, overridePixelMin?: number, overridePixelMax?: number): number {
  const { valueMin, valueMax, type, direction = 'normal' } = transform;
  const pixelMin = overridePixelMin !== undefined ? overridePixelMin : transform.pixelMin;
  const pixelMax = overridePixelMax !== undefined ? overridePixelMax : transform.pixelMax;
  
  // Guard against division by zero
  if (pixelMax === pixelMin) {
    return valueMin;
  }

  const isReverse = direction === 'reverse';
  const startVal = isReverse ? valueMax : valueMin;
  const endVal = isReverse ? valueMin : valueMax;

  if (type === 'linear') {
    return startVal + (endVal - startVal) * (pixelX - pixelMin) / (pixelMax - pixelMin);
  } else {
    // Logarithmic scale (Base 10)
    // Guards: values must be greater than zero
    const valStart = startVal <= 0 ? 0.001 : startVal;
    const valEnd = endVal <= 0 ? 10000 : endVal;
    
    const term = (pixelX - pixelMin) / (pixelMax - pixelMin);
    return valStart * Math.pow(valEnd / valStart, term);
  }
}

/**
 * Transforms a physical value back to pixel_x coordinate (Inverse transformation).
 * This is useful for redrawing or validation.
 */
export function valueToPixelX(value: number, transform: ValueTransform, overridePixelMin?: number, overridePixelMax?: number): number {
  const { valueMin, valueMax, type, direction = 'normal' } = transform;
  const pixelMin = overridePixelMin !== undefined ? overridePixelMin : transform.pixelMin;
  const pixelMax = overridePixelMax !== undefined ? overridePixelMax : transform.pixelMax;

  if (valueMin === valueMax) return pixelMin;

  const isReverse = direction === 'reverse';
  const startVal = isReverse ? valueMax : valueMin;
  const endVal = isReverse ? valueMin : valueMax;

  if (type === 'linear') {
    const fraction = (value - startVal) / (endVal - startVal);
    return pixelMin + fraction * (pixelMax - pixelMin);
  } else {
    const valStart = startVal <= 0 ? 0.001 : startVal;
    const valEnd = endVal <= 0 ? 10000 : endVal;
    const val = value <= 0 ? 0.001 : value;
    
    const fraction = Math.log10(val / valStart) / Math.log10(valEnd / valStart);
    return pixelMin + fraction * (pixelMax - pixelMin);
  }
}

/**
 * Uncertainty Propagation (Blueprint Section 15)
 * Returns the standard +_ uncertainty band on Depth and physical Value given pixel deviation.
 */
export function calculatePointUncertainties(
  pixelX: number,
  pixelY: number,
  valueTransform: ValueTransform,
  localSlope: number, // depth_change per screen pixel_y
  pixelDelta = 1.0 // default screen resolution uncertainty is 1 pixel
): { uncertaintyDepth: number; uncertaintyValue: number } {
  // 1. Depth uncertainty: δdepth = |slope_local| * δpy
  const uncertaintyDepth = Math.abs(localSlope) * pixelDelta;

  // 2. Value uncertainty: δvalue
  let uncertaintyValue = 0;
  const { pixelMin, pixelMax, valueMin, valueMax, type } = valueTransform;
  
  if (pixelMax !== pixelMin) {
    if (type === 'linear') {
      // δvalue = |(valueMax - valueMin) / (pixelMax - pixelMin)| * δpx
      uncertaintyValue = Math.abs((valueMax - valueMin) / (pixelMax - pixelMin)) * pixelDelta;
    } else {
      // Logarithmic propagation (Blueprint eq on ln(10) * base10 slope):
      // δvalue/value = |log10(valueMax/valueMin) / (pixelMax - pixelMin)| * ln(10) * δpx
      const valMin = valueMin <= 0 ? 0.001 : valueMin;
      const valMax = valueMax <= 0 ? 10000 : valueMax;
      const currentValue = pixelXToValue(pixelX, valueTransform);
      
      const logRatio = Math.log10(valMax / valMin);
      const pixelDiff = pixelMax - pixelMin;
      const logTermVal = Math.abs(logRatio / pixelDiff) * Math.log(10) * pixelDelta;
      
      uncertaintyValue = currentValue * logTermVal;
    }
  }

  return {
    uncertaintyDepth: Number(uncertaintyDepth.toFixed(4)),
    uncertaintyValue: Number(uncertaintyValue.toFixed(4))
  };
}

/**
 * Validates Depth Control Points Monotonicity
 * Returns true if both pixelY and depth attributes are strictly monotonically increasing.
 */
export function validateDepthMonotonicity(points: { pixelY: number; depth: number }[]): boolean {
  if (points.length < 2) return true;
  const sorted = [...points].sort((a, b) => a.pixelY - b.pixelY);
  for (let i = 0; i < sorted.length - 1; i++) {
    // If pixelY increases, depth must strictly increase
    if (sorted[i + 1].depth <= sorted[i].depth) {
      return false;
    }
  }
  return true;
}

const sortedPointsCache = new WeakMap<any, { y: number; x: number }[]>();

function getSortedPoints(points: { y: number; x: number }[]): { y: number; x: number }[] {
  let sorted = sortedPointsCache.get(points);
  if (!sorted) {
    sorted = [...points].sort((a, b) => a.y - b.y);
    sortedPointsCache.set(points, sorted);
  }
  return sorted;
}

/**
 * Calculates the exact X pixel coordinate for a track boundary at a given Y pixel coordinate.
 * Handles both classic 2-point vertical bounds and complex multi-point polylines (trapezoidal/skew).
 */
export function getTrackBoundX(
  t: { pixelXLeft: number; pixelXRight: number; leftPoints?: { y: number; x: number }[]; rightPoints?: { y: number; x: number }[] },
  side: 'left' | 'right',
  pixelY: number
): number {
  const points = side === 'left' ? t.leftPoints : t.rightPoints;
  const fallbackX = side === 'left' ? t.pixelXLeft : t.pixelXRight;

  if (!points || points.length === 0) return fallbackX;
  if (points.length === 1) return points[0].x;

  const sorted = getSortedPoints(points);

  if (pixelY <= sorted[0].y) return sorted[0].x;
  if (pixelY >= sorted[sorted.length - 1].y) return sorted[sorted.length - 1].x;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    if (pixelY >= p1.y && pixelY <= p2.y) {
      const dy = p2.y - p1.y;
      if (dy === 0) return p1.x;
      const tParam = (pixelY - p1.y) / dy;
      return p1.x + tParam * (p2.x - p1.x);
    }
  }
  return fallbackX;
}
