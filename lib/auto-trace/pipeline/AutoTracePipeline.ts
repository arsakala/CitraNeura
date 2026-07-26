/**
 * Integrated Auto-Trace Pipeline Facade.
 * 
 * Provides unified interface connecting client application layers (Digitizer Workspace,
 * VirtualRaster, Commands) with the native scientific AutoTraceEngine.
 */

import { AutoTraceEngine, RawRasterInput } from './AutoTraceEngine';
import { AutoTraceResult } from '../model/TraceResult';
import { AutoTraceParameters } from '../model/Parameters';

export class AutoTracePipeline {
  /**
   * Executes scientific auto-trace over raster ImageData.
   */
  public static traceTrack(
    imageData: ImageData,
    seedX: number,
    seedY: number,
    trackLeft: number,
    trackRight: number,
    targetRGB: { r: number; g: number; b: number },
    params?: Partial<AutoTraceParameters>
  ): AutoTraceResult {
    const input: RawRasterInput = {
      imageData,
      trackLeft: Math.max(0, Math.floor(trackLeft)),
      trackRight: Math.min(imageData.width - 1, Math.ceil(trackRight)),
      seedX,
      seedY,
      targetRGB
    };

    return AutoTraceEngine.execute(input, params);
  }
}
