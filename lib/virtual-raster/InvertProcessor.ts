import { RasterProcessor, ProcessorContext } from './types';

export class InvertProcessor implements RasterProcessor {
  id = 'invert';
  name = 'Invert';
  enabled = true;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  async process(data: ImageData, context: ProcessorContext): Promise<ImageData> {
    if (!this.enabled) return data;
    const pixels = data.data;
    const len = pixels.length;
    for (let i = 0; i < len; i += 4) {
      pixels[i] = 255 - pixels[i];
      pixels[i + 1] = 255 - pixels[i + 1];
      pixels[i + 2] = 255 - pixels[i + 2];
    }
    return data;
  }
}
