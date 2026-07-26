import { TracedPoint, QualityMetrics, GapSegment, GeometryMetrics as GeometryMetricsType, QualityComponents } from '../model/TraceResult';
import { GeometryMetrics } from './GeometryMetrics';

function clamp01(v: number): number {
  return Math.min(1.0, Math.max(0.0, v));
}

export function qV2dScore(
  metrics: GeometryMetricsType,
  refs: { readonly cRef: number; readonly dRef: number; readonly hRefPx: number },
): { q: number; components: QualityComponents } {
  const gCurv = clamp01(1.0 - metrics.mean_abs_curvature_px / refs.cRef);
  const gDir = clamp01(1.0 - metrics.direction_changes_per_100_rows / refs.dRef);
  const gHfAbs = clamp01(1.0 - metrics.hf_rms_px / refs.hRefPx);
  const q = Math.min(gCurv, gDir, gHfAbs);
  return { q, components: { g_curv: gCurv, g_dir: gDir, g_hf_abs: gHfAbs } };
}

export class QualityScore {
  public static evaluate(points: TracedPoint[], gaps: GapSegment[]): QualityMetrics {
    const totalRows = points.length;
    if (totalRows === 0) {
      return {
        qV2d: 1.0,
        segmentScores: [1.0],
        meanCurvature: 0.0,
        maxDiscontinuity: 0.0,
        completionRate: 0.0,
        gapRecoveryRate: 0.0
      };
    }

    const segments: TracedPoint[][] = [];
    let currentSeg: TracedPoint[] = [];

    let nonNanCount = 0;
    let maxDiscontinuity = 0;

    for (let i = 0; i < totalRows; i++) {
      const p = points[i]!;
      if (!Number.isNaN(p.x)) {
        nonNanCount++;
        if (currentSeg.length > 0) {
          const prev = currentSeg[currentSeg.length - 1]!;
          const stepX = Math.abs(p.x - prev.x);
          if (stepX > maxDiscontinuity) maxDiscontinuity = stepX;
        }
        currentSeg.push(p);
      } else {
        if (currentSeg.length > 0) {
          segments.push(currentSeg);
          currentSeg = [];
        }
      }
    }
    if (currentSeg.length > 0) {
      segments.push(currentSeg);
    }

    const segmentScores: number[] = [];
    if (segments.length === 0) {
      segmentScores.push(0.0);
    } else {
      for (let i = 0; i < segments.length; i++) {
        const segScore = GeometryMetrics.computeQV2DForSegment(segments[i]!);
        segmentScores.push(segScore);
      }
    }

    let worstQV2d = 1.0;
    for (let i = 0; i < segmentScores.length; i++) {
      if (segmentScores[i]! < worstQV2d) {
        worstQV2d = segmentScores[i]!;
      }
    }

    const completionRate = Number(((nonNanCount / totalRows) * 100.0).toFixed(2));
    const totalGaps = gaps.length;
    const recoveredGaps = gaps.filter(g => g.reason !== 'faded_ink').length;
    const gapRecoveryRate = totalGaps > 0 ? Number(((recoveredGaps / totalGaps) * 100.0).toFixed(2)) : 100.0;

    return {
      qV2d: Number(worstQV2d.toFixed(4)),
      segmentScores,
      meanCurvature: 0.0,
      maxDiscontinuity: Number(maxDiscontinuity.toFixed(2)),
      completionRate,
      gapRecoveryRate
    };
  }
}
