import { Matrix2D } from "../model/Matrix";
import { AutoTraceParams, mergeParams } from "../model/Parameters";
import { AutoTraceResultV2 } from "../model/TraceResult";
import { extractCandidates } from "../candidate/RidgeFilter";
import { dpSelect } from "../dp/DynamicProgram";
import { gapRefine } from "../dp/GapRefiner";
import { geometryMetrics } from "../quality/GeometryMetrics";
import { qV2dScore } from "../quality/QualityScore";
import { verticalRuns } from "../review/VerticalRuns";

export interface AutoTraceOptions {
  readonly colOffset?: number;
  readonly rowOffset?: number;
  readonly params?: Readonly<Partial<AutoTraceParams>>;
  readonly trackSlice?: readonly [number, number];
}

/**
 * Run the slice-1 v2 estimator on a grayscale ROI (dark-curve-on-light) —
 * direct port of autotrace_v2(). Parameters default to RATIFIED_PARAMS
 * (unknown override keys fail loud, mirroring the Python guard).
 *
 * trackSlice: when the caller padded the region with grid-detection context
 * (grid_context_px), the [a, b) columns of the actual track within `region`.
 * Candidates come from the track only; colOffset must then be the track's
 * absolute left edge (not the padded region's) — same contract as the
 * Python reference.
 */
export function autotraceV2(region: Matrix2D, opts: AutoTraceOptions = {}): AutoTraceResultV2 {
  const p = mergeParams(opts.params);
  const colOffset = opts.colOffset ?? 0.0;
  const rowOffset = opts.rowOffset ?? 0.0;

  if (region.rows < 3) {
    throw new Error("region must have at least 3 rows (§N4 fail loud)");
  }

  const cands = extractCandidates(region, {
    sigmaRow: p.sigma_row,
    pMin: p.p_min,
    kMax: p.k_max,
    ...(p.w_max ? { wMax: p.w_max } : {}),
    gridSuppress: p.grid_suppress,
    hgridSuppress: p.hgrid_suppress,
    ...(opts.trackSlice ? { trackSlice: opts.trackSlice } : {}),
  });

  let xs = dpSelect(cands, {
    lambda1: p.lambda1,
    lambda2: p.lambda2,
    wStep: p.w_step,
    lambdaGap: p.lambda_gap,
    alpha: p.alpha,
    lambdaOver: p.lambda_over,
    sFloor: p.s_floor,
    sFloorFrac: p.s_floor_frac,
  });

  if (p.gap_refine_max_run) {
    xs = gapRefine(xs, cands, p.gap_refine_max_run, {
      lambda1: p.lambda1,
      lambda2: p.lambda2,
      wStep: p.w_step,
      lambdaGap: p.lambda_gap,
      alpha: p.alpha,
      lambdaOver: p.lambda_over,
    });
  }

  const n = xs.length;
  let validCount = 0;
  let adjacentValidCount = 0;
  for (let i = 0; i < n; i++) {
    const ok = !Number.isNaN(xs[i]!);
    if (ok) validCount++;
    if (i > 0 && ok && !Number.isNaN(xs[i - 1]!)) adjacentValidCount++;
  }
  const detectionRatio = n > 0 ? validCount / n : 0.0;
  const continuity = n > 1 ? adjacentValidCount / (n - 1) : 0.0;

  const metrics = geometryMetrics(xs);
  const { q, components } = qV2dScore(metrics, { cRef: p.c_ref, dRef: p.d_ref, hRefPx: p.h_ref_px });

  const absX = new Float64Array(n);
  for (let i = 0; i < n; i++) absX[i] = xs[i]! + colOffset;

  const pixelY = new Float64Array(n);
  for (let i = 0; i < n; i++) pixelY[i] = i + rowOffset;

  const flags = verticalRuns(absX).map((f) => ({
    rowStart: f.rowStart + rowOffset,
    rowEndExclusive: f.rowEndExclusive + rowOffset,
    meanX: f.meanX,
  }));

  return {
    pixelX: absX,
    pixelY,
    detectionRatio,
    continuity,
    geometry: metrics,
    qV2d: q,
    qComponents: components,
    verticalRuns: flags,
  };
}
