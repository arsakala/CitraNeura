import { fromBlob, GeoTIFF, GeoTIFFImage } from 'geotiff';

let tiff: GeoTIFF | null = null;
let image: GeoTIFFImage | null = null;
let metadata: any | null = null;
let fileBlob: Blob | null = null;

let taskQueue = Promise.resolve();
const cancelledTasks = new Set<number>();

self.onmessage = (e: MessageEvent) => {
  const { type, payload, id } = e.data;
  
  if (type === 'CANCEL') {
    cancelledTasks.add(id);
    return;
  }
  
  taskQueue = taskQueue.then(async () => {
    try {
      if (cancelledTasks.has(id)) {
        cancelledTasks.delete(id);
        self.postMessage({ type: 'ERROR', id, error: 'Cancelled' });
        return;
      }

      if (type === 'OPEN') {
        const { file } = payload;
        fileBlob = file as Blob;
        
        self.postMessage({ type: 'TRACE', payload: 'Worker received file blob, initializing geotiff...' });
        
        const t0 = performance.now();
        tiff = await fromBlob(fileBlob);
        const t1 = performance.now();
        
        image = await tiff.getImage();
        const t2 = performance.now();
        
        const fd = image.getFileDirectory() as any;
        metadata = { 
          width: image.getWidth(), 
          height: image.getHeight(),
          tiffLayout: {
            compression: fd.Compression,
            predictor: fd.Predictor,
            rowsPerStrip: fd.RowsPerStrip,
            tileWidth: fd.TileWidth,
            tileLength: fd.TileLength,
            planarConfiguration: fd.PlanarConfiguration,
            bitsPerSample: fd.BitsPerSample,
            samplesPerPixel: fd.SamplesPerPixel,
            photometricInterpretation: fd.PhotometricInterpretation,
          }
        };
        
        self.postMessage({ type: 'TRACE', payload: `Metadata parsed (${metadata.width}x${metadata.height}) in ${Math.round(t2 - t0)}ms` });
        self.postMessage({ 
          type: 'METRICS', 
          payload: {
            metadataTime: t2 - t0,
            decodeImageTime: 0,
            rgbaTime: 0,
            fullDecodeTime: t2 - t0
          }
        });
        
        self.postMessage({ type: 'OPEN_RESULT', id, payload: metadata });
        
      } else if (type === 'GET_TILE') {
        const { bounds } = payload;
        
        const tWait1 = performance.now();
        
        if (!image || !metadata) throw new Error("Not loaded");
        
        const destWidth = bounds.width;
        const destHeight = bounds.height;
        
        // Calculate the window for GeoTIFF
        const window = [
          bounds.x,
          bounds.y,
          bounds.x + destWidth,
          bounds.y + destHeight
        ];

        let stripTrace = '';
        if (metadata.tiffLayout) {
           const blockH = metadata.tiffLayout.tileLength || metadata.tiffLayout.rowsPerStrip;
           if (blockH) {
             const startBlock = Math.floor(bounds.y / blockH);
             const endBlock = Math.floor((bounds.y + destHeight - 1) / blockH);
             const numBlocks = endBlock - startBlock + 1;
             stripTrace = ` (Reads ${numBlocks} block(s): ${startBlock} to ${endBlock}, h=${blockH})`;
           }
        }
        self.postMessage({ type: 'TRACE', payload: `Tile [y:${bounds.y}] requested. Starting partial decode...${stripTrace}` });
        
        const tDecodeStart = performance.now();
        // Read just the requested window, interleaved (RGBARGBA...)
        const rasters = await image.readRasters({ 
          window,
          interleave: true 
        });
        
        const tExtract = performance.now();
        
        const rasterData = rasters as import('geotiff').TypedArray;
        let imgData: ImageData;
        
        // GeoTIFF usually returns samples per pixel. If it's 3 (RGB) or 4 (RGBA)
        const samplesPerPixel = image.getSamplesPerPixel();
        
        if (samplesPerPixel === 4 && rasterData instanceof Uint8Array) {
          // Fast path for RGBA 8-bit
          imgData = new ImageData(new Uint8ClampedArray(rasterData.buffer as ArrayBuffer, rasterData.byteOffset, rasterData.byteLength), destWidth, destHeight);
        } else {
          // Convert to RGBA 8-bit
          imgData = new ImageData(destWidth, destHeight);
          for (let i = 0, j = 0; i < destWidth * destHeight; i++) {
            if (samplesPerPixel === 1) {
              const val = rasterData[i];
              const normalized = rasterData instanceof Uint16Array ? (val >> 8) : val;
              imgData.data[j++] = normalized;
              imgData.data[j++] = normalized;
              imgData.data[j++] = normalized;
              imgData.data[j++] = 255;
            } else if (samplesPerPixel >= 3) {
              const r = rasterData[i * samplesPerPixel];
              const g = rasterData[i * samplesPerPixel + 1];
              const b = rasterData[i * samplesPerPixel + 2];
              const a = samplesPerPixel >= 4 ? rasterData[i * samplesPerPixel + 3] : 255;
              
              if (rasterData instanceof Uint16Array) {
                imgData.data[j++] = r >> 8;
                imgData.data[j++] = g >> 8;
                imgData.data[j++] = b >> 8;
                imgData.data[j++] = a === 255 ? 255 : (a >> 8);
              } else {
                imgData.data[j++] = r;
                imgData.data[j++] = g;
                imgData.data[j++] = b;
                imgData.data[j++] = a;
              }
            }
          }
        }
        
        const tNormalize = performance.now();
        
        const bitmap = await createImageBitmap(imgData);
        
        const tBitmap = performance.now();
        self.postMessage({ type: 'TRACE', payload: `Tile [y:${bounds.y}] Ready (Decode: ${Math.round(tExtract - tDecodeStart)}ms, Convert: ${Math.round(tNormalize - tExtract)}ms, Bitmap: ${Math.round(tBitmap - tNormalize)}ms)` });
        
        (postMessage as any)(
          { 
            type: 'TILE_RESULT', 
            id, 
            payload: { 
              bitmap, 
              waitTime: 0,
              extractTime: tNormalize - tWait1,
              bitmapTime: tBitmap - tNormalize
            } 
          },
          [bitmap]
        );
      } else if (type === 'THUMBNAIL') {
        const { maxDimension } = payload;
        if (!image || !metadata) throw new Error("Not loaded");
        
        // Smart scaling for well logs: ensure adequate width while avoiding excessive height (max 16384)
        let scale = 1.0;
        const targetWidth = Math.min(metadata.width, 600);
        scale = targetWidth / metadata.width;
        
        let proposedHeight = Math.round(metadata.height * scale);
        if (proposedHeight > 16384) {
          scale = 16384 / metadata.height;
        }
        
        let destWidth = Math.round(metadata.width * scale);
        let destHeight = Math.round(metadata.height * scale);
        
        // Ensure destWidth and destHeight are valid
        destWidth = Math.max(1, destWidth);
        destHeight = Math.max(1, destHeight);

        const rasters = await image.readRasters({ 
          width: destWidth,
          height: destHeight,
          interleave: true
        });
        
        const rasterData = rasters as import('geotiff').TypedArray;
        const samplesPerPixel = image.getSamplesPerPixel();
        
        let imgData: ImageData;
        
        if (samplesPerPixel === 4 && rasterData instanceof Uint8Array) {
          imgData = new ImageData(new Uint8ClampedArray(rasterData.buffer as ArrayBuffer, rasterData.byteOffset, rasterData.byteLength), destWidth, destHeight);
        } else {
          imgData = new ImageData(destWidth, destHeight);
          for (let i = 0, j = 0; i < destWidth * destHeight; i++) {
            if (samplesPerPixel === 1) {
              const val = rasterData[i];
              const normalized = rasterData instanceof Uint16Array ? (val >> 8) : val;
              imgData.data[j++] = normalized;
              imgData.data[j++] = normalized;
              imgData.data[j++] = normalized;
              imgData.data[j++] = 255;
            } else if (samplesPerPixel >= 3) {
              const r = rasterData[i * samplesPerPixel];
              const g = rasterData[i * samplesPerPixel + 1];
              const b = rasterData[i * samplesPerPixel + 2];
              const a = samplesPerPixel >= 4 ? rasterData[i * samplesPerPixel + 3] : 255;
              
              if (rasterData instanceof Uint16Array) {
                imgData.data[j++] = r >> 8;
                imgData.data[j++] = g >> 8;
                imgData.data[j++] = b >> 8;
                imgData.data[j++] = a === 255 ? 255 : (a >> 8);
              } else {
                imgData.data[j++] = r;
                imgData.data[j++] = g;
                imgData.data[j++] = b;
                imgData.data[j++] = a;
              }
            }
          }
        }
        
        const bitmap = await createImageBitmap(imgData);
        
        (postMessage as any)(
          { type: 'TILE_RESULT', id, payload: { bitmap } },
          [bitmap]
        );
      }
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', id, error: err.message });
    }
  });
};
