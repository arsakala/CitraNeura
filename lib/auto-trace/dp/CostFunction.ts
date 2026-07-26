/**
 * Objective Cost Function for Second-Order Dynamic Programming.
 * 
 * Evaluates total transition cost:
 * E_total(p_k, p_j, p_i) = E_data(p_i) + E_step(|x_i - x_j|) + E_softKnee(|x_i - x_j|)
 *                        + E_curv(|(x_i - x_j) - (x_j - x_k)|) + E_gap(p_i)
 */

import { CandidatePoint } from '../model/CandidateRow';
import { AutoTraceParameters } from '../model/Parameters';

export class CostFunction {
  /**
   * Computes data cost for a single candidate p_i in [0.0, 1.0]
   */
  public static computeDataCost(
    candidate: CandidatePoint | null,
    targetLab: { L: number; a: number; b: number },
    params: AutoTraceParameters
  ): number {
    if (!candidate) {
      // Gap candidate
      return params.gapPenalty;
    }

    // Color Cost
    const dE = candidate.colorDistance;
    const colorCost = Math.min(1.0, dE / params.colorTolerance);

    // Ridge Cost
    const ridgeCost = Math.max(0.0, Math.min(1.0, 1.0 - candidate.ridgeResponse));

    // Prominence Cost
    const prominenceCost = Math.max(0.0, Math.min(1.0, 1.0 - candidate.prominence));

    // Combined observation data cost
    let dataCost = params.wColor * colorCost + params.wRidge * ridgeCost + (1.0 - params.wColor - params.wRidge) * prominenceCost;

    if (candidate.isGridLine) {
      dataCost += 0.85; // Heavy grid penalty to reject vertical/horizontal grid lines
    }

    return dataCost;
  }

  /**
   * Computes transition cost between three consecutive candidates:
   * p_k at row y-2, p_j at row y-1, p_i at row y
   */
  public static computeTransitionCost(
    pk: CandidatePoint | null,
    pj: CandidatePoint | null,
    pi: CandidatePoint | null,
    params: AutoTraceParameters
  ): number {
    // If current point is a gap
    if (!pi) {
      return params.gapPenalty;
    }

    let dataCost = this.computeDataCost(pi, { L: 0, a: 0, b: 0 }, params);

    // If previous point was a gap
    if (!pj) {
      return dataCost + params.gapPenalty * 0.5;
    }

    // Trajectory discount: if pi is marked grid line, but pj and pk were non-grid curve points
    // and pi smoothly continues their trajectory, discount grid penalty so curve crosses grid smoothly
    if (pi.isGridLine && !pj.isGridLine && pk && !pk.isGridLine) {
      const predX = 2 * pj.subpixelX - pk.subpixelX;
      if (Math.abs(pi.subpixelX - predX) <= 2.0) {
        dataCost -= 0.65; // Trajectory alignment confirms curve crossing grid intersection
      }
    }

    const dx1 = pi.subpixelX - pj.subpixelX;
    const absDx1 = Math.abs(dx1);

    // Step penalty linear
    const stepCost = params.stepPenalty * absDx1;

    // Soft knee non-linear penalty for large displacements
    let softKneeCost = 0.0;
    if (absDx1 > params.kneeThreshold) {
      const diff = absDx1 - params.kneeThreshold;
      softKneeCost = params.softKneePenalty * (diff * diff);
    }

    // Second-order curvature penalty (if pk is valid)
    let curvatureCost = 0.0;
    if (pk) {
      const dx2 = pj.subpixelX - pk.subpixelX;
      const d2x = Math.abs(dx1 - dx2); // Second difference
      curvatureCost = params.curvaturePenalty * d2x;
    }

    return dataCost + stepCost + softKneeCost + curvatureCost;
  }
}
