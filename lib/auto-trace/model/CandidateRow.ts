/**
 * Data structures for candidate extraction along raster rows.
 */

export interface LabColor {
  L: number;
  a: number;
  b: number;
}

export interface CandidatePoint {
  /** Integer column index x */
  x: number;
  /** Subpixel refined X coordinate = x + subpixelOffset */
  subpixelX: number;
  /** Parabolic subpixel offset shift in [-0.5, 0.5] */
  subpixelOffset: number;
  /** Normalized intensity [0, 1] */
  intensity: number;
  /** Ridge response from Gaussian matched filter / Frangi vesselness [0, 1] */
  ridgeResponse: number;
  /** Peak prominence height relative to local baseline [0, 1] */
  prominence: number;
  /** CIELAB Delta-E color distance to target color */
  colorDistance: number;
  /** Calculated CIELAB color */
  labColor: LabColor;
  /** Flag indicating whether peak aligns with a detected periodic grid line */
  isGridLine: boolean;
}

export interface RowCandidateSet {
  /** Row index y in raster space */
  rowIndex: number;
  /** Extracted candidate peaks for this row, sorted by prominence descending */
  candidates: CandidatePoint[];
  /** Flag indicating whether row is a gap row (no valid candidates detected) */
  isEmpty: boolean;
}
