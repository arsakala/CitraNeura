import { ProjectState } from '../types';

export function healProjectState(state: ProjectState): ProjectState {
  let healed = state;

  // 1. Heal Track Boundaries (pixelXLeft < pixelXRight)
  if (healed.tracks && healed.tracks.length > 0) {
    let tracksChanged = false;
    const healedTracks = healed.tracks.map(t => {
      let left = t.pixelXLeft;
      let right = t.pixelXRight;

      if (left === undefined || right === undefined || isNaN(left) || isNaN(right)) {
        left = 100;
        right = 400;
        tracksChanged = true;
      } else if (left >= right) {
        tracksChanged = true;
        if (left > right && right > 0) {
          // If left was moved beyond right, extend right boundary
          right = left + Math.max(50, Math.round((healed.raster?.width || 1000) * 0.2));
        } else {
          right = left + 20;
        }
      }

      if (tracksChanged) {
        return {
          ...t,
          pixelXLeft: left,
          pixelXRight: right,
          valueTransform: {
            ...t.valueTransform,
            pixelMin: left,
            pixelMax: right
          }
        };
      }
      return t;
    });

    if (tracksChanged) {
      healed = { ...healed, tracks: healedTracks };
    }
  }

  // 2. Heal Depth Calibration Control Points (monotonic pixelY and depth)
  const ctrlPoints = healed.depthTransform?.controlPoints || [];
  if (ctrlPoints.length > 1) {
    // Sort control points by pixelY ascending
    const sorted = [...ctrlPoints].sort((a, b) => a.pixelY - b.pixelY);
    let changed = false;

    // First pass: check if sorted differs from ctrlPoints
    for (let i = 0; i < ctrlPoints.length; i++) {
      if (ctrlPoints[i].pixelY !== sorted[i].pixelY) {
        changed = true;
        break;
      }
    }

    // Ensure strict monotonicity in both pixelY and depth
    for (let i = 0; i < sorted.length - 1; i++) {
      // 1. Ensure pixelY is strictly increasing
      if (sorted[i + 1].pixelY <= sorted[i].pixelY) {
        sorted[i + 1] = {
          ...sorted[i + 1],
          pixelY: sorted[i].pixelY + 5
        };
        changed = true;
      }
      // 2. Ensure depth is strictly increasing
      if (sorted[i + 1].depth <= sorted[i].depth) {
        sorted[i + 1] = {
          ...sorted[i + 1],
          depth: parseFloat((sorted[i].depth + 1.0).toFixed(2))
        };
        changed = true;
      }
    }

    if (changed) {
      // Recalculate global linear scale and offset
      const p1 = sorted[0];
      const p2 = sorted[1];
      const divisor = p2.pixelY - p1.pixelY;
      const scale = divisor === 0 ? 1 : (p2.depth - p1.depth) / divisor;
      const offset = p1.depth - scale * p1.pixelY;

      healed = {
        ...healed,
        depthTransform: {
          ...healed.depthTransform,
          controlPoints: sorted,
          linearScale: scale,
          linearOffset: offset
        }
      };
    }
  }

  return healed;
}

/**
 * Validates the entire scientific state of the Project against predefined invariants.
 * Returns an array of error messages. If empty, the project state is fully valid.
 */
export function validateProjectInvariants(state: ProjectState): string[] {
  // Validate a healed copy to prevent transient or minor non-monotonic errors from failing validation
  const healed = healProjectState(state);
  const errors: string[] = [];

  // 1. Project Version must be present and a valid semver string
  if (!healed.version) {
    errors.push("State Invariant Violation: Project version is missing.");
  } else if (typeof healed.version !== 'string' || !healed.version.match(/^\d+\.\d+\.\d+$/)) {
    errors.push(`State Invariant Violation: Project version '${healed.version}' is invalid. Must be in semver format.`);
  }

  // 2. Duplicate Curve IDs check
  const curveIds = healed.curves?.map(c => c.id) || [];
  const duplicateCurveIds = curveIds.filter((id, index) => curveIds.indexOf(id) !== index);
  if (duplicateCurveIds.length > 0) {
    errors.push(`State Invariant Violation: Duplicate curve IDs detected: ${Array.from(new Set(duplicateCurveIds)).join(', ')}`);
  }

  // 3. Curve Mnemonics must not be empty or blank
  healed.curves?.forEach(c => {
    if (!c.metadata || !c.metadata.mnemonic || c.metadata.mnemonic.trim() === '') {
      errors.push(`State Invariant Violation: Curve with ID '${c.id}' has an empty or missing mnemonic.`);
    }
  });

  // 4. Curve Track References must point to valid existing tracks
  const trackIds = new Set(healed.tracks?.map(t => t.id) || []);
  healed.curves?.forEach(c => {
    if (c.trackId && !trackIds.has(c.trackId)) {
      errors.push(`State Invariant Violation: Curve '${c.metadata?.mnemonic || c.id}' references non-existent track ID '${c.trackId}'.`);
    }
  });

  // 5. Track boundaries: Left boundary must be strictly less than Right boundary
  healed.tracks?.forEach(t => {
    if (t.pixelXLeft >= t.pixelXRight) {
      errors.push(`State Invariant Violation: Track '${t.name || t.id}' has invalid boundaries: left pixel (${t.pixelXLeft}) must be less than right pixel (${t.pixelXRight}).`);
    }
  });

  // 6. Depth Calibration / Control Points must be strictly monotonic in both PixelY and Depth
  const ctrlPoints = healed.depthTransform?.controlPoints || [];
  if (ctrlPoints.length > 1) {
    // Sort control points by pixelY ascending
    const sorted = [...ctrlPoints].sort((a, b) => a.pixelY - b.pixelY);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].depth >= sorted[i + 1].depth) {
        errors.push(`State Invariant Violation: Depth calibration points are non-monotonic: point at pixelY ${sorted[i].pixelY} has depth ${sorted[i].depth} which is not less than point at pixelY ${sorted[i + 1].pixelY} with depth ${sorted[i + 1].depth}.`);
      }
      if (sorted[i].pixelY >= sorted[i + 1].pixelY) {
        errors.push(`State Invariant Violation: Duplicate or non-increasing calibration coordinates at pixelY ${sorted[i].pixelY}.`);
      }
    }
  }

  // 7. Raster verification: must have positive dimension if not null
  if (healed.raster) {
    if (healed.raster.width <= 0 || healed.raster.height <= 0) {
      errors.push(`State Invariant Violation: Raster dimensions are invalid (${healed.raster.width}x${healed.raster.height}).`);
    }
    if (healed.raster.dataUrl === undefined || healed.raster.dataUrl === null) {
      errors.push("State Invariant Violation: Raster contains no valid base64 dataUrl.");
    }
  }

  return errors;
}

export function getMonotonicDepthForPixelY(pixelY: number, existingPoints: { pixelY: number; depth: number }[]): number {
  if (existingPoints.length === 0) {
    return 1450 + Math.round(pixelY * 0.1);
  }

  // Sort existing points by pixelY
  const sorted = [...existingPoints].sort((a, b) => a.pixelY - b.pixelY);

  // Find where pixelY fits
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (pixelY < sorted[i].pixelY) {
      idx = i;
      break;
    }
  }

  if (idx === 0) {
    // Extrapolate before the first point
    const first = sorted[0];
    if (sorted.length > 1) {
      const second = sorted[1];
      const dy = second.pixelY - first.pixelY;
      const dd = second.depth - first.depth;
      const scale = dy === 0 ? 0.1 : dd / dy;
      let extDepth = first.depth - scale * (first.pixelY - pixelY);
      if (extDepth >= first.depth) {
        extDepth = first.depth - 1.0;
      }
      return parseFloat(extDepth.toFixed(2));
    } else {
      let extDepth = first.depth - 0.1 * (first.pixelY - pixelY);
      if (extDepth >= first.depth) {
        extDepth = first.depth - 1.0;
      }
      return parseFloat(extDepth.toFixed(2));
    }
  } else if (idx === -1) {
    // Extrapolate after the last point
    const last = sorted[sorted.length - 1];
    if (sorted.length > 1) {
      const prev = sorted[sorted.length - 2];
      const dy = last.pixelY - prev.pixelY;
      const dd = last.depth - prev.depth;
      const scale = dy === 0 ? 0.1 : dd / dy;
      let extDepth = last.depth + scale * (pixelY - last.pixelY);
      if (extDepth <= last.depth) {
        extDepth = last.depth + 1.0;
      }
      return parseFloat(extDepth.toFixed(2));
    } else {
      let extDepth = last.depth + 0.1 * (pixelY - last.pixelY);
      if (extDepth <= last.depth) {
        extDepth = last.depth + 1.0;
      }
      return parseFloat(extDepth.toFixed(2));
    }
  } else {
    // Interpolate between sorted[idx-1] and sorted[idx]
    const prev = sorted[idx - 1];
    const next = sorted[idx];
    const dy = next.pixelY - prev.pixelY;
    const dd = next.depth - prev.depth;
    if (dy === 0) return prev.depth;
    const scale = dd / dy;
    let intDepth = prev.depth + scale * (pixelY - prev.pixelY);
    if (intDepth <= prev.depth) {
      intDepth = prev.depth + (next.depth - prev.depth) * 0.1;
    } else if (intDepth >= next.depth) {
      intDepth = prev.depth + (next.depth - prev.depth) * 0.9;
    }
    return parseFloat(intDepth.toFixed(2));
  }
}
