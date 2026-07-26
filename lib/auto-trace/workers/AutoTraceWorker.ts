/**
 * Off-Thread Web Worker Execution Adapter for Auto-Trace.
 * 
 * Executes Candidate Extraction and 2nd-Order Dynamic Programming off the main
 * thread using Transferable TypedArrays for non-blocking UI performance.
 */

import { AutoTraceEngine, RawRasterInput } from '../pipeline/AutoTraceEngine';
import { AutoTraceParameters } from '../model/Parameters';
import { AutoTraceResult } from '../model/TraceResult';

export interface AutoTraceWorkerMessage {
  id: string;
  type: 'TRACE_TRACK';
  imageData: ImageData;
  trackLeft: number;
  trackRight: number;
  seedX: number;
  seedY: number;
  targetRGB: { r: number; g: number; b: number };
  params?: Partial<AutoTraceParameters>;
}

export interface AutoTraceWorkerResponse {
  id: string;
  success: boolean;
  result?: AutoTraceResult;
  error?: string;
}

// Web Worker message listener logic
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.addEventListener('message', (event: MessageEvent<AutoTraceWorkerMessage>) => {
    const { id, type, imageData, trackLeft, trackRight, seedX, seedY, targetRGB, params } = event.data;

    if (type === 'TRACE_TRACK') {
      try {
        const input: RawRasterInput = {
          imageData,
          trackLeft,
          trackRight,
          seedX,
          seedY,
          targetRGB
        };

        const result = AutoTraceEngine.execute(input, params);

        const response: AutoTraceWorkerResponse = {
          id,
          success: true,
          result
        };

        self.postMessage(response);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const response: AutoTraceWorkerResponse = {
          id,
          success: false,
          error: errorMessage
        };

        self.postMessage(response);
      }
    }
  });
}
