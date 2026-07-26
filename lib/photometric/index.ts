/**
 * CitraNeura OCR-IMP-16: Photometric Normalization Layer
 * Centralized, deterministic, and cached grayscale/photometric service.
 */

export type PolarityType = 'NORMAL' | 'INVERTED' | 'UNCERTAIN';

/**
 * PolarityAnalysisResult: Output of the PhotometricPolarityAnalyzer.
 */
export interface PolarityAnalysisResult {
  readonly polarity: PolarityType;
  readonly classificationConfidence: number;
  readonly metrics: {
    readonly mean: number;
    readonly median: number;
    readonly lightPixelFraction: number;
    readonly peakIntensity: number;
    readonly stdDev: number;
    readonly contrast: number;
  };
}

/**
 * PhotometricProvenance: Records transformation history and analysis decisions.
 */
export interface PhotometricProvenance {
  readonly wasInverted: boolean;
  readonly algorithmVersion: string;
  readonly timestamp: number;
  readonly analysisResult: PolarityAnalysisResult;
  readonly parameters: {
    readonly autoInvertThreshold: number;
  };
}

/**
 * PhotometricFrame: Immutable representation of derived grayscale data and stats.
 */
export interface PhotometricFrame {
  readonly width: number;
  readonly height: number;
  /**
   * Derived grayscale pixel buffer containing values in [0.0, 1.0]
   */
  readonly grayscale: Float64Array;
  /**
   * 256-bin histogram of pixel counts
   */
  readonly histogram: Uint32Array;
  /** Minimum pixel intensity in [0.0, 1.0] */
  readonly min: number;
  /** Maximum pixel intensity in [0.0, 1.0] */
  readonly max: number;
  /** Mean pixel intensity in [0.0, 1.0] */
  readonly mean: number;
  /** Median pixel intensity in [0.0, 1.0] */
  readonly median: number;
  /** Legacy access to polarity analysis, now properly part of provenance */
  readonly polarity: PolarityAnalysisResult;
  /** Complete provenance of the photometric transformations */
  readonly provenance: PhotometricProvenance;
}

/**
 * PhotometricPolarityAnalyzer: Deterministic analyzer for raster orientation.
 * Performs statistical histogram analysis without modifying the image.
 */
export class PhotometricPolarityAnalyzer {
  public static analyze(frame: Omit<PhotometricFrame, 'polarity' | 'provenance'>): PolarityAnalysisResult {
    const total = frame.grayscale.length;
    if (total === 0) {
      return {
        polarity: 'UNCERTAIN',
        classificationConfidence: 0.0,
        metrics: {
          mean: 0,
          median: 0,
          lightPixelFraction: 0,
          peakIntensity: 0,
          stdDev: 0,
          contrast: 0
        }
      };
    }

    // 1. Calculate supporting metrics
    let lightCount = 0;
    let varianceSum = 0;
    const mean = frame.mean;

    for (let i = 0; i < total; i++) {
      const y = frame.grayscale[i];
      if (y > 0.5) {
        lightCount++;
      }
      const diff = y - mean;
      varianceSum += diff * diff;
    }

    const lightPixelFraction = lightCount / total;
    const stdDev = Math.sqrt(varianceSum / total);
    const contrast = frame.max - frame.min;

    // Peak intensity calculation from histogram
    let peakBin = 0;
    let maxCount = 0;
    for (let i = 0; i < 256; i++) {
      if (frame.histogram[i] > maxCount) {
        maxCount = frame.histogram[i];
        peakBin = i;
      }
    }
    const peakIntensity = peakBin / 255.0;

    // 2. Decision Logic
    // Extreme low contrast or extremely flat variance -> Uncertain
    const isLowContrast = stdDev < 0.06 || contrast < 0.15;

    let polarity: PolarityType = 'UNCERTAIN';
    let confidence = 0.5;

    if (isLowContrast) {
      polarity = 'UNCERTAIN';
      // Confidence is inversely proportional to how close we are to standard contrast thresholds
      confidence = Math.max(0.0, 1.0 - (stdDev / 0.06));
    } else {
      // Evaluate indicators
      // In normal polarity, background is light: mean, median, peakIntensity and lightPixelFraction are all > 0.5.
      const normalScore =
        (mean > 0.52 ? 1 : 0) +
        (frame.median > 0.52 ? 1 : 0) +
        (peakIntensity > 0.52 ? 1 : 0) +
        (lightPixelFraction > 0.52 ? 1 : 0);

      const invertedScore =
        (mean < 0.48 ? 1 : 0) +
        (frame.median < 0.48 ? 1 : 0) +
        (peakIntensity < 0.48 ? 1 : 0) +
        (lightPixelFraction < 0.48 ? 1 : 0);

      const indicatorAvg = (mean + frame.median + peakIntensity + lightPixelFraction) / 4;

      if (normalScore >= 3) {
        polarity = 'NORMAL';
        // Confidences scale from 0.0 (near 0.5 center) to 1.0 (completely white background)
        confidence = Math.min(1.0, Math.max(0.0, (indicatorAvg - 0.5) * 2.0));
      } else if (invertedScore >= 3) {
        polarity = 'INVERTED';
        // Confidences scale from 0.0 (near 0.5 center) to 1.0 (completely black background)
        confidence = Math.min(1.0, Math.max(0.0, (0.5 - indicatorAvg) * 2.0));
      } else {
        polarity = 'UNCERTAIN';
        confidence = 1.0 - Math.min(1.0, Math.abs(indicatorAvg - 0.5) * 4.0);
      }
    }

    // Ensure strict bounds
    confidence = Math.min(1.0, Math.max(0.0, confidence));

    return {
      polarity,
      classificationConfidence: confidence,
      metrics: {
        mean,
        median: frame.median,
        lightPixelFraction,
        peakIntensity,
        stdDev,
        contrast
      }
    };
  }
}

/**
 * Structure representing the tracking statistics for the Photometric Service.
 */
export interface PhotometricServiceStats {
  cacheHits: number;
  cacheMisses: number;
  totalProcessingTimeMs: number;
}

/**
 * PhotometricNormalizationService: Handles central grayscale conversion with caching and metrics.
 */
export class PhotometricNormalizationService {
  private static instance: PhotometricNormalizationService | null = null;
  private readonly cache = new WeakMap<ImageData, PhotometricFrame>();
  
  private stats: PhotometricServiceStats = {
    cacheHits: 0,
    cacheMisses: 0,
    totalProcessingTimeMs: 0
  };

  private constructor() {}

  /**
   * Retrieves the singleton instance of PhotometricNormalizationService.
   */
  public static getInstance(): PhotometricNormalizationService {
    if (!PhotometricNormalizationService.instance) {
      PhotometricNormalizationService.instance = new PhotometricNormalizationService();
    }
    return PhotometricNormalizationService.instance;
  }

  /**
   * Returns current service runtime statistics.
   */
  public getStats(): PhotometricServiceStats {
    return { ...this.stats };
  }

  /**
   * Resets the cached stats tracking.
   */
  public resetStats(): void {
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      totalProcessingTimeMs: 0
    };
  }

  /**
   * Centralized grayscale conversion of ImageData into a PhotometricFrame.
   * If the frame has already been computed for this raster reference, returns the cached frame.
   * Uses the deterministic ITU-R BT.601 Luma formula: Y = 0.299R + 0.587G + 0.114B
   */
  public getFrame(raster: ImageData, autoInvertThreshold: number = 0.5): PhotometricFrame {
    if (!raster || !raster.width || !raster.height || !raster.data) {
      throw new Error("Invalid or empty ImageData provided to PhotometricNormalizationService");
    }

    const cached = this.cache.get(raster);
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const startTime = Date.now();
    this.stats.cacheMisses++;

    const width = raster.width;
    const height = raster.height;
    const data = raster.data;
    const size = width * height;

    const grayscale = new Float64Array(size);
    const histogram = new Uint32Array(256);

    let min = 1.0;
    let max = 0.0;
    let sum = 0.0;

    for (let i = 0; i < size; i++) {
      const idx = i * 4;
      const r = data[idx] / 255.0;
      const g = data[idx + 1] / 255.0;
      const b = data[idx + 2] / 255.0;

      // Standard ITU-R BT.601 grayscale conversion formula
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      grayscale[i] = y;

      const bin = Math.min(255, Math.max(0, Math.round(y * 255)));
      histogram[bin]++;

      if (y < min) min = y;
      if (y > max) max = y;
      sum += y;
    }

    const mean = sum / size;

    // Deterministic median using cumulative histogram
    let cumulative = 0;
    const halfSize = size / 2;
    let medianBin = 127;
    for (let i = 0; i < 256; i++) {
      cumulative += histogram[i];
      if (cumulative >= halfSize) {
        medianBin = i;
        break;
      }
    }
    const median = medianBin / 255.0;

    const partialFrame = {
      width,
      height,
      grayscale,
      histogram,
      min,
      max,
      mean,
      median
    };

    const polarity = PhotometricPolarityAnalyzer.analyze(partialFrame);

    let finalGrayscale = partialFrame.grayscale;
    let finalHistogram = partialFrame.histogram;
    let finalMin = partialFrame.min;
    let finalMax = partialFrame.max;
    let finalMean = partialFrame.mean;
    let finalMedian = partialFrame.median;
    let wasInverted = false;

    const total = partialFrame.grayscale.length;
    if (polarity.polarity === 'INVERTED' && polarity.classificationConfidence >= autoInvertThreshold) {
      wasInverted = true;
      finalGrayscale = new Float64Array(total);
      for (let i = 0; i < total; i++) {
        finalGrayscale[i] = 1.0 - partialFrame.grayscale[i];
      }
      
      finalMin = 1.0 - partialFrame.max;
      finalMax = 1.0 - partialFrame.min;
      finalMean = 1.0 - partialFrame.mean;
      finalMedian = 1.0 - partialFrame.median;
      
      finalHistogram = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        finalHistogram[i] = partialFrame.histogram[255 - i];
      }
    }

    const provenance: PhotometricProvenance = {
      wasInverted,
      algorithmVersion: '1.2.0',
      timestamp: Date.now(),
      analysisResult: polarity,
      parameters: {
        autoInvertThreshold
      }
    };

    const frame: PhotometricFrame = {
      width,
      height,
      grayscale: finalGrayscale,
      histogram: finalHistogram,
      min: finalMin,
      max: finalMax,
      mean: finalMean,
      median: finalMedian,
      polarity,
      provenance
    };

    this.cache.set(raster, frame);
    this.stats.totalProcessingTimeMs += (Date.now() - startTime);

    return frame;
  }

  /**
   * Retrieves a sub-region's grayscale representation, utilizing the full-raster cache.
   * Prevents wasteful re-calculations of overlapping regions.
   */
  public getSubRegionGrayscale(
    raster: ImageData,
    xStart: number,
    yStart: number,
    w: number,
    h: number
  ): Float64Array {
    const frame = this.getFrame(raster);
    const subGrayscale = new Float64Array(w * h);

    for (let y = 0; y < h; y++) {
      const srcY = yStart + y;
      const srcOffset = srcY * frame.width + xStart;
      const destOffset = y * w;
      subGrayscale.set(frame.grayscale.subarray(srcOffset, srcOffset + w), destOffset);
    }

    return subGrayscale;
  }
}
