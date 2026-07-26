/**
 * Honest Gap Refiner enforcing scientific NaN semantics.
 * 
 * Never fabricates coordinates.
 * Never interpolates missing rows in the raw extracted trace.
 * Produces explicit GapSegments and assigns x = NaN for unobserved gap rows.
 */

import { DPSolutionNode } from './DynamicProgram';
import { TracedPoint, GapSegment } from '../model/TraceResult';
import { CandidateRows } from "../model/CandidateRows";

export interface SeqCostParams {
  readonly lambda1: number;
  readonly lambda2: number;
  readonly wStep: number;
  readonly lambdaGap: number;
  readonly alpha: number;
  readonly lambdaOver: number;
}

export interface Selection {
  readonly r: number;
  readonly x: number;
  readonly s: number;
}

export function lookupSelection(pixelX: Float64Array, cands: CandidateRows): Selection[] {
  const sel: Selection[] = [];
  for (let r = 0; r < pixelX.length; r++) {
    const x = pixelX[r]!;
    if (Number.isNaN(x)) continue;
    const pos = cands.positions[r]!;
    if (pos.length === 0) {
      throw new Error(`selected row ${r} has no candidates (§N4 fail loud)`);
    }
    let best = 0;
    let bestDist = Math.abs(pos[0]! - x);
    for (let i = 1; i < pos.length; i++) {
      const d = Math.abs(pos[i]! - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    sel.push({ r, x: pos[best]!, s: cands.strengths[r]![best]! });
  }
  return sel;
}

export function seqCost(seq: readonly Selection[], p: SeqCostParams): number {
  let cost = 0.0;
  for (let i = 0; i < seq.length; i++) {
    cost -= p.alpha * seq[i]!.s;
    if (i >= 1) {
      const d = seq[i]!.r - seq[i - 1]!.r;
      const step = Math.abs(seq[i]!.x - seq[i - 1]!.x);
      const over = Math.max(0.0, step - p.wStep * d);
      cost += p.lambda1 * step + p.lambdaOver * over * over + p.lambdaGap * (d - 1);
    }
    if (i >= 2) {
      const d1 = seq[i - 1]!.r - seq[i - 2]!.r;
      const d2 = seq[i]!.r - seq[i - 1]!.r;
      const curv = Math.abs(
        (2.0 * ((seq[i]!.x - seq[i - 1]!.x) / d2 - (seq[i - 1]!.x - seq[i - 2]!.x) / d1)) / (d1 + d2),
      );
      cost += p.lambda2 * curv;
    }
  }
  return cost;
}

export function pathCost(pixelX: Float64Array, cands: CandidateRows, p: SeqCostParams): number {
  return seqCost(lookupSelection(pixelX, cands), p);
}

export function gapRefine(
  pixelX: Float64Array,
  cands: CandidateRows,
  maxRun: number,
  p: SeqCostParams,
): Float64Array {
  const xs = pixelX.slice();
  if (maxRun <= 0) return xs;
  let sel = lookupSelection(xs, cands);

  for (let pass = 0; pass <= sel.length; pass++) {
    let bestDelta = -1e-12;
    let bestI = -1;
    let bestJ = -1;
    for (let i = 0; i < sel.length; i++) {
      for (let run = 1; run <= maxRun; run++) {
        const j = i + run;
        if (j > sel.length) break;
        const lo = Math.max(0, i - 2);
        const hi = Math.min(sel.length, j + 2);
        const withRemoval = sel.slice(lo, i).concat(sel.slice(j, hi));
        const withoutRemoval = sel.slice(lo, hi);
        const delta = seqCost(withRemoval, p) - seqCost(withoutRemoval, p);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI === -1) break;
    for (let idx = bestI; idx < bestJ; idx++) {
      xs[sel[idx]!.r] = NaN;
    }
    sel = sel.slice(0, bestI).concat(sel.slice(bestJ));
  }
  return xs;
}

export class GapRefiner {
  public static refine(solution: DPSolutionNode[]): { points: TracedPoint[]; gaps: GapSegment[] } {
    const points: TracedPoint[] = [];
    const gaps: GapSegment[] = [];

    let currentGapStart: number | null = null;

    for (let i = 0; i < solution.length; i++) {
      const node = solution[i];
      const c = node.candidate;

      if (!c) {
        if (currentGapStart === null) {
          currentGapStart = node.rowIndex;
        }

        points.push({
          y: node.rowIndex,
          x: NaN,
          gridX: -1,
          subpixelOffset: 0.0,
          confidence: 0.1,
          theta: Math.PI / 2,
          isGap: true,
          ridgeResponse: 0.0,
          prominence: 0.0
        });
      } else {
        if (currentGapStart !== null) {
          const gapLen = node.rowIndex - currentGapStart;
          gaps.push({
            startY: currentGapStart,
            endY: node.rowIndex - 1,
            length: gapLen,
            reason: 'unmatched'
          });
          currentGapStart = null;
        }

        const confidence = Math.max(0.1, Math.min(1.0, 1.0 - (node.localCost / 20.0)));

        points.push({
          y: node.rowIndex,
          x: c.subpixelX,
          gridX: c.x,
          subpixelOffset: c.subpixelOffset,
          confidence,
          theta: Math.PI / 2,
          isGap: false,
          ridgeResponse: c.ridgeResponse,
          prominence: c.prominence
        });
      }
    }

    if (currentGapStart !== null && solution.length > 0) {
      const lastRow = solution[solution.length - 1].rowIndex;
      gaps.push({
        startY: currentGapStart,
        endY: lastRow,
        length: lastRow - currentGapStart + 1,
        reason: 'unmatched'
      });
    }

    return { points, gaps };
  }
}
