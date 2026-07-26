/**
 * Formal result structures for the CitraNeura Auto-Trace Engine.
 */

export interface VerticalRunFlag {
  rowStart: number;
  rowEndExclusive: number;
  meanX: number;
}

export interface GeometryMetrics {
  n_valid: number;
  mean_abs_curvature_px: number;
  total_variation_px: number;
  direction_changes_per_100_rows: number;
  hf_oscillation_index: number;
  hf_rms_px: number;
}

export interface QualityComponents {
  g_curv: number;
  g_dir: number;
  g_hf_abs: number;
}

export interface AutoTraceResultV2 {
  readonly pixelX: Float64Array;
  readonly pixelY: Float64Array;
  readonly detectionRatio: number;
  readonly continuity: number;
  readonly geometry: GeometryMetrics;
  readonly qV2d: number;
  readonly qComponents: QualityComponents;
  readonly verticalRuns: readonly VerticalRunFlag[];
}

export interface TracedPoint {
  /** Row index y */
  y: number;
  /** Subpixel X coordinate, or NaN if unresolvable gap */
  x: number;
  /** Integer grid pixel X */
  gridX: number;
  /** Subpixel offset shift */
  subpixelOffset: number;
  /** Local confidence derived from path cost [0.0, 1.0] */
  confidence: number;
  /** Local heading angle theta in radians [0, 2*pi) */
  theta: number;
  /** True if point was reconstructed across an unobserved gap */
  isGap: boolean;
  /** Structural ridge response */
  ridgeResponse: number;
  /** Peak prominence score */
  prominence: number;
}

export interface GapSegment {
  startY: number;
  endY: number;
  length: number;
  reason: 'unmatched' | 'cost_exceeded' | 'faded_ink';
}

export interface QualityMetrics {
  /** Exact Q_v2d geometry quality metric [0.0, 1.0] */
  qV2d: number;
  /** Segment Q_v2d scores */
  segmentScores: number[];
  /** Mean absolute curvature along valid segments */
  meanCurvature: number;
  /** Max positional discontinuity across rows */
  maxDiscontinuity: number;
  /** Percentage of rows successfully digitized [0.0, 100.0] */
  completionRate: number;
  /** Percentage of gap sections re-acquired [0.0, 100.0] */
  gapRecoveryRate: number;
}

export interface AutoTraceResult {
  /** Sequential digitized points across rows */
  points: TracedPoint[];
  /** Documented gap segments with NaN semantics */
  gaps: GapSegment[];
  /** Quantitative quality & Q_v2d metrics */
  quality: QualityMetrics;
  /** Total processing execution time in ms */
  executionTimeMs: number;
  /** Deterministic SHA-256 / hex checksum of outputs */
  deterministicHash: string;

  /** Optional V2 result attached when running V2 estimator */
  v2Result?: AutoTraceResultV2;
}
