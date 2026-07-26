import { RasterProcessor, ProcessorContext } from './types';

export class CLAHEProcessor implements RasterProcessor {
  id = 'clahe';
  name = 'CLAHE';
  enabled = true;
  clipLimit: number;
  tiles: number;

  constructor(options: { clipLimit?: number; tiles?: number; enabled?: boolean } = {}) {
    this.clipLimit = options.clipLimit ?? 2.0;
    this.tiles = options.tiles ?? 4;
    this.enabled = options.enabled ?? true;
  }

  async process(data: ImageData, context: ProcessorContext): Promise<ImageData> {
    if (!this.enabled) return data;
    
    const width = data.width;
    const height = data.height;
    const pixels = data.data;
    
    const result = new ImageData(new Uint8ClampedArray(pixels), width, height);
    const resData = result.data;
    
    // Convert RGB to HSL, apply CLAHE on L, convert back.
    // To be efficient and keep it simple for the tile, we will apply a histogram equalization 
    // on the lightness channel.
    
    // Note: A true CLAHE divides the image into gridSize x gridSize.
    // Since this is applied per-tile, we divide the tile itself.
    const gridX = this.tiles;
    const gridY = this.tiles;
    
    const tileW = Math.ceil(width / gridX);
    const tileH = Math.ceil(height / gridY);
    
    // Extract L channel
    const L = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = pixels[i * 4] / 255;
      const g = pixels[i * 4 + 1] / 255;
      const b = pixels[i * 4 + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      L[i] = (max + min) / 2;
    }
    
    // Compute histograms
    const hists = new Array(gridX * gridY).fill(0).map(() => new Float32Array(256));
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tx = Math.min(Math.floor(x / tileW), gridX - 1);
        const ty = Math.min(Math.floor(y / tileH), gridY - 1);
        const lVal = Math.floor(L[y * width + x] * 255);
        hists[ty * gridX + tx][lVal]++;
      }
    }
    
    // Clip histograms and compute CDF
    const cdfs = new Array(gridX * gridY).fill(0).map(() => new Float32Array(256));
    for (let i = 0; i < gridX * gridY; i++) {
      const hist = hists[i];
      let clipped = 0;
      const limit = this.clipLimit * (tileW * tileH) / 256;
      
      for (let j = 0; j < 256; j++) {
        if (hist[j] > limit) {
          clipped += hist[j] - limit;
          hist[j] = limit;
        }
      }
      
      const redist = clipped / 256;
      let sum = 0;
      for (let j = 0; j < 256; j++) {
        sum += hist[j] + redist;
        cdfs[i][j] = sum / (tileW * tileH);
      }
    }
    
    // Interpolate
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tx = x / tileW - 0.5;
        const ty = y / tileH - 0.5;
        
        const x1 = Math.max(Math.floor(tx), 0);
        const x2 = Math.min(x1 + 1, gridX - 1);
        const y1 = Math.max(Math.floor(ty), 0);
        const y2 = Math.min(y1 + 1, gridY - 1);
        
        const px = tx < 0 ? 0 : (tx > gridX - 1 ? 1 : tx - x1);
        const py = ty < 0 ? 0 : (ty > gridY - 1 ? 1 : ty - y1);
        
        const idx = y * width + x;
        const lVal = Math.floor(L[idx] * 255);
        
        const c11 = cdfs[y1 * gridX + x1][lVal];
        const c12 = cdfs[y1 * gridX + x2][lVal];
        const c21 = cdfs[y2 * gridX + x1][lVal];
        const c22 = cdfs[y2 * gridX + x2][lVal];
        
        const outL = (c11 * (1 - px) * (1 - py) +
                      c12 * px * (1 - py) +
                      c21 * (1 - px) * py +
                      c22 * px * py);
                      
        // Apply back to RGB
        const r = pixels[idx * 4];
        const g = pixels[idx * 4 + 1];
        const b = pixels[idx * 4 + 2];
        const a = pixels[idx * 4 + 3];
        
        const oldL = L[idx];
        let scale = 1;
        if (oldL > 0) {
           scale = outL / oldL;
        }
        
        resData[idx * 4] = Math.min(255, r * scale);
        resData[idx * 4 + 1] = Math.min(255, g * scale);
        resData[idx * 4 + 2] = Math.min(255, b * scale);
        resData[idx * 4 + 3] = a;
      }
    }
    
    return result;
  }
}
