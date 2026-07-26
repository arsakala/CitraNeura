/**
 * Scientific Parameter Governance for CitraNeura Auto-Trace Engine.
 * 
 * All parameter keys, allowed ranges, and default values are treated as
 * immutable scientific configuration. Unknown keys or out-of-range values
 * MUST fail loud with explicit, typed exceptions.
 */

export interface AutoTraceParams {
  readonly sigma_row: number;
  readonly p_min: number;
  readonly k_max: number;
  readonly lambda1: number;
  readonly lambda2: number;
  readonly w_step: number;
  readonly lambda_over: number;
  readonly lambda_gap: number;
  readonly alpha: number;
  readonly s_floor: number;
  readonly s_floor_frac: number;
  readonly w_max: number;
  readonly hgrid_suppress: boolean;
  readonly grid_suppress: boolean;
  readonly grid_context_px: number;
  readonly gap_refine_max_run: number;
  readonly c_ref: number;
  readonly d_ref: number;
  readonly h_ref_px: number;
}

export const RATIFIED_PARAMS: AutoTraceParams = Object.freeze({
  sigma_row: 1.5,
  p_min: 25.0,
  k_max: 5,
  lambda1: 2.0,
  lambda2: 5.0,
  w_step: 16.0,
  lambda_over: 1.0,
  lambda_gap: 50.0,
  alpha: 1.0,
  s_floor: 0.0,
  s_floor_frac: 0.6,
  w_max: 0.0,
  hgrid_suppress: true,
  grid_suppress: true,
  grid_context_px: 192,
  gap_refine_max_run: 4,
  c_ref: 0.5,
  d_ref: 25.0,
  h_ref_px: 1.0,
});

export const Q_V2D_ACCEPT_INTERACTIVE = 0.4;
export const Q_V2D_ACCEPT_BATCH = 0.6;

export const HF_CUTOFF_CYCLES_PER_ROW = 1.0 / 8.0;
export const HF_DETREND_WINDOW_ROWS = 31;
export const DIR_DEADBAND_PX = 0.5;
export const VRUN_MIN_ROWS = 80;
export const VRUN_TOL_PX = 0.75;

export function mergeParams(overrides?: Readonly<Partial<AutoTraceParams>>): AutoTraceParams {
  if (!overrides) return RATIFIED_PARAMS;
  const known = new Set(Object.keys(RATIFIED_PARAMS));
  const unknown = Object.keys(overrides).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `unknown autotrace params: ${JSON.stringify(unknown.sort())} (fail loud — a typo must not silently run defaults)`,
    );
  }
  return Object.freeze({ ...RATIFIED_PARAMS, ...overrides });
}

export interface AutoTraceParameters {
  /** Color Tolerance E_max in CIELAB space [10.0, 100.0] */
  colorTolerance: number;
  /** Gaussian Kernel Scale Sigma [0.5, 5.0] */
  lineWidthSigma: number;
  /** Maximum Turning Angle Theta_max in radians [0.1, 1.5708] */
  maxTurningAngle: number;
  /** Maximum Gap Cost Limit Tau_gap [10.0, 500.0] */
  maxGapTolerance: number;

  /** Weights (MUST sum to 1.0, non-negative) */
  wColor: number;     // w_1: Radiometric color distance
  wRidge: number;     // w_2: Structural ridgeness
  wOrient: number;    // w_3: Tangent orientation alignment
  wMomentum: number;  // w_4: Kinematic trajectory momentum

  /** Candidate Detection Parameters */
  minProminence: number;      // Minimum peak prominence [0.01, 0.5]
  maxCandidatesPerRow: number;// Max peaks retained per row [1, 16]

  /** Second-Order Dynamic Programming Penalties */
  stepPenalty: number;        // Penalty weight for horizontal displacement |x_i - x_j|
  softKneePenalty: number;    // Non-linear penalty weight for displacements exceeding threshold
  kneeThreshold: number;      // Displacement threshold in pixels before soft-knee penalty applies
  curvaturePenalty: number;   // Second-difference penalty |(x_i - x_j) - (x_j - x_k)|
  gapPenalty: number;         // Penalty incurred for stepping into unassigned/gap state
}

export const DEFAULT_AUTOTRACE_PARAMETERS: Readonly<AutoTraceParameters> = Object.freeze({
  colorTolerance: 40.0,
  lineWidthSigma: 1.5,
  maxTurningAngle: Math.PI / 4, // 0.785398 rad
  maxGapTolerance: 100.0,
  wColor: 0.40,
  wRidge: 0.25,
  wOrient: 0.15,
  wMomentum: 0.20,
  minProminence: 0.05,
  maxCandidatesPerRow: 8,
  stepPenalty: 1.0,
  softKneePenalty: 2.0,
  kneeThreshold: 3.0,
  curvaturePenalty: 5.0,
  gapPenalty: 15.0,
});

export function validateParameters(input: unknown): AutoTraceParameters {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('[AutoTraceParameters] Configuration input must be a non-null object.');
  }

  const raw = input as Partial<AutoTraceParameters>;
  const merged: AutoTraceParameters = { ...DEFAULT_AUTOTRACE_PARAMETERS, ...raw };

  for (const [key, val] of Object.entries(merged)) {
    if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
      throw new RangeError(`[AutoTraceParameters] Parameter '${key}' must be a finite number. Received: ${val}`);
    }
  }

  if (merged.colorTolerance < 10.0 || merged.colorTolerance > 100.0) {
    throw new RangeError(`[AutoTraceParameters] colorTolerance (${merged.colorTolerance}) out of bounds [10.0, 100.0].`);
  }
  if (merged.lineWidthSigma < 0.5 || merged.lineWidthSigma > 5.0) {
    throw new RangeError(`[AutoTraceParameters] lineWidthSigma (${merged.lineWidthSigma}) out of bounds [0.5, 5.0].`);
  }
  if (merged.maxTurningAngle < 0.1 || merged.maxTurningAngle > Math.PI / 2) {
    throw new RangeError(`[AutoTraceParameters] maxTurningAngle (${merged.maxTurningAngle}) out of bounds [0.1, ${Math.PI / 2}].`);
  }
  if (merged.maxGapTolerance < 10.0 || merged.maxGapTolerance > 500.0) {
    throw new RangeError(`[AutoTraceParameters] maxGapTolerance (${merged.maxGapTolerance}) out of bounds [10.0, 500.0].`);
  }

  if (merged.wColor < 0 || merged.wRidge < 0 || merged.wOrient < 0 || merged.wMomentum < 0) {
    throw new RangeError('[AutoTraceParameters] Weights must be non-negative.');
  }

  const weightSum = merged.wColor + merged.wRidge + merged.wOrient + merged.wMomentum;
  if (Math.abs(weightSum - 1.0) > 1e-3) {
    throw new RangeError(`[AutoTraceParameters] Observation weights must sum to 1.0 (Current sum: ${weightSum.toFixed(4)}).`);
  }

  return merged;
}
