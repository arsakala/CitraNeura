# OCR Architecture Design Document v1.0 (OCR-ADD-01R)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Architecture Design Only - Approved R2)**  
**Date:** 2026-07-01  

---

## 1. Purpose

The Optical Character Recognition (OCR) subsystem in CitraNeura exists to automate the extraction of high-value metadata from scanned paper well logs and transfer it directly into the system's scientific domain model. Well logs printed on paper represent decades of legacy scientific history; manually transcribing their headers, calibration targets, and operational details is prone to human typing errors and degrades operational efficiency.

The OCR Subsystem serves as an automated ingest channel that localizes and parses textual information from raster images. By extracting metadata—such as well name, field location, operational company, scales, and depth boundaries—with mathematical confidence ratings, the subsystem accelerates project setup, ensures scientific compliance, and provides validated, machine-readable headers ready for depth-scale and track calibrations.

---

## 2. Responsibilities

To maintain strict modularity and prevent architectural bloat, the responsibilities of the OCR subsystem are explicitly bounded:

### OCR is Responsible For:
* **Header Localization**: Identifying and clipping the precise coordinates of the Well Header region (Region of Interest / ROI) within the larger raster well log image.
* **Text Detection**: Detecting text blocks, layout paragraphs, lines, and word boundaries within the localized Header ROI.
* **Text Recognition**: Transcribing character sequences from detected text regions into string arrays using optical glyph analysis.
* **Scientific Parsing**: Transforming unstructured text segments into structured well metadata elements (such as operator name, well name, field, depth boundaries, scale values, and units) using logical rules and heuristics.
* **Confidence Propagation**: Assigning, calculating, and propagating numerical confidence scores ($[0.0, 1.0]$) from raw text recognition through to scientific field parsing.

### OCR is NOT Responsible For:
* **Curve Digitization**: Detecting, tracing, or extracting curves, vector points, or line signals from the raster tracks.
* **Workspace Management**: Manipulating active workspace state, tabs, active curve selections, or UI overlays.
* **Rendering**: Generating canvas displays, SVG paths, or viewport components.
* **Persistence**: Writing files, saving recovery snapshots to database storage (`localforage`/Firestore), or managing active session state.
* **Undo/Redo**: Committing commands directly to the Workspace Undo/Redo historical stacks.

---

## 3. System Boundary

The OCR subsystem operates strictly as a self-contained, stateless computational pipeline. It interacts with the broader application strictly through a single orchestrating entry point and possesses zero direct access to React hooks, state management contexts, or browser UI loops.

```text
       ┌────────────────────────────────────────────────────────┐
       │                 SYSTEM BOUNDARY (OCR)                  │
       │                                                        │
INPUT  │  [Raster Data Source] ──► [OCR Facade / Orchestrator]  │ OUTPUT
───────┼─────────────────────────────────┼──────────────────────┼────────►
       │                                 │                      │ (PipelineExecutionResult)
       │                                 ▼                      │
       │                         [Internal State]               │
       │                         - (None: Purely Stateless)     │
       └────────────────────────────────────────────────────────┘
```

### Inputs
* **`raster`**: The raw image data source (as an `ImageData` buffer or raw pixel array).
* **`context`**: An execution environment grouping parameters (expected DPI, target languages, confidence thresholds, timeouts, and manual cancellation mechanisms).

### Outputs
* **`PipelineExecutionResult`**: A strongly typed, frozen outcome union representing the precise success or failure state of the pipeline run.

### Internal State
* **None**: The OCR pipeline is strictly stateless. Each processing run is an independent, deterministic execution path.

### External Dependencies
* **`RasterService`**: A service supplying clean, processed image data, contrast adjustments, and downsampled coordinate frames.

### Forbidden Dependencies
* **React State / Hooks (`useState`, `useEffect`, `useContext`)**: The OCR pipeline is prohibited from importing or triggering React lifecycle operations.
* **Workspace Engine / Reducer**: The OCR pipeline must have no knowledge of the Workspace's active state or dispatch systems.
* **Database / LocalForage**: Direct I/O operations are strictly forbidden.

---

## 4. Dependency Diagram

To ensure strict unidirectional data flow and prevent cyclical imports, the Workspace only interacts with the OCR subsystem through the **OCR Facade / Orchestrator**. Individual specialized sub-services remain isolated and invisible to the outside workspace.

```text
       ┌─────────────────────────┐
       │        Workspace        │
       └────────────┬────────────┘
                    │ (Invokes with OCRExecutionContext)
                    ▼
       ┌─────────────────────────┐
       │ OCR Facade/Orchestrator │ (Facade Entry Point)
       └────────────┬────────────┘
                    │ (Provides image to Pipeline services)
                    ├───────────────────────┬───────────────────────┐
                    ▼                       ▼                       ▼
       ┌────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
       │ HeaderLocalizationSvc  │  │ TextDetectionSvc │  │  RecognitionSvc  │
       └────────────────────────┘  └──────────────────┘  └──────────────────┘
                    │                       │                       │
                    └───────────────────────┼───────────────────────┘
                                            ▼
                               ┌──────────────────┐
                               │ ScientificParser │
                               └────────┬─────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │  ValidationSvc   │
                               └────────┬─────────┘
                                        │ (Yields PipelineExecutionResult)
                                        ▼
                               ┌──────────────────┐
                               │  Parsed Header   │ (Owned by Scientific
                               └────────┬─────────┘  Domain Model)
                                        │
                                        ▼
                               ┌──────────────────┐
                               │Workspace Command │
                               └──────────────────┘
```

> **CRITICAL ARCHITECTURAL PROHIBITION**: Reverse dependencies are strictly prohibited. The OCR Pipeline components, Parsed Header model, and Raster Service must never import or possess references to the active Workspace or Workspace Command system.

---

## 5. Pipeline Definition

Every OCR execution orchestrated by the facade must flow through the following sequence of operations exactly. No additional processing stages or skipping of stages is allowed:

```text
  [Raster Image]
         │
         ▼
 1. [Header ROI Extraction]  ──► (Failure: HEADER_NOT_FOUND)
         │
         ▼
 2. [Text Region Detection]  ──► (Failure: TEXT_REGION_EMPTY)
         │
         ▼
 3. [Text Recognition]       ──► (Failure: RECOGNITION_TIMEOUT / RECOGNITION_FAILED)
         │
         ▼
 4. [Scientific Parsing]     ──► (Failure: PARSING_UNSTRUCTURED)
         │
         ▼
 5. [Domain Validation]      ──► (Failure: VALIDATION_REJECTED)
         │
         ▼
 [Success state produced]    ──► [Workspace Import (via Command Framework)]
```

### Pipeline Stages:
1. **Header ROI Extraction**: Localizes the header block coordinates within the raster image. If localization fails, the pipeline aborts.
2. **Text Region Detection**: Identifies specific rows, columns, and bounded blocks containing text. If no regions are found, the pipeline aborts.
3. **Text Recognition**: Transcribes characters inside the detected regions. If timeout occurs, user aborts, or engine crashes, the pipeline aborts.
4. **Scientific Parsing**: Maps recognized raw character strings into domain-specific scientific keys (e.g., Well Name, Depth Start). If no coherent metadata can be parsed, the pipeline aborts.
5. **Domain Validation**: Checks structural, semantic, and scientific limits (e.g., Depth Start < Depth End, valid units, minimum confidence score met). If validation criteria are violated, the pipeline aborts.
6. **Workspace Import**: On a successful run, the validated, domain-stamped metadata is wrapped in a Command and executed within the Workspace.

---

## 6. Interface Contracts

The OCR subsystem interface contracts are defined using strict TypeScript interfaces below. All interfaces utilize the unified `OCRExecutionContext` for parameter encapsulation.

```typescript
export interface OCRExecutionContext {
  /** Target scanning DPI for ratio calibration */
  expectedDPI?: number;
  /** OCR character language hint packs (e.g. ['eng', 'ind']) */
  targetLanguages?: string[];
  /** Minimum acceptable confidence rating threshold [0.0 - 1.0] */
  confidenceThreshold: number;
  /** Maximum duration allowed before mandatory pipeline truncation */
  timeoutMs?: number;
  /** Token to listen for manual user cancellation */
  abortSignal?: AbortSignal;
}

export interface OCROrchestrator {
  /**
   * Single entry point to coordinate the entire OCR pipeline execution.
   * Workspace components interact exclusively with this method.
   */
  executePipeline(
    raster: ImageData,
    context: OCRExecutionContext
  ): Promise<PipelineExecutionResult>;
}

export interface HeaderLocalizationService {
  /**
   * Localizes the well header region of interest within a raster image.
   */
  localizeHeaderRegion(
    raster: ImageData,
    context: OCRExecutionContext
  ): Promise<HeaderLocalizationResult>;
}

export interface TextDetectionService {
  /**
   * Detects blocks of text within a localized region of interest.
   */
  detectTextRegions(
    raster: ImageData,
    roi: HeaderROI,
    context: OCRExecutionContext
  ): Promise<TextDetectionResult>;
}

export interface RecognitionService {
  /**
   * Transcribes characters from bounded text regions into digital tokens.
   */
  recognizeTokens(
    raster: ImageData,
    regions: DetectedText[],
    context: OCRExecutionContext
  ): Promise<RecognitionResult>;
}

export interface ScientificParser {
  /**
   * Maps recognized unformatted tokens into structured, domain-specific well log fields.
   */
  parseMetadata(
    tokens: RecognizedToken[],
    context: OCRExecutionContext
  ): ParsedHeader;
}

export interface ValidationService {
  /**
   * Validates structural, semantic, and scientific soundness of the parsed header.
   */
  validateParsedHeader(
    header: ParsedHeader,
    context: OCRExecutionContext
  ): ValidationResult;
}
```

---

## 7. Data Structures & Frozen Execution States

The following section defines all data schemas and freezes all pipeline execution results.

### Data Schemas

```typescript
export interface HeaderROI {
  pixelX: number;
  pixelY: number;
  width: number;
  height: number;
  rotation: number;               // Rotation angle in degrees (skew/alignment info)
  dpi: number;                    // Estimated or target scanning DPI
  coordinateSystem: string;       // Target calibration coordinate system descriptor
  confidence: number;             // Localization confidence score [0.0 - 1.0]
}

export interface DetectedText {
  id: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lineIndex: number;
}

export interface RecognizedToken {
  id: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  rawText: string;
  language: string;               // Detected token language (e.g. 'eng', 'ind')
  fontHeight: number;             // Estimated font size/height in pixels
  orientation: 'horizontal' | 'vertical' | 'mixed'; // Token orientation
  lineId: string;                 // Association to the identified text row
  confidence: number;             // OCR character recognition confidence [0.0 - 1.0]
}

export interface ParsedHeader {
  wellName: string | null;
  field: string | null;
  operator: string | null;
  uwi: string | null;
  date: string | null;
  startDepth: number | null;
  endDepth: number | null;
  depthUnit: 'm' | 'ft' | null;
  scaleRatio: string | null;
  confidenceScores: {
    wellName: number;
    field: number;
    operator: number;
    depths: number;
  };
}

export interface ValidationResult {
  isValid: boolean;
  header: ParsedHeader;           // Immutable reference to the evaluated header
  structuralErrors: string[];    // Structural format and completeness issues
  semanticErrors: string[];      // Name validation and dictionary mismatch issues
  scientificErrors: string[];    // Out-of-bounds metrics (e.g. DEPTH_END <= DEPTH_START)
  warnings: string[];
  confidenceRecord: ConfidenceRecord;
}

export interface ConfidenceRecord {
  minimumConfidenceMet: boolean;
  compositeConfidence: number;    // Composite calculated confidence score [0.0 - 1.0]
  thresholdUsed: number;
}
```

### Frozen Pipeline Result States

The overall outcome of the OCR execution pipeline is modeled as a closed, discriminated union. This explicitly freezes all combinations of pipeline success and failure modes:

```typescript
export type PipelineExecutionResult =
  | {
      /** State 1: Full pipeline execution succeeded */
      status: 'SUCCESS';
      header: ParsedHeader;
      validation: ValidationResult;
      elapsedMs: number;
    }
  | {
      /** State 2: Header ROI box extraction failed */
      status: 'FAILURE_HEADER_NOT_FOUND';
      error: string;
      elapsedMs: number;
    }
  | {
      /** State 3: Header detected, but contains zero text boxes */
      status: 'FAILURE_TEXT_REGION_EMPTY';
      roi: HeaderROI;
      error: string;
      elapsedMs: number;
    }
  | {
      /** State 4: Recognition aborted or timed out */
      status: 'FAILURE_RECOGNITION_TIMEOUT';
      error: string;
      elapsedMs: number;
    }
  | {
      /** State 5: Glyph recognition failed / engine crash */
      status: 'FAILURE_RECOGNITION_FAILED';
      error: string;
      elapsedMs: number;
    }
  | {
      /** State 6: Raw transcription succeeded, but parser yielded no recognizable fields */
      status: 'FAILURE_PARSING_UNSTRUCTURED';
      tokens: RecognizedToken[];
      error: string;
      elapsedMs: number;
    }
  | {
      /** State 7: Fields successfully extracted but failed validation rules */
      status: 'FAILURE_VALIDATION_REJECTED';
      header: ParsedHeader;
      validation: ValidationResult;
      error: string;
      elapsedMs: number;
    };

// Specialized intermediate stage results
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

## 8. OCR Facade & Orchestration Layer

To maintain absolute decoupling, the **Workspace component is forbidden from interacting with or managing individual specialized pipeline services**. All coordination is delegated to a single orchestrator executing under the Facade Pattern:

* **Single Entry Point**: The Workspace invokes the orchestrator using a single function: `executePipeline(raster, context)`.
* **State Encapsulation**: The facade coordinates the flow from raw image input down to the validated results. It monitors timeouts, handles manual cancellation tokens, aggregates performance timings, and catches runtime exceptions.
* **Deterministic Contract**: The orchestrator resolves to exactly one of the seven frozen `PipelineExecutionResult` states defined in Section 7. The Workspace inspects the discriminated `status` field and reacts accordingly (such as launching a standard workspace edit command, or triggering the appropriate failure overlay).

---

## 9. Confidence Propagation Rules

To prevent arbitrary metadata tagging and guarantee traceability, the OCR subsystem follows strict, non-destructive confidence propagation rules:

1. **Primacy of Propagation**: Confidence scores are **propagated, never silently recomputed or smoothed over** across pipeline transitions.
2. **Step-by-Step Propagation Flow**:
   * *ROI Confidence* ($C_{roi}$): Represents the physical layout certainty of the Header box.
   * *Recognition Confidence* ($C_{rec}$): Calculated as the mathematical average of character glyph recognition certainties within the target tokens.
   * *Field Confidence* ($C_{field}$): Built by combining recognition confidence with parser heuristics (such as matching dictionary keys or regular expressions):
     $$C_{field} = C_{rec} \times \text{HeuristicMatchScore}$$
   * *Composite Confidence* ($C_{composite}$): Aggregated as a weighted combination of all individual field scores:
     $$C_{composite} = w_{roi} C_{roi} + w_{rec} \bar{C}_{rec} + \sum w_{f} C_{field}$$
3. **Traceability**: All intermediate confidence values are packaged inside the final result structures to allow downstream auditing.

---

## 10. Multi-Tier Domain Validation

To ensure extreme scientific reliability, validation is divided into three isolated validation tiers:

1. **Structural Validation**: Checks the structural integrity, format, and layout completeness of the parsed fields (e.g. UWI code length checks, correct ISO date formatting, and presence of mandatory fields).
2. **Semantic Validation**: Evaluates character combinations and names against regional databases (e.g. matching Operator names or Field coordinates against official geographic dictionaries).
3. **Scientific Validation**: Enforces physical boundaries and well log constraints (e.g. ensuring `endDepth > startDepth`, checking that units are strictly `'m'` or `'ft'`, and confirming logical scale ratio boundaries).

---

## 11. Domain Model Ownership & Lifecycle Contract

To keep the codebase modular, a strict ownership boundary is established between the **OCR Subsystem** and the **Scientific Domain Model**:

1. **Stateless Producer Role**: The OCR Subsystem functions exclusively as a stateless, side-effect-free "metadata generator" (factory pattern). It is in charge of consuming raw raster feeds and producing a structured `ParsedHeader` representation.
2. **SDM Sovereignty**: The **Scientific Domain Model (SDM)** (within the Workspace core state tree) has **absolute, exclusive ownership** over the lifecycle, mutations, and storage of `ParsedHeader`.
3. **No Retained State**: Once the OCR orchestrator returns a `SUCCESS` state containing the `ParsedHeader`, the OCR Subsystem relinquishes all references to that object.
4. **Lifecycle Control**:
   * *Editing & Correction*: Subsequent manual changes, text correction, overriding depth scales, or unit modifications requested by the user are handled directly by Workspace reducer actions operating on the SDM state, completely bypassing the OCR subsystem.
   * *Persistence*: Serialization to file (LAS, JSON) or backup to databases (`localforage`, Firestore) is managed directly by the Workspace Persistence engine. No OCR code holds saving handles or tracking indices.

---

## 12. Threading & Web Worker Execution Rules

To ensure a smooth 60 FPS workspace interface during heavy textual parsing, the OCR engine complies with strict headless execution rules:

* **Zero Window/DOM Assumption**: The OCR pipeline core and algorithms are strictly headless. They **must never assume** the presence of `window`, `document`, DOM nodes, or Canvas UI elements.
* **Canvas Isolation**: Canvas drawing states and pixel-read operations must use isolated `OffscreenCanvas` contexts or raw pixel buffers (`Uint8ClampedArray` inside `ImageData`).
* **Web Worker Ready**: Every sub-service must be fully deployable inside background Web Workers, leaving the browser main thread completely free for concurrent workspace pan, zoom, and drawing interactions.

---

## 13. Error Handling

All stages of the OCR processing pipeline are designed using functional, deterministic execution results instead of traditional throw-catch exceptions:

1. **Deterministic Execution**: Success and Failure states are modeled using explicit discrimination types (e.g., `status: 'success'` or `status: 'failure'`).
2. **Pre-emptive Failure Isolation**: If any stage of the pipeline fails (e.g., `HeaderLocalizationService` is unable to locate the header box), the pipeline terminates immediately, returning a clean, descriptive error result.
3. **No Side-Effects**: System and application runtime exceptions are caught locally within the implementation adapters. Errors are logged internally and translated to user-friendly messages within the returned `Result` structure to prevent main thread execution blocks.

---

## 14. Performance & Hardware Resource Targets

Initial operational performance bounds for the OCR subsystem are allocated as follows:

* **Runtime**: Target execution speed of $< 2.5\text{ seconds}$ for a standard 2000x2000 px localized header block.
* **Memory**: Maximum processing heap allocation of $< 120\text{ MB}$ above base application consumption.
* **Latency**: Main thread UI interaction blocking duration must remain under $50\text{ ms}$ (long-running computations are routed to Web Workers).

---

## 15. Extension & Stability Rules

To support seamless upgrades of recognition libraries (e.g., migrating from browser-based Web-OCR to modern ML models) without breaking application layers, the system must follow these extension rules:

1. **Stable Interfaces**: The external contracts defined in Section 6 must remain unmodified.
2. **Plugin Implementations**: New OCR engines or libraries must be wrapped in adapters implementing the defined services (e.g., `TesseractRecognitionAdapter` implementing `RecognitionService`).
3. **Zero State Pollution**: The core Workspace state format must remain completely isolated from the specific features of any external libraries.

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
