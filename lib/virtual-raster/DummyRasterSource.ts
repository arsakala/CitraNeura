import { RasterSource, RasterMetadata } from './types';

export class DummyRasterSource implements RasterSource {
  private width: number = 2048;
  private height: number = 50000;
  private delayMs: number = 30; // simulate decode time

  async open(fileOrUrl: any): Promise<void> {
    // No-op for dummy
  }

  getMetadata(): RasterMetadata {
    return {
      width: this.width,
      height: this.height,
      fileSize: 1024 * 1024 * 500, // Fake 500MB
      checksum: 'dummy-sha-256'
    };
  }

  async getTile(level: number, tileIndex: number, bounds: { x: number, y: number, width: number, height: number }): Promise<ImageBitmap> {
    // Simulate network/decode delay
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    
    // Create a synthetic canvas
    const canvas = document.createElement('canvas');
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const ctx = canvas.getContext('2d')!;

    // Draw background
    const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa'];
    ctx.fillStyle = colors[tileIndex % colors.length];
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    for (let i = 0; i < canvas.width; i += 100) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 100) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw text
    ctx.fillStyle = '#000000';
    ctx.font = '48px monospace';
    ctx.fillText(`Tile Index: ${tileIndex}`, 50, 100);
    ctx.fillText(`Level: ${level}`, 50, 160);
    ctx.fillText(`Y: ${bounds.y} to ${bounds.y + bounds.height}`, 50, 220);

    return createImageBitmap(canvas);
  }

  dispose(): void {
    // Cleanup if needed
  }
}
