import { RasterSource, RasterMetadata } from './types';

export class ImageBlobRasterSource implements RasterSource {
  private blob: Blob | null = null;
  private metadata: RasterMetadata | null = null;

  async open(fileOrUrl: Blob | string): Promise<void> {
    if (typeof fileOrUrl === 'string') {
      const response = await fetch(fileOrUrl);
      this.blob = await response.blob();
    } else {
      this.blob = fileOrUrl;
    }

    try {
      const tempBitmap = await createImageBitmap(this.blob);
      this.metadata = {
        width: tempBitmap.width,
        height: tempBitmap.height,
        fileSize: this.blob.size,
        checksum: `blob-${this.blob.size}-${Date.now()}` // simple mock checksum
      };
      tempBitmap.close();
    } catch (e: any) {
      throw new Error(`Failed to decode image metadata. The browser might not support this format natively (e.g., TIFF is only supported in Safari) or the image dimensions exceed browser limits. Inner error: ${e.message}`);
    }
  }

  getMetadata(): RasterMetadata {
    if (!this.metadata) throw new Error("Source not opened");
    return this.metadata;
  }

  async getTile(level: number, tileIndex: number, bounds: { x: number, y: number, width: number, height: number }): Promise<ImageBitmap> {
    if (!this.blob || !this.metadata) throw new Error("Source not opened");
    
    // Modern browsers support cropping during decode:
    return createImageBitmap(this.blob, bounds.x, bounds.y, bounds.width, bounds.height);
  }

  async getThumbnail(maxDimension: number): Promise<ImageBitmap | null> {
    if (!this.blob || !this.metadata) return null;
    
    // Smart scaling for well logs: ensure adequate width while avoiding excessive height (max 16384)
    let scale = 1.0;
    const targetWidth = Math.min(this.metadata.width, 600);
    scale = targetWidth / this.metadata.width;
    
    let proposedHeight = Math.round(this.metadata.height * scale);
    if (proposedHeight > 16384) {
      scale = 16384 / this.metadata.height;
    }
    
    const destWidth = Math.round(this.metadata.width * scale);
    const destHeight = Math.round(this.metadata.height * scale);
    
    return createImageBitmap(this.blob, {
      resizeWidth: Math.max(1, destWidth),
      resizeHeight: Math.max(1, destHeight),
      resizeQuality: 'high'
    });
  }

  dispose(): void {
    this.blob = null;
    this.metadata = null;
  }
}
