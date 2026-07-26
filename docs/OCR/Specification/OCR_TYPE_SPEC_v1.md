# OCR Type System Specification v1.0 (OCR-TYPE-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Type Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Type System Specification v1.0 (OCR-TYPE-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the formal, immutable TypeScript structures and constraints for all data models exchanged across the OCR processing stages.

By establishing a rigid, frozen type system, we eliminate architectural discrepancies (such as conflicting naming conventions for confidence metrics like "score" vs "probability") and ensure absolute API compatibility between individual stages, background workers, and the active Workspace.

---

## 2. Core Model Schemas

### 2.1 HeaderROI (Region of Interest)
Represents the geometrically bounded Well Header region located at the topmost section of a vertical log.

```typescript
export interface HeaderROI {
  /** The horizontal starting coordinate of the ROI box in pixels */
  pixelX: number;
  /** The vertical starting coordinate of the ROI box in pixels */
  pixelY: number;
  /** The total width of the ROI box in pixels */
  width: number;
  /** The total height of the ROI box in pixels */
  height: number;
  /** The skew or rotation angle in degrees, where positive represents clockwise skew */
  rotation: number;
  /** The estimated or targeted scanning density in Dots Per Inch (DPI) */
  dpi: number;
  /** Descriptive identifier of the coordinate calibration space (e.g. "pixels") */
  coordinateSystem: "pixel" | "normalized";
  /** The mathematical localization confidence rating, strictly bounded in [0.0, 1.0] */
  confidence: number;
}
```

### 2.2 DetectedText
Defines a discrete layout segment (e.g., text row, column, or paragraph block) located within the parent `HeaderROI` coordinate frame.

```typescript
export interface DetectedText {
  /** Globally unique row identifier */
  id: string;
  /** Spatial bounding box boundaries relative to the localized parent ROI */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Ordered row index from top to bottom (ascending) */
  lineIndex: number;
}
```

### 2.3 RecognizedToken
Represents a singular transcribed word or coherent string unit output by the Recognition Adapter.

```typescript
export interface RecognizedToken {
  /** Unique token identifier */
  id: string;
  /** Bounding coordinates relative to the localized parent ROI coordinate frame */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Raw transcribed character sequence (UTF-8) */
  rawText: string;
  /** ISO-639 alpha-3 language identifier representing the glyph context (e.g. "eng", "ind") */
  language: string;
  /** Estimated glyph baseline font size or height in pixels */
  fontHeight: number;
  /** Physical alignment axis of the glyph segment */
  orientation: 'horizontal' | 'vertical' | 'mixed';
  /** Association key to the parent DetectedText layout row */
  lineId: string;
  /** Pure optical character recognition certainty rating, strictly bounded in [0.0, 1.0] */
  confidence: number;
}
```

### 2.4 ParsedHeader
The domain-specific structured metadata containing extracted scientific parameters.

```typescript
export interface ParsedHeader {
  /** Transcribed well identifier name */
  wellName: string | null;
  /** Geographic or exploration field location name */
  field: string | null;
  /** Operating company responsible for well logging */
  operator: string | null;
  /** Unique Well Identifier (UWI) or API identifier */
  uwi: string | null;
  /** Log execution date formatted in standard ISO 8601 (YYYY-MM-DD) */
  date: string | null;
  /** Numeric start/top depth coordinate */
  startDepth: number | null;
  /** Numeric end/bottom depth coordinate */
  endDepth: number | null;
  /** Scientific unit of physical depth */
  depthUnit: 'm' | 'ft' | null;
  /** Dimensional scaling ratio parsed from the log header (e.g. "1:200") */
  scaleRatio: string | null;
  /** Segmented optical and parser confidence metrics for critical scientific fields */
  confidenceScores: {
    wellName: number;
    field: number;
    operator: number;
    depths: number;
  };
}
```

### 2.5 ConfidenceRecord
Provides the final pipeline confidence metadata and threshold criteria.

```typescript
export interface ConfidenceRecord {
  /** Boolean indicating if the final composite score meets OP_CON_COMP_THRES */
  minimumConfidenceMet: boolean;
  /** Weighted composite confidence score synthesized from critical fields, in [0.0, 1.0] */
  compositeConfidence: number;
  /** The static OP_CON_COMP_THRES value used to evaluate pipeline validity */
  thresholdUsed: number;
}
```

### 2.6 ValidationResult
The output of the Domain Validation Stage, capturing the structural, semantic, and physical log constraints.

```typescript
export interface ValidationResult {
  /** True only if all validations pass and composite confidence meets threshold */
  isValid: boolean;
  /** Immutable read-only reference to the ParsedHeader evaluated */
  readonly header: ParsedHeader;
  /** Descriptive errors from format, syntax, or completeness validations */
  structuralErrors: string[];
  /** Errors related to regional dictionary or lookup mismatches */
  semanticErrors: string[];
  /** Errors indicating physical log anomalies (e.g., startDepth >= endDepth) */
  scientificErrors: string[];
  /** Warnings raised during processing that do not warrant pipeline rejection */
  warnings: string[];
  /** Propagated and synthesized confidence metrics */
  confidenceRecord: ConfidenceRecord;
}
```

---

## 3. Context & Environmental Schemas

### 3.1 OCRExecutionContext
Captures all environmental options, parameters, and cancellation controls.

```typescript
export interface OCRExecutionContext {
  /** The expected hardware scanning resolution in DPI */
  expectedDPI?: number;
  /** Ordered array of language codes to load into the recognition workspace */
  targetLanguages?: string[];
  /** The minimum composite confidence score required to accept results */
  confidenceThreshold: number;
  /** Maximum execution duration allowed before pipeline abort in milliseconds */
  timeoutMs?: number;
  /** Native abort handle to allow immediate user-triggered pipeline cancellation */
  abortSignal?: AbortSignal;
}
```

---

## 4. Frozen Execution Union States

The overall outcome of the orchestrator execution is modeled as a closed, discriminated union, preventing partial or corrupt execution states from polluting downstream consumers.

```typescript
export type PipelineExecutionResult =
  | {
      status: 'SUCCESS';
      header: ParsedHeader;
      validation: ValidationResult;
      elapsedMs: number;
    }
  | {
      status: 'FAILURE_HEADER_NOT_FOUND';
      error: string;
      elapsedMs: number;
    }
  | {
      status: 'FAILURE_TEXT_REGION_EMPTY';
      roi: HeaderROI;
      error: string;
      elapsedMs: number;
    }
  | {
      status: 'FAILURE_RECOGNITION_TIMEOUT';
      error: string;
      elapsedMs: number;
    }
  | {
      status: 'FAILURE_RECOGNITION_FAILED';
      error: string;
      elapsedMs: number;
    }
  | {
      status: 'FAILURE_PARSING_UNSTRUCTURED';
      tokens: RecognizedToken[];
      error: string;
      elapsedMs: number;
    }
  | {
      status: 'FAILURE_VALIDATION_REJECTED';
      header: ParsedHeader;
      validation: ValidationResult;
      error: string;
      elapsedMs: number;
    };

// Stage-specific return unions
export type HeaderLocalizationResult = 
  | { status: 'success'; roi: HeaderROI }
  | { status: 'failure'; error: string };

export type TextDetectionResult = 
  | { status: 'success'; regions: DetectedText[] }
  | { status: 'failure'; error: string };

export type RecognitionResult = 
  | { status: 'success'; tokens: RecognizedToken[] }
  | { status: 'failure'; error: string };
```

---

## 5. Verification Matrix

| Schema ID | Field Name | Validation Pattern | Expected Range / Type |
| :--- | :--- | :--- | :--- |
| **V-TYPE-101** | `HeaderROI.confidence` | Algebraic boundary check | `0.0 <= confidence <= 1.0` |
| **V-TYPE-102** | `RecognizedToken.confidence` | Algebraic boundary check | `0.0 <= confidence <= 1.0` |
| **V-TYPE-103** | `ParsedHeader.date` | ISO-8601 Format RegExp | `^\d{4}-\d{2}-\d{2}$` or `null` |
| **V-TYPE-104** | `ParsedHeader.depthUnit` | String enum check | `'m' \| 'ft' \| null` |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
