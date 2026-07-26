export interface CandidateRows {
  readonly positions: readonly Float64Array[];
  readonly strengths: readonly Float64Array[];
}

export function makeCandidateRows(
  positions: readonly Float64Array[],
  strengths: readonly Float64Array[],
): CandidateRows {
  return { positions, strengths };
}

export function candidateRowCount(cands: CandidateRows): number {
  return cands.positions.length;
}
