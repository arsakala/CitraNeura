import { ProcessorContext, RasterProcessor } from './types';
import { CLAHEProcessor } from './CLAHEProcessor';
import { InvertProcessor } from './InvertProcessor';
import { GrayscaleProcessor } from './GrayscaleProcessor';

// A registry of available processors
const processorRegistry: Record<string, new (options: any) => RasterProcessor> = {
  'clahe': CLAHEProcessor,
  'invert': InvertProcessor,
  'grayscale': GrayscaleProcessor
};

self.onmessage = async (e) => {
  const { type, payload, id } = e.data;

  if (type === 'PROCESS_TILE') {
    const { bitmap, bounds, padding, processorsConfig, context } = payload;
    const destWidth = bounds.width;
    const destHeight = bounds.height;

    try {
      // 1. Draw ImageBitmap to OffscreenCanvas
      const canvas = new OffscreenCanvas(destWidth, destHeight);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0);
      let imageData = ctx.getImageData(0, 0, destWidth, destHeight);
      bitmap.close();

      // 2. Instantiate and run processors
      for (const config of processorsConfig) {
        if (!config.enabled) continue;
        const ProcessorClass = processorRegistry[config.id];
        if (ProcessorClass) {
          const processor = new ProcessorClass(config);
          imageData = await processor.process(imageData, context);
        } else {
          console.warn(`Processor ${config.id} not found in worker registry`);
        }
      }

      // 3. Crop back to original bounds
      let finalBitmap: ImageBitmap;
      if (padding.left > 0 || padding.top > 0 || padding.right > 0 || padding.bottom > 0) {
         finalBitmap = await createImageBitmap(imageData, padding.left, padding.top, bounds.originalWidth, bounds.originalHeight);
      } else {
         finalBitmap = await createImageBitmap(imageData);
      }

      // 4. Send back the final ImageBitmap, transferring it
      (self as any).postMessage({ type: 'PROCESS_RESULT', id, payload: { bitmap: finalBitmap } }, [finalBitmap]);

    } catch (err: any) {
      (self as any).postMessage({ type: 'PROCESS_ERROR', id, payload: { error: err.message } });
    }
  }
};
