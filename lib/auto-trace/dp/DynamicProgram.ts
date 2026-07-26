/**
 * Second-Order Dynamic Programming Solver for Well Log Curve Extraction.
 * 
 * Formulates curve extraction as finding the global minimum cost path across
 * candidate rows using a 2nd-order state space (row, currentCandidate, prevCandidate).
 * 
 * Guarantees 100% deterministic output.
 */

import { RowCandidateSet, CandidatePoint } from '../model/CandidateRow';
import { AutoTraceParameters } from '../model/Parameters';
import { CostFunction } from './CostFunction';
import { CandidateRows, makeCandidateRows, candidateRowCount } from "../model/CandidateRows";
import { median } from "../numerics/Stats";

export interface DpSelectParams {
  readonly lambda1: number;
  readonly lambda2: number;
  readonly wStep: number;
  readonly lambdaGap: number;
  readonly alpha: number;
  readonly lambdaOver: number;
  readonly sFloor: number;
  readonly sFloorFrac: number;
}

export function dpSelect(cands: CandidateRows, p: DpSelectParams): Float64Array {
  const nRows = candidateRowCount(cands);
  let floorEff = p.sFloor;
  if (p.sFloorFrac > 0.0) {
    const rowMax: number[] = [];
    for (const s of cands.strengths) {
      if (s.length > 0) {
        let m = s[0]!;
        for (let i = 1; i < s.length; i++) if (s[i]! > m) m = s[i]!;
        rowMax.push(m);
      }
    }
    if (rowMax.length > 0) {
      const sRef = median(rowMax);
      floorEff = Math.max(floorEff, p.sFloorFrac * sRef);
    }
  }

  let working = cands;
  if (floorEff > 0.0) {
    const positions: Float64Array[] = [];
    const strengths: Float64Array[] = [];
    for (let r = 0; r < nRows; r++) {
      const pos = cands.positions[r]!;
      const str = cands.strengths[r]!;
      const keptIdx: number[] = [];
      for (let i = 0; i < str.length; i++) if (str[i]! >= floorEff) keptIdx.push(i);
      positions.push(Float64Array.from(keptIdx.map((i) => pos[i]!)));
      strengths.push(Float64Array.from(keptIdx.map((i) => str[i]!)));
    }
    working = makeCandidateRows(positions, strengths);
  }

  const xsOut = new Float64Array(nRows).fill(NaN);
  const bearing: number[] = [];
  for (let r = 0; r < nRows; r++) if (working.positions[r]!.length > 0) bearing.push(r);
  if (bearing.length === 0) return xsOut;

  const kept: number[] = [];
  let cost: number[][] | null = null;
  const parents: number[][][] = [];

  for (const r of bearing) {
    const xr = working.positions[r]!;
    const sr = working.strengths[r]!;

    if (kept.length === 0) {
      kept.push(r);
      continue;
    }

    if (kept.length === 1) {
      const x0 = working.positions[kept[0]!]!;
      const s0 = working.strengths[kept[0]!]!;
      const dr = r - kept[0]!;
      const c: number[][] = [];
      for (let i = 0; i < xr.length; i++) {
        const row: number[] = [];
        for (let j = 0; j < x0.length; j++) {
          const step = Math.abs(xr[i]! - x0[j]!);
          const over = Math.max(0.0, step - p.wStep * dr);
          row.push(
            -p.alpha * (sr[i]! + s0[j]!) +
              p.lambda1 * step +
              p.lambdaOver * over * over +
              p.lambdaGap * (dr - 1),
          );
        }
        c.push(row);
      }
      kept.push(r);
      cost = c;
      continue;
    }

    const pIdx = kept[kept.length - 1]!;
    const qIdx = kept[kept.length - 2]!;
    const xp = working.positions[pIdx]!;
    const xq = working.positions[qIdx]!;
    const d1 = pIdx - qIdx;
    const d2 = r - pIdx;
    const prevCost = cost!;

    const newCost: number[][] = [];
    const parent: number[][] = [];
    for (let i = 0; i < xr.length; i++) {
      const step_i: number[] = [];
      const newCostRow: number[] = [];
      const parentRow: number[] = [];
      for (let j = 0; j < xp.length; j++) {
        const step = Math.abs(xr[i]! - xp[j]!);
        step_i.push(step);
        let bestK = 0;
        let bestVal = Infinity;
        for (let k = 0; k < xq.length; k++) {
          const term = (xr[i]! - xp[j]!) / d2 - (xp[j]! - xq[k]!) / d1;
          const curv = Math.abs((2.0 * term) / (d1 + d2));
          const total = prevCost[j]![k]! + p.lambda2 * curv;
          if (total < bestVal) {
            bestVal = total;
            bestK = k;
          }
        }
        const over = Math.max(0.0, step - p.wStep * d2);
        const c =
          bestVal - p.alpha * sr[i]! + p.lambda1 * step + p.lambdaOver * over * over + p.lambdaGap * (d2 - 1);
        newCostRow.push(c);
        parentRow.push(bestK);
      }
      newCost.push(newCostRow);
      parent.push(parentRow);
    }

    kept.push(r);
    parents.push(parent);
    cost = newCost;
  }

  if (kept.length === 1) {
    const r = kept[0]!;
    const str = working.strengths[r]!;
    let bestI = 0;
    for (let i = 1; i < str.length; i++) if (str[i]! > str[bestI]!) bestI = i;
    xsOut[r] = working.positions[r]![bestI]!;
    return xsOut;
  }

  const finalCost = cost!;
  let bestJ = 0;
  let bestK = 0;
  let bestVal = Infinity;
  for (let j = 0; j < finalCost.length; j++) {
    for (let k = 0; k < finalCost[j]!.length; k++) {
      if (finalCost[j]![k]! < bestVal) {
        bestVal = finalCost[j]![k]!;
        bestJ = j;
        bestK = k;
      }
    }
  }

  const sel = new Map<number, number>();
  sel.set(kept[kept.length - 1]!, bestJ);
  sel.set(kept[kept.length - 2]!, bestK);
  let j = bestJ;
  let k = bestK;
  for (let i = kept.length - 1; i >= 2; i--) {
    const q = parents[i - 2]![j]![k]!;
    sel.set(kept[i - 2]!, q);
    j = k;
    k = q;
  }

  for (const [r, ci] of sel) {
    xsOut[r] = working.positions[r]![ci]!;
  }
  return xsOut;
}

export interface DPSolutionNode {
  rowIndex: number;
  candidate: CandidatePoint | null;
  accumulatedCost: number;
  localCost: number;
}

export class DynamicProgram {
  public static solve(
    rowSets: RowCandidateSet[],
    params: AutoTraceParameters
  ): DPSolutionNode[] {
    const numRows = rowSets.length;
    if (numRows === 0) return [];

    const augmentedSets: (CandidatePoint | null)[][] = rowSets.map(set => {
      const candidates: (CandidatePoint | null)[] = [...set.candidates];
      candidates.push(null);
      return candidates;
    });

    const dpTable: number[][][] = [];
    const parentTable: number[][][] = [];

    dpTable[0] = [];
    parentTable[0] = [];
    const row0 = augmentedSets[0];
    for (let i = 0; i < row0.length; i++) {
      dpTable[0][i] = [CostFunction.computeDataCost(row0[i], { L: 0, a: 0, b: 0 }, params)];
      parentTable[0][i] = [-1];
    }

    if (numRows === 1) {
      let bestI = 0;
      let minCost = Infinity;
      for (let i = 0; i < row0.length; i++) {
        if (dpTable[0][i][0] < minCost) {
          minCost = dpTable[0][i][0];
          bestI = i;
        }
      }
      return [{
        rowIndex: rowSets[0].rowIndex,
        candidate: row0[bestI],
        accumulatedCost: minCost,
        localCost: minCost
      }];
    }

    dpTable[1] = [];
    parentTable[1] = [];
    const row1 = augmentedSets[1];
    for (let i = 0; i < row1.length; i++) {
      dpTable[1][i] = [];
      parentTable[1][i] = [];
      const pi = row1[i];
      for (let j = 0; j < row0.length; j++) {
        const pj = row0[j];
        const cost = dpTable[0][j][0] + CostFunction.computeTransitionCost(null, pj, pi, params);
        dpTable[1][i][j] = cost;
        parentTable[1][i][j] = -1;
      }
    }

    for (let y = 2; y < numRows; y++) {
      dpTable[y] = [];
      parentTable[y] = [];
      const currRow = augmentedSets[y];
      const prevRow = augmentedSets[y - 1];
      const prevPrevRow = augmentedSets[y - 2];

      for (let i = 0; i < currRow.length; i++) {
        dpTable[y][i] = [];
        parentTable[y][i] = [];
        const pi = currRow[i];

        for (let j = 0; j < prevRow.length; j++) {
          const pj = prevRow[j];
          let minCost = Infinity;
          let bestK = -1;

          for (let k = 0; k < prevPrevRow.length; k++) {
            const pk = prevPrevRow[k];
            const prevAccumCost = dpTable[y - 1][j][k];
            if (prevAccumCost >= Infinity) continue;

            const transitionCost = CostFunction.computeTransitionCost(pk, pj, pi, params);
            const totalCost = prevAccumCost + transitionCost;

            if (totalCost < minCost) {
              minCost = totalCost;
              bestK = k;
            }
          }

          dpTable[y][i][j] = minCost;
          parentTable[y][i][j] = bestK;
        }
      }
    }

    const lastY = numRows - 1;
    let minFinalCost = Infinity;
    let bestI = -1;
    let bestJ = -1;

    const lastRow = augmentedSets[lastY];
    const secondLastRow = augmentedSets[lastY - 1];

    for (let i = 0; i < lastRow.length; i++) {
      for (let j = 0; j < secondLastRow.length; j++) {
        const cost = dpTable[lastY][i][j];
        if (cost < minFinalCost) {
          minFinalCost = cost;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestI === -1 || bestJ === -1) {
      bestI = lastRow.length - 1;
      bestJ = secondLastRow.length - 1;
    }

    const path: DPSolutionNode[] = new Array(numRows);
    let currI = bestI;
    let currJ = bestJ;

    for (let y = lastY; y >= 2; y--) {
      path[y] = {
        rowIndex: rowSets[y].rowIndex,
        candidate: augmentedSets[y][currI],
        accumulatedCost: dpTable[y][currI][currJ],
        localCost: 0
      };

      const parentK = parentTable[y][currI][currJ];
      currI = currJ;
      currJ = parentK >= 0 ? parentK : 0;
    }

    path[1] = {
      rowIndex: rowSets[1].rowIndex,
      candidate: augmentedSets[1][currI],
      accumulatedCost: dpTable[1][currI][currJ],
      localCost: 0
    };

    path[0] = {
      rowIndex: rowSets[0].rowIndex,
      candidate: augmentedSets[0][currJ],
      accumulatedCost: dpTable[0][currJ][0],
      localCost: 0
    };

    return path;
  }
}
