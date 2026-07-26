export interface AutoTraceParams {
  colorTolerance: number;   // E_max: Clamped perceptual Delta E limit [10.0, 100.0], default 40.0
  lineWidthSigma: number;   // Sigma: Gaussian smoothing scale [0.5, 5.0], default 1.5
  maxTurningAngle: number;  // Theta_max: Maximum turn angle in radians [0.1, 1.57], default pi/4 (0.785)
  maxGapTolerance: number;  // Tau_gap: Max accumulated cost for gap bridging [10.0, 500.0], default 100.0
  
  // Weights (must sum to 1.0)
  wColor: number;           // w_1: Weight of radiometric color distance
  wRidge: number;           // w_2: Weight of structural ridgeness
  wOrient: number;          // w_3: Weight of gradient orientation alignment
  wMomentum: number;        // w_4: Weight of kinematic trajectory momentum
}

export const DEFAULT_TRACE_PARAMS: AutoTraceParams = {
  colorTolerance: 40.0,
  lineWidthSigma: 1.5,
  maxTurningAngle: Math.PI / 4, // 45 degrees
  maxGapTolerance: 100.0,
  wColor: 0.40,
  wRidge: 0.25,
  wOrient: 0.15,
  wMomentum: 0.20
};

export interface TraceState {
  x: number;
  y: number;
  theta: number; // heading in radians [0, 2*pi)
  accumulatedCost: number;
  consecutiveGapCost: number;
}

export interface TraceNode {
  state: TraceState;
  parent: TraceNode | null;
  g: number; // accumulated cost to reach this node
  h: number; // heuristic cost to reach the end of the search boundary
  f: number; // total estimated cost (f = g + h)
}

export interface ObservationMetrics {
  colorCost: number;      // M_color in [0, 1]
  ridgeCost: number;      // M_ridge in [0, 1]
  orientCost: number;     // M_orient in [0, 1]
}

export interface TracedPoint {
  x: number;
  y: number;
  theta: number;
  confidence: number; // Local confidence derived from path cost [0, 1]
  isGap: boolean;     // Whether this point was reconstructed through a gap
}
