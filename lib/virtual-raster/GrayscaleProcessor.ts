import { RasterProcessor, ProcessorContext } from './types';

export class GrayscaleProcessor implements RasterProcessor {
  id = 'grayscale';
  name = 'Grayscale';
  enabled = true;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  async process(data: ImageData, context: ProcessorContext): Promise<ImageData> {
    if (!this.enabled) return data;
    const pixels = data.data;
    const len = pixels.length;
    for (let i = 0; i < len; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
    }
    return data;
  }
}
