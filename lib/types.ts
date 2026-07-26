// Types and data structures following CitraNeura Scientific & Engineering Blueprint v2.0 specifications.

export type DepthUnit = 'm' | 'ft';
export type DepthType = 'MD' | 'TVD';
export type ScaleType = 'linear' | 'log';

export interface WellMetadata {
  name: string;
  field: string;
  operator: string;
  uwi: string;
  datum: 'KB' | 'DF' | 'GL' | 'RT' | 'MSL' | 'Other';
  depthType: DepthType;
  depthUnit: DepthUnit;
  datumValue?: string;
  locationX?: string;
  locationY?: string;
  topDepth?: string;
  bottomDepth?: string;
  coordinateSystem?: string;
  coordinateRemarks?: string;
  loggingDate?: string;
}

export interface RasterSource {
  name: string;
  dataUrl: string; // Base64 or standard source
  width: number;
  height: number;
  wasFlipped: boolean;
  wasInverted: boolean;
  rotationAngle?: number; // In degrees (-45 to 45) to straighten miring scans
}

export type DepthTransformType = 'linear' | 'piecewise-linear' | 'spline';

export interface DepthControlPoint {
  pixelY: number;
  depth: number;
  isSlanted?: boolean;
  leftX?: number;
  leftY?: number;
  rightX?: number;
  rightY?: number;
}

export interface DepthTransform {
  type: DepthTransformType;
  controlPoints: DepthControlPoint[];
  // Pre-calculated linear coefficients: depth = scale * pixelY + offset
  linearScale?: number;
  linearOffset?: number;
}

export interface ValueTransform {
  type: ScaleType;
  pixelMin: number; // pixel_x at min value (using global coordinates)
  pixelMax: number; // pixel_x at max value (using global coordinates)
  valueMin: number;
  valueMax: number;
  direction?: 'normal' | 'reverse';
}

export interface TrackBoundaryPoint {
  y: number;
  x: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  pixelXLeft: number;
  pixelXRight: number;
  leftPoints?: TrackBoundaryPoint[];
  rightPoints?: TrackBoundaryPoint[];
  valueTransform: ValueTransform;
  isConfigured?: boolean;
  logType?: string;
}

export type DigitizationMode = 'manual_click' | 'freehand' | 'auto_trace' | 'erase';

export interface DigitizedPoint {
  id: string;
  pixelX: number;
  pixelY: number;
  depth: number;
  value: number | null;
  uncertaintyDepth: number | null;
  uncertaintyValue: number | null;
  digitizationMode: DigitizationMode;
}

export interface CurveMetadata {
  id: string;
  mnemonic: string;
  unit: string;
  nullValue: number;
}

export interface CurveStyle {
  color?: string;
  weight?: number;
  dashStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface Curve {
  id: string;
  metadata: CurveMetadata;
  trackId: string;
  points: DigitizedPoint[];
  depthShiftApplied: number; // bulk depth shift (m or ft, positive moves points deeper)
  valueTransform?: ValueTransform; // optional curve-specific override for different scales in the same track
  style?: CurveStyle;
}

export interface LithologyInterval {
  id: string;
  depthTop: number;
  depthBottom: number;
  label: string;
  colorHex: string;
  patternId: string;
}

export interface ProjectState {
  version?: string;
  well: WellMetadata;
  raster: RasterSource | null;
  nullValueGlobal: number;
  depthTransform: DepthTransform;
  tracks: TrackDefinition[];
  curves: Curve[];
  lithologyIntervals: LithologyInterval[];
  displayInvert?: boolean;
}

export interface UndoStep {
  projectState: ProjectState;
  description: string;
}

export interface OCRCandidateFields {
  wellName?: string;
  field?: string;
  operator?: string;
  uwiUInumber?: string;
  datum?: string;
  serviceCompany?: string;
  startDepth?: string;
  stopDepth?: string;
}
