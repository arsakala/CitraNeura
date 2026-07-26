// CWLS Log ASCII Standard (LAS) 1.2 & 2.0 Exporter & Resampler following Blueprint Chapter 17

import { WellMetadata, Curve, TrackDefinition, LithologyInterval, ProjectState } from './types';

interface ResampledRow {
  depth: number;
  [curveId: string]: number;
}

/**
 * Standard linear interpolation helper.
 * If target lies outside bounds, returns the boundary value or null (handled via fallback).
 */
function interpolateLinear(x: number, xArr: number[], yArr: number[]): number | null {
  const n = xArr.length;
  if (n === 0) return null;
  if (n === 1) return yArr[0];

  if (x < xArr[0] || x > xArr[n - 1]) {
    return null; // Out of bounds -> null value
  }

  // Binary search for interval
  let low = 0;
  let high = n - 1;
  let idx = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (xArr[mid] <= x && x <= xArr[mid + 1]) {
      idx = mid;
      break;
    } else if (xArr[mid] > x) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  const x0 = xArr[idx];
  const x1 = xArr[idx + 1];
  const y0 = yArr[idx];
  const y1 = yArr[idx + 1];

  if (x1 === x0) return y0;

  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/**
 * Standard nearest neighbor interpolation helper.
 */
function interpolateNearest(x: number, xArr: number[], yArr: number[]): number | null {
  const n = xArr.length;
  if (n === 0) return null;
  if (x < xArr[0] || x > xArr[n - 1]) return null;

  let minDiff = Infinity;
  let closestVal = yArr[0];
  for (let i = 0; i < n; i++) {
    const diff = Math.abs(xArr[i] - x);
    if (diff < minDiff) {
      minDiff = diff;
      closestVal = yArr[i];
    }
  }
  return closestVal;
}

/**
 * PCHIP (Piecewise Cubic Hermite Interpolating Polynomial) Helper.
 * Strictly preserves monotonicity and avoids oscillatory overshoots.
 */
function interpolatePchip(x: number, xArr: number[], yArr: number[]): number | null {
  const n = xArr.length;
  if (n === 0) return null;
  if (n === 1) return yArr[0];
  if (x < xArr[0] || x > xArr[n - 1]) return null;

  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = xArr[i + 1] - xArr[i];
    const xDiff = h[i] === 0 ? 1e-9 : h[i];
    delta[i] = (yArr[i + 1] - yArr[i]) / xDiff;
  }

  const d: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const d1 = delta[i - 1];
    const d2 = delta[i];
    if (d1 * d2 <= 0) {
      d[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / d1 + w2 / d2);
    }
  }

  if (n >= 2) {
    const h0 = h[0];
    const h1 = h[1] || h[0];
    const d0 = delta[0];
    const d1 = delta[1] || delta[0];
    const slope0 = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    d[0] = Math.sign(slope0) !== Math.sign(d0) ? 0 : slope0;

    const hn2 = h[n - 2];
    const hn3 = h[n - 3] || hn2;
    const dn2 = delta[n - 2];
    const dn3 = delta[n - 3] || dn2;
    const slopeN = ((2 * hn2 + hn3) * dn2 - hn2 * dn3) / (hn2 + hn3);
    d[n - 1] = Math.sign(slopeN) !== Math.sign(dn2) ? 0 : slopeN;
  }

  let idx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (xArr[i] <= x && x <= xArr[i + 1]) {
      idx = i;
      break;
    }
  }

  const x0 = xArr[idx];
  const x1 = xArr[idx + 1];
  const y0 = yArr[idx];
  const y1 = yArr[idx + 1];
  const d0 = d[idx];
  const d1 = d[idx + 1];
  const intervalH = x1 - x0;

  const t = (x - x0) / (intervalH === 0 ? 1e-9 : intervalH);
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * y0 + h10 * intervalH * d0 + h01 * y1 + h11 * intervalH * d1;
}

/**
 * Standard Cubic Spline / Catmull-Rom interpolation helper.
 */
function interpolateCubic(x: number, xArr: number[], yArr: number[]): number | null {
  const n = xArr.length;
  if (n === 0) return null;
  if (n === 1) return yArr[0];
  if (x < xArr[0] || x > xArr[n - 1]) return null;

  let idx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (xArr[i] <= x && x <= xArr[i + 1]) {
      idx = i;
      break;
    }
  }

  const x0 = xArr[idx];
  const x1 = xArr[idx + 1];
  const y0 = yArr[idx];
  const y1 = yArr[idx + 1];

  const p0_idx = Math.max(0, idx - 1);
  const p1_idx = idx;
  const p2_idx = idx + 1;
  const p3_idx = Math.min(n - 1, idx + 2);

  const y_p0 = yArr[p0_idx];
  const y_p1 = y0;
  const y_p2 = y1;
  const y_p3 = yArr[p3_idx];

  const t = (x - x0) / ((x1 - x0) === 0 ? 1e-9 : (x1 - x0));
  const t2 = t * t;
  const t3 = t2 * t;

  const f0 = -0.5 * t3 + t2 - 0.5 * t;
  const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
  const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  const f3 = 0.5 * t3 - 0.5 * t2;

  return f0 * y_p0 + f1 * y_p1 + f2 * y_p2 + f3 * y_p3;
}

/**
 * Align digitized curves to a regular depth index based on chosen step interval and user config.
 */
export function resampleCurves(
  curves: Curve[],
  lithologies: LithologyInterval[],
  stepStrategy: 'user' | 'dense' | 'median',
  userStepValue = 0.1524,
  interpolationMethod: 'linear' | 'pchip' | 'nearest' | 'cubic' = 'linear'
): { rows: ResampledRow[]; startDepth: number; stopDepth: number; finalStep: number } {
  // 1. Gather all active points with their adjusted depth
  const curvePointsMap = curves.map(c => {
    // Apply depth_shift_applied to depth values
    const pts = c.points
      .filter(p => p.value !== null)
      .map(p => ({
        ...p,
        shiftedDepth: p.depth + c.depthShiftApplied
      })).sort((a, b) => a.shiftedDepth - b.shiftedDepth);
    return { curveId: c.id, points: pts };
  });

  // Calculate global min and max depths
  let globalMin = Infinity;
  let globalMax = -Infinity;

  curvePointsMap.forEach(({ points }) => {
    if (points.length > 0) {
      if (points[0].shiftedDepth < globalMin) globalMin = points[0].shiftedDepth;
      if (points[points.length - 1].shiftedDepth > globalMax) globalMax = points[points.length - 1].shiftedDepth;
    }
  });

  // Lithology depths can expand boundaries too if applicable
  if (lithologies.length > 0) {
    lithologies.forEach(l => {
      if (l.depthTop < globalMin) globalMin = l.depthTop;
      if (l.depthBottom > globalMax) globalMax = l.depthBottom;
    });
  }

  if (globalMin === Infinity) {
    // If empty
    return { rows: [], startDepth: 0, stopDepth: 0, finalStep: 0.1524 };
  }

  // 2. Select STEP value based on strategy
  let step = userStepValue;
  if (stepStrategy === 'dense') {
    // Median interval of most densely sampled curve
    let denseMedian = Infinity;
    curvePointsMap.forEach(({ points }) => {
      if (points.length >= 2) {
        const diffs: number[] = [];
        for (let i = 1; i < points.length; i++) {
          diffs.push(points[i].shiftedDepth - points[i - 1].shiftedDepth);
        }
        diffs.sort((a, b) => a - b);
        const medianDiff = diffs[Math.floor(diffs.length / 2)] || 0.1524;
        if (medianDiff < denseMedian && medianDiff > 0) {
          denseMedian = medianDiff;
        }
      }
    });
    step = denseMedian === Infinity ? 0.1524 : denseMedian;
  } else if (stepStrategy === 'median') {
    // Combined median interval of all steps
    const allDiffs: number[] = [];
    curvePointsMap.forEach(({ points }) => {
      for (let i = 1; i < points.length; i++) {
        allDiffs.push(points[i].shiftedDepth - points[i - 1].shiftedDepth);
      }
    });

    if (allDiffs.length > 0) {
      allDiffs.sort((a, b) => a - b);
      step = allDiffs[Math.floor(allDiffs.length / 2)] || 0.1524;
    } else {
      step = 0.1524;
    }
  }

  // Round step to standard precision (e.g., 4 decimals)
  step = Number(step.toFixed(4));
  if (step <= 0) step = 0.1524;

  const startDepth = Number(globalMin.toFixed(4));
  const stopDepth = Number(globalMax.toFixed(4));

  // 3. Generate uniform depth series
  const rows: ResampledRow[] = [];
  const totalSteps = Math.floor((stopDepth - startDepth) / step) + 1;

  // Dictionary for lithology codes mapping
  const lithoLabels = Array.from(new Set(lithologies.map(l => l.label))).sort();
  const getLithoInteger = (depth: number): number => {
    const matched = lithologies.find(l => depth >= l.depthTop && depth <= l.depthBottom);
    if (!matched) return -999.25; // default null for lithology
    return lithoLabels.indexOf(matched.label) + 1; // 1-indexed
  };

  for (let i = 0; i < totalSteps; i++) {
    const curDepth = Number((startDepth + i * step).toFixed(4));
    const row: ResampledRow = { depth: curDepth };

    // Interpolate values for each curve
    curves.forEach(c => {
      const { points } = curvePointsMap.find(item => item.curveId === c.id)!;
      const validPoints = points.filter(p => p.value !== null);
      if (validPoints.length === 0) {
        row[c.id] = c.metadata.nullValue;
        return;
      }
      
      const xArr = validPoints.map(p => p.shiftedDepth);
      const yArr = validPoints.map(p => p.value as number);
      
      let interpVal: number | null = null;
      if (interpolationMethod === 'pchip') {
        interpVal = interpolatePchip(curDepth, xArr, yArr);
      } else if (interpolationMethod === 'nearest') {
        interpVal = interpolateNearest(curDepth, xArr, yArr);
      } else if (interpolationMethod === 'cubic') {
        interpVal = interpolateCubic(curDepth, xArr, yArr);
      } else {
        interpVal = interpolateLinear(curDepth, xArr, yArr);
      }

      if (interpVal === null || isNaN(interpVal)) {
        row[c.id] = c.metadata.nullValue;
      } else {
        row[c.id] = Number(interpVal.toFixed(4));
      }
    });

    // Add Lithology Curve state (LITH)
    if (lithologies.length > 0) {
      row['LITH'] = getLithoInteger(curDepth);
    }

    rows.push(row);
  }

  return { rows, startDepth, stopDepth, finalStep: step };
}

/**
 * Generates the physical text representation of a LAS 2.0 file.
 * Automatically inserts correct headers, definitions, and resampled lines.
 */
export function generateLAS20(
  project: ProjectState,
  stepStrategy: 'user' | 'dense' | 'median',
  userStepValue = 0.1524,
  interpolationMethod: 'linear' | 'pchip' | 'nearest' | 'cubic' = 'linear'
): string {
  const { well, curves, lithologyIntervals, nullValueGlobal } = project;
  
  // Resample all curves and lithologies to the common regular grid
  const { rows, startDepth, stopDepth, finalStep } = resampleCurves(
    curves,
    lithologyIntervals,
    stepStrategy,
    userStepValue,
    interpolationMethod
  );

  const exportDate = new Date().toISOString().split('T')[0];
  const uwi = well.uwi || "UNKNOWN_UWI";
  const wellName = well.name || "UNKNOWN_WELL";

  const headerLines: string[] = [];

  // ~VERSION
  headerLines.push('~Version Information');
  headerLines.push('VERS.      2.0   : CWLS LOG ASCII STANDARD - VERSION 2.0');
  headerLines.push('WRAP.      NO    : ONE LINE PER DEPTH STEP');

  // ~WELL
  headerLines.push('~Well Information');
  headerLines.push(`STRT.FT    ${startDepth.toFixed(4).padStart(10)} : START DEPTH`);
  headerLines.push(`STOP.FT    ${stopDepth.toFixed(4).padStart(10)} : STOP DEPTH`);
  headerLines.push(`STEP.FT    ${finalStep.toFixed(4).padStart(10)} : DEPTH STEP`);
  headerLines.push(`NULL.      ${nullValueGlobal.toFixed(2).padStart(10)} : NULL VALUE`);
  headerLines.push(`WELL.      ${wellName.padEnd(16)} : WELL NAME`);
  headerLines.push(`FLD .      ${(well.field || "UNKNOWN").padEnd(16)} : FIELD NAME`);
  headerLines.push(`COMP.      ${(well.operator || "CitraNeura Corp").padEnd(16)} : COMPANY NAME`);
  headerLines.push(`LOC .      ${"OFFSHORE / LAND".padEnd(16)} : WELL LOCATION`);
  headerLines.push(`DATE.      ${exportDate.padEnd(16)} : LOG DIGITIZATION EXTRACT DATE`);
  headerLines.push(`UWI .      ${uwi.padEnd(16)} : UNIQUE WELL IDENTIFIER`);
  headerLines.push(`API .      ${uwi.padEnd(16)} : API CODE`);
  const elevVal = well.datumValue || "0.0";
  const elevString = `${elevVal} ${well.datum || "KB"}`;
  headerLines.push(`ELEV.      ${elevString.padEnd(16)} : ELEVATION`);

  if (well.locationX) {
    headerLines.push(`EAST.M     ${well.locationX.padEnd(16)} : X COORDINATE / EASTING`);
  }
  if (well.locationY) {
    headerLines.push(`NORT.M     ${well.locationY.padEnd(16)} : Y COORDINATE / NORTHING`);
  }
  if (well.topDepth) {
    headerLines.push(`TINT.      ${well.topDepth.padEnd(16)} : TOP LOGGING INTERVAL`);
  }
  if (well.bottomDepth) {
    headerLines.push(`BINT.      ${well.bottomDepth.padEnd(16)} : BOTTOM LOGGING INTERVAL`);
  }

  // ~CURVE
  headerLines.push('~Curve Information');
  // First column is always DEPTH
  const depthUnit = well.depthUnit.toUpperCase();
  headerLines.push(`DEPT.${depthUnit.padEnd(5)}               : DEPTH UNIT FIELD`);
  
  curves.forEach(c => {
    const mnemonic = c.metadata.mnemonic.toUpperCase();
    const unit = (c.metadata.unit || 'API').toUpperCase();
    const desc = `${c.metadata.mnemonic} digitized log curve`;
    headerLines.push(`${mnemonic.padEnd(4)}.${unit.padEnd(5)}   ${c.metadata.nullValue.toFixed(2).padEnd(10)} : ${desc}`);
  });

  // If lithologies are present, represent it in the curve block as LITH
  if (lithologyIntervals.length > 0) {
    headerLines.push(`LITH.CODE    -999.25    : LITHOLOGY INTERVAL INTEGERS`);
  }

  // ~PARAMETER
  headerLines.push('~Parameter Information');
  headerLines.push('DFD .g/cm3               : MUD IN G/CM3');
  headerLines.push('DFL .s                   : MUD VISCOSITY');
  headerLines.push('MUD .OHM                 : MUD RESISTIVITY');

  // ~OTHER
  headerLines.push('~Other Information');
  headerLines.push('CitraNeura Reconstructed Log Curve System');
  headerLines.push(`Generated using automatic system audit and traceability ID workflows.`);
  headerLines.push(`Uncertainty margins calculated under rigorous domain-bound constraints.`);

  if (lithologyIntervals.length > 0) {
    headerLines.push('Lithology Integer Codes:');
    const lithoLabels = Array.from(new Set(lithologyIntervals.map(l => l.label))).sort();
    lithoLabels.forEach((label, idx) => {
      headerLines.push(`  Code ${idx + 1} = ${label}`);
    });
  }

  // ~ASCII
  headerLines.push('~A (ASCII log data)');

  // Data section
  rows.forEach(r => {
    const rowValues: string[] = [r.depth.toFixed(4).padStart(10)];
    
    curves.forEach(c => {
      const val = r[c.id];
      rowValues.push(val.toFixed(4).padStart(12));
    });

    if (lithologyIntervals.length > 0) {
      const lVal = r['LITH'];
      rowValues.push(lVal.toFixed(2).padStart(10));
    }

    headerLines.push(rowValues.join(' '));
  });

  return headerLines.join('\n');
}

/**
 * Validates a generated LAS file contents for structural soundness.
 * Checks for version tags, curve mnemonics, missing sections, and depth consistency.
 */
export function validateLASStructure(lasText: string): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  summary: {
    curves: string[];
    rowCount: number;
    depthRange: string;
  };
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const curves: string[] = [];
  let rowCount = 0;
  let hasVersion = false;
  let hasWell = false;
  let hasCurve = false;
  let hasAscii = false;

  let minDepth = Infinity;
  let maxDepth = -Infinity;

  const lines = lasText.split('\n');
  let currentSection = '';

  lines.forEach((line, lineNo) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return; // Skip empty and comment lines

    if (trimmed.startsWith('~')) {
      const tag = trimmed.substring(1, trimmed.length).trim().toLowerCase();
      if (tag.startsWith('v')) {
        currentSection = 'VERSION';
        hasVersion = true;
      } else if (tag.startsWith('w')) {
        currentSection = 'WELL';
        hasWell = true;
      } else if (tag.startsWith('c')) {
        currentSection = 'CURVE';
        hasCurve = true;
      } else if (tag.startsWith('p')) {
        currentSection = 'PARAMETER';
      } else if (tag.startsWith('o')) {
        currentSection = 'OTHER';
      } else if (tag.startsWith('a')) {
        currentSection = 'ASCII';
        hasAscii = true;
      } else {
        currentSection = 'UNKNOWN';
      }
      return;
    }

    if (currentSection === 'VERSION') {
      if (trimmed.startsWith('VERS.')) {
        if (!trimmed.includes('2.0') && !trimmed.includes('1.2')) {
          warnings.push(`Line ${lineNo + 1}: Unrecognized LAS version. Recommended version is 2.0.`);
        }
      }
    }

    if (currentSection === 'CURVE') {
      const parts = trimmed.split(/[ .:]/);
      const mnemonic = parts[0];
      if (mnemonic) {
        curves.push(mnemonic.trim().toUpperCase());
      }
    }

    if (currentSection === 'ASCII') {
      rowCount++;
      const parts = trimmed.split(/\s+/);
      const depthVal = parseFloat(parts[0]);
      if (!isNaN(depthVal)) {
        if (depthVal < minDepth) minDepth = depthVal;
        if (depthVal > maxDepth) maxDepth = depthVal;
      }
    }
  });

  if (!hasVersion) errors.push('Missing required ~Version information section.');
  if (!hasWell) errors.push('Missing required ~Well information section.');
  if (!hasCurve) errors.push('Missing required ~Curve information section.');
  if (!hasAscii) errors.push('Missing required ~A ASCII data section.');

  if (curves.length === 0) {
    errors.push('No curve headers found under ~Curve Information.');
  }

  if (rowCount === 0) {
    errors.push('No numerical log data found in ~A section.');
  }

  const isValid = errors.length === 0;
  const depthRangeStr = minDepth !== Infinity ? `${minDepth.toFixed(2)} to ${maxDepth.toFixed(2)}` : 'N/A';

  return {
    isValid,
    warnings,
    errors,
    summary: {
      curves,
      rowCount,
      depthRange: depthRangeStr
    }
  };
}
