# OCR Interface Contract Specification v1.0 (OCR-API-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (API Contract Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Interface Contract Specification v1.0 (OCR-API-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this contract formalizes the structural APIs, execution signatures, and lifecycles of the services composing the OCR subsystem.

These contracts ensure strict decoupling of the core pipeline logic from any concrete library adapters (such as Tesseract.js, cloud APIs, or layout analysis engines), establishing an airtight boundary that protects the platform from third-party library pollution.

---

## 2. Orchestration & Stage Interfaces

All interfaces use the schemas and data types defined in `OCR_TYPE_SPEC_v1.md`.

### 2.1 OCROrchestrator
The central facade coordinating the entire processing sequence. It is the single entry point through which the Workspace initiates OCR.

```typescript
import { OCRExecutionContext, PipelineExecutionResult } from "./OCR_TYPE_SPEC_v1";

export interface OCROrchestrator {
  /**
   * Executes the entire six-stage OCR processing pipeline sequentially.
   * Ensures thread isolation, measures timings, handles timeouts, and catches failures.
   * 
   * @param raster The raw browser-compatible image buffer of the logging run.
   * @param context Immutable execution options, cancellation triggers, and thresholds.
   * @returns Resolves to a deterministic PipelineExecutionResult.
   */
  executePipeline(
    raster: ImageData,
    context: OCRExecutionContext
  ): Promise<PipelineExecutionResult>;
}
```

### 2.2 HeaderLocalizationService (Stage 1)
Identifies and segments the well header region of interest from the raw vertical log image.

```typescript
import { OCRExecutionContext, HeaderLocalizationResult } from "./OCR_TYPE_SPEC_v1";

export interface HeaderLocalizationService {
  /**
   * Scans the intensity density of the raster image to locate the header division line.
   * 
   * @param raster Raw log raster image.
   * @param context Execution context containing parameters.
   */
  localizeHeaderRegion(
    raster: ImageData,
    context: OCRExecutionContext
  ): Promise<HeaderLocalizationResult>;
}
```

### 2.3 TextDetectionService (Stage 2)
Detects structural textual regions (rows/paragraphs) inside the cropped header block.

```typescript
import { OCRExecutionContext, HeaderROI, TextDetectionResult } from "./OCR_TYPE_SPEC_v1";

export interface TextDetectionService {
  /**
   * Groups pixels into text-containing rows using anisotropic morphological grouping filters.
   * 
   * @param raster Raw log raster image.
   * @param roi Coordinates of the localized Header ROI box.
   * @param context Execution context containing parameters.
   */
  detectTextRegions(
    raster: ImageData,
    roi: HeaderROI,
    context: OCRExecutionContext
  ): Promise<TextDetectionResult>;
}
```

### 2.4 RecognitionService (Stage 3)
Transcribes visual glyphs from detected layout regions into digital text tokens. This represents the abstract boundary of the third-party OCR library adapter.

```typescript
import { OCRExecutionContext, DetectedText, RecognitionResult } from "./OCR_TYPE_SPEC_v1";

export interface RecognitionService {
  /**
   * Spawns worker resources, schedules parallel glyph transcriptions, and returns parsed tokens.
   * 
   * @param raster Raw log raster image.
   * @param regions Sorted array of DetectedText bounding regions.
   * @param context Execution context containing parameters.
   */
  recognizeTokens(
    raster: ImageData,
    regions: DetectedText[],
    context: OCRExecutionContext
  ): Promise<RecognitionResult>;
}
```

### 2.5 ScientificParser (Stage 4)
Applies scientific rules, regular expression matching, and fuzzy key distance filters to structured tokens.

```typescript
import { OCRExecutionContext, RecognizedToken, ParsedHeader } from "./OCR_TYPE_SPEC_v1";

export interface ScientificParser {
  /**
   * Processes unformatted string tokens and matches them to domains such as UWI, names, or depths.
   * This is a synchronous, pure mathematical transformation stage with zero side-effects.
   * 
   * @param tokens Discovered text tokens.
   * @param context Execution context containing parameters.
   */
  parseMetadata(
    tokens: RecognizedToken[],
    context: OCRExecutionContext
  ): ParsedHeader;
}
```

### 2.6 ValidationService (Stage 5 & 6)
Validates the physical, structural, and confidence rules of the parsed metadata before ingest.

```typescript
import { OCRExecutionContext, ParsedHeader, ValidationResult } from "./OCR_TYPE_SPEC_v1";

export interface ValidationService {
  /**
   * Computes the composite confidence metric and evaluates Tier 1, 2, and 3 scientific boundaries.
   * This is a synchronous, pure function.
   * 
   * @param header Structured candidate well metadata.
   * @param context Execution context containing parameters.
   */
  validateParsedHeader(
    header: ParsedHeader,
    context: OCRExecutionContext
  ): ValidationResult;
}
```

---

## 3. Recognition Adapter Lifecycle Contract

Since external recognition runtimes (e.g., Tesseract.js Web Workers or WebAssembly sandboxes) require physical hardware initialization, threading pools, and memory deallocation, the `RecognitionService` must adhere to a strict, deterministic lifecycle state machine:

```text
  [Uninitialized]
         │
         │  1. initialize() (Pre-allocates workers & loads language files)
         ▼
     [Ready] ◄──────┐
         │          │
         │  2. recognize() (Launches background threads)
         ▼          │
   [Processing] ────┤ (Completes successfully or fails)
         │
         │  3. dispose() (Kills threads, clears buffers, returns memory)
         ▼
    [Disposed]
```

### 3.2 Formal Lifecycle API Definition

```typescript
export interface ManagedRecognitionService extends RecognitionService {
  /**
   * Pre-loads necessary WebAssembly runtimes, dictionary datasets, and spawns the worker pool.
   * Must be called once before initiating any recognizeTokens operations.
   */
  initialize(context: OCRExecutionContext): Promise<void>;

  /**
   * Explicitly signals the service to abort active recognition threads, garbage collect
   * memory allocations, and terminate concurrent worker threads.
   */
  dispose(): Promise<void>;
}
```

### 3.3 Exception & Error Outcomes

To prevent runtime crashes from bubbling up to the browser main thread, the adapter implementation must never throw raw uncaught JavaScript exceptions. Instead, internal adapter faults must be captured, converted to structured domain strings, and mapped to the deterministic results:

* **`RecognitionException`**: Encompasses physical errors (e.g., worker initialization crashes, out-of-memory states, file fetch failures for language packs).
* **Abort Handlers**: If the `OCRExecutionContext.abortSignal` is triggered, the recognition adapter must immediately abort Web Worker processing and return a `FAILURE_RECOGNITION_TIMEOUT` or a clean cancelled status, rather than running to completion.

---

## 4. Verification Matrix

| Test Case ID | Interface | Method | Trigger Scenario | Expected Result |
| :--- | :--- | :--- | :--- | :--- |
| **TC-API-201** | `ManagedRecognitionService` | `initialize` | Low memory/no thread budget available | Throws controlled initialization exception without locking main UI thread. |
| **TC-API-202** | `RecognitionService` | `recognizeTokens` | Invoked before `initialize` is resolved | Rejects promise with immediate `FAILURE_RECOGNITION_FAILED`. |
| **TC-API-203** | `ManagedRecognitionService` | `dispose` | Invoked while recognition threads are actively running | Halts processing threads immediately, clears memory, and resolves smoothly. |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
