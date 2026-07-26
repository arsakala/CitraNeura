# CitraNeura OCR Algorithm Implementation Plan & Development Roadmap (OCR-IMP-04)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Implementation Contract)**  
**Date:** 2026-07-09  

---

## 1. Introduction & Objectives

This document establishes the official **OCR Algorithm Implementation Plan & Development Roadmap v1.0 (OCR-IMP-04)**. This blueprint breaks down the mathematical, layout, and domain parsing specifications into discrete, manageable work packages, maps their dependencies, establishes scientific checkpoints, defines acceptance criteria, builds a comprehensive traceability matrix, and enforces review gates.

This plan guarantees that:
1. Every algorithmic module maps directly to the frozen system contracts.
2. The pipeline's structural, semantic, and scientific layers can be verified incrementally.
3. No code is merged into the master workspace without passing strict, automated regression test runs and review gates.

---

## 2. Algorithm Work Package Breakdown

The six-stage OCR processing pipeline is partitioned into 38 discrete work packages (WPs). Each work package is self-contained and independently testable.

```
Raster Input (I)
       │
       ├─► [Stage 1: Header Localization] (WP-1.1 to WP-1.8)
       │
       ├─► [Stage 2: Text Region Detection] (WP-2.1 to WP-2.7)
       │
       ├─► [Stage 3: Recognition Adapter] (WP-3.1 to WP-3.8)
       │
       ├─► [Stage 4: Scientific Parsing] (WP-4.1 to WP-4.7)
       │
       ├─► [Stage 5: Confidence Propagation] (WP-5.1 to WP-5.7)
       │
       └─► [Stage 6: Domain Validation] (WP-6.1 to WP-6.6)
```

### Stage 1: Header Localization (WP-1)
*   **WP-1.1: Image Normalization**: Contrast adjustment, bilateral spatial smoothing, and aspect-ratio preservation to handle uneven exposures.
*   **WP-1.2: Grayscale Conversion**: Direct channel-weighted transformation using the scientific formula $Y = 0.299R + 0.587G + 0.114B$.
*   **WP-1.3: Horizontal Projection Profile Calculation**: Row-by-row average intensity calculation $P_h(y) = \frac{1}{W}\sum f(x, y)$ across columns.
*   **WP-1.4: Profile Smoothing**: Filtering high-frequency grid and font noise in the projection profile using a moving average window controlled by `OP_LOC_SMOOTH_W`.
*   **WP-1.5: Divider Line Detection**: Applying a spatial gradient operator $\left| \frac{\partial P_h^{smooth}(y)}{\partial y} \right|$ and finding the peak $y_{div}$ matching `OP_LOC_GRAD_THRES` and `OP_LOC_DIV_STRENGTH`.
*   **WP-1.6: ROI Extraction**: Geometric clipping of the localized Well Header $[0, 0, W, y_{div}]$, yielding an isolated raster.
*   **WP-1.7: Localization Confidence Evaluation**: Computing the $C_{roi}$ score based on gradient peak prominence and evaluating it against `OP_LOC_CONF_THRES`.
*   **WP-1.8: Stage 1 Contract and Type Validation**: Strictly mapping the localized parameters into the `HeaderROI` TypeScript interface and managing `FAILURE_HEADER_NOT_FOUND` errors.

### Stage 2: Text Region Detection (WP-2)
*   **WP-2.1: Image Thresholding**: Adaptive localized binarization to extract high-contrast foreground text characters from the paper background.
*   **WP-2.2: Anisotropic Horizontal Morphological Dilation**: Running a horizontal grouping pass using `OP_DET_KERN_W` and `OP_DET_KERN_H` to merge adjacent characters into coherent line boxes.
*   **WP-2.3: Connected Component Extraction**: Standard 8-connectivity labeling to locate separate bounding box contours in the binarized mask.
*   **WP-2.4: Area & Aspect Noise Rejection**: Filtering non-text components using `OP_DET_MIN_AREA` and aspect ratio-to-density filters in `OP_DET_NOISE_REJ`.
*   **WP-2.5: Bounding Box Union & Merging**: Detecting and combining overlapping text blocks using `OP_DET_OVERLAP_TOL`.
*   **WP-2.6: Top-to-Bottom Layout Sorting**: Sorting row boxes vertically by ascending $y_{min}$ coordinates, creating a deterministic logical layout flow.
*   **WP-2.7: Stage 2 Contract and Type Validation**: Formulating the output into the `DetectedText[]` structure and raising `FAILURE_TEXT_REGION_EMPTY` if no text is resolved.

### Stage 3: Recognition Adapter Integration (WP-3)
*   **WP-3.1: Adapter Abstraction**: Building clean abstract boundaries between the orchestrator core and external OCR libraries, enforcing zero-import rules inside the core.
*   **WP-3.2: Worker Pool Provisioning**: Setting up and spawning up to `OP_WRK_POOL_SIZE` Web Worker threads, limited by `OP_WRK_MAX_MEM` per worker.
*   **WP-3.3: Image Slicing and Cropping**: Extracting independent raster crops corresponding to individual row bounding boxes inside the localized ROI.
*   **WP-3.4: Parallel Task Scheduling**: Distributing image crops to the idle worker queue to optimize multi-core throughput.
*   **WP-3.5: WASM Execution & Timeout Management**: Executing optical character recognition inside Web Workers and monitoring execution time limits using `OP_REC_TIMEOUT` and checking `AbortSignal`.
*   **WP-3.6: Character Parsing & Language Tagging**: Extracting character sequences (UTF-8) and mapping language codes (e.g., `'eng'`, `'ind'`).
*   **WP-3.7: Resource Disposal**: Reclaiming web worker heap memories, killing threads on demand, and preventing leaks.
*   **WP-3.8: Stage 3 Contract and Type Validation**: Exporting structures to `RecognizedToken[]` and managing `FAILURE_RECOGNITION_FAILED` and `FAILURE_RECOGNITION_TIMEOUT` states.

### Stage 4: Scientific Parsing (WP-4)
*   **WP-4.1: Token Spatial Alignment**: Re-associating horizontal token gaps to group values with corresponding label keys.
*   **WP-4.2: Well Name Parsing**: Matching well names via regular expressions and fuzzy dictionary matches with Levenshtein distance thresholds controlled by `OP_PAR_LEV_ACCEPT`.
*   **WP-4.3: Operator & Field Mapping**: Fuzzy key matching against regional catalogs with a boost factor of `OP_PAR_DICT_CONF` for exact dictionary hits.
*   **WP-4.4: UWI and Date Parsing**: Formatting well identifiers to standard API lengths and date strings to ISO-8601 compliant masks defined in `OP_VAL_DATE_FORMATS`.
*   **WP-4.5: Scientific Depth & Scale Interpreter**: Parsing starting/ending depths, converting strings to floats, parsing depth units, and validating scale ratios (e.g., `'1:200'`).
*   **WP-4.6: Mandatory Field Completeness Check**: Validating that all required geological attributes listed in `OP_PAR_MANDATORY_FIELDS` are non-null.
*   **WP-4.7: Stage 4 Contract and Type Validation**: Converting variables to `ParsedHeader` and asserting the correctness of the spatial tracking indices.

### Stage 5: Confidence Propagation (WP-5)
*   **WP-5.1: Optical Average Extraction**: Implementing the geometric mean formula over recognized character confidences:
    $$\bar{C}_{rec}(f) = \left( \prod_{i=1}^{n} \text{token}_i.\text{confidence} \right)^{\frac{1}{n}}$$
    with a strict piecewise fallback to `0.0` if $n = 0$.
*   **WP-5.2: Localization Penalty Multiplication**: Factoring the parent Header localization score $C_{roi}$ into each parsed field confidence score.
*   **WP-5.3: Semantic Dictionary Adjustments**: Applying the `OP_PAR_DICT_CONF` boost factor for exact hits and penalizing fuzzy distances.
*   **WP-5.4: Mathematical Metric Clamping**: Enforcing upper limits on propagated values to ensure $C_f \in [0.0, 1.0]$.
*   **WP-5.5: Weighted Composite Confidence Synthesis**: Calculating the final weighted pipeline score:
    $$C_{composite} = \text{OP\_CON\_W\_NAME} \times C_{wellName} + \text{OP\_CON\_W\_DEPTH} \times C_{depths} + \text{OP\_CON\_W\_SCALE} \times C_{scaleRatio}$$
*   **WP-5.6: Threshold Verification**: Comparing $C_{composite}$ against `OP_CON_COMP_THRES` to toggle the boolean `minimumConfidenceMet` flag.
*   **WP-5.7: Stage 5 Contract and Type Validation**: Generating `ConfidenceRecord` structures and raising `FAILURE_VALIDATION_REJECTED` if limits are violated.

### Stage 6: Domain Validation (WP-6)
*   **WP-6.1: Tier 1 Structural Auditing**: Enforcing character lengths, string schemas, and ISO date structure formats.
*   **WP-6.2: Tier 2 Semantic Verification**: Auditing lexical fields against dictionaries to identify regional inconsistencies.
*   **WP-6.3: Tier 3 Scientific Boundary Verification**: Validating geological realities:
    $$d_{bottom} > d_{top} \quad \text{and} \quad d_{top} \ge \text{OP\_VAL\_MIN\_DEPTH} \quad \text{and} \quad d_{bottom} \le \text{OP\_VAL\_MAX\_DEPTH}$$
    And asserting depth units match `OP_VAL_DEPTH_UNITS`.
*   **WP-6.4: Warning & Error Aggregation**: Collecting structural, semantic, and scientific violations into their respective arrays.
*   **WP-6.5: Final Status Evaluation**: Asserting if `isValid` is true (all tiers must pass and composite confidence must be met).
*   **WP-6.6: Stage 6 Contract and Type Validation**: Exporting standard `ValidationResult` and throwing `FAILURE_VALIDATION_REJECTED` on invalid bounds.

---

## 3. Internal Module Dependency Map

The work packages run under a strict, acyclic topological sort order. The dependency contract for each stage package is defined below:

| Work Package (WP) | Direct Inputs | Core Dependencies | Parameters Consumed | Expected Errors Handled | Contracts To Fulfill |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stage 1 (Localization)** | Raw raster `ImageData` | None | `OP_LOC_MAX_H_PCT`, `OP_LOC_GRAD_THRES`, `OP_LOC_SMOOTH_W`, `OP_LOC_DIV_STRENGTH`, `OP_LOC_CONF_THRES` | `FAILURE_HEADER_NOT_FOUND` | Locates division line $y_{div}$ at vertical transition, returns `HeaderROI` |
| **Stage 2 (Detection)** | `ImageData`, `HeaderROI` | Stage 1 | `OP_DET_KERN_W`, `OP_DET_KERN_H`, `OP_DET_OVERLAP_TOL`, `OP_DET_MIN_AREA`, `OP_DET_NOISE_REJ` | `FAILURE_TEXT_REGION_EMPTY` | Partitions localized ROI into sorted vertical text bands `DetectedText[]` |
| **Stage 3 (Recognition)** | `ImageData`, `DetectedText[]` | Stage 2 | `OP_REC_TIMEOUT`, `OP_REC_MAX_RETRIES`, `OP_REC_POLL_INT`, `OP_REC_MAX_REGIONS`, `OP_WRK_MAX_MEM`, `OP_WRK_POOL_SIZE` | `FAILURE_RECOGNITION_TIMEOUT`, `FAILURE_RECOGNITION_FAILED` | Transcribes text row raster slices to UTF-8 character arrays `RecognizedToken[]` |
| **Stage 4 (Parsing)** | `RecognizedToken[]` | Stage 3 | `OP_PAR_REGEX_PRI`, `OP_PAR_LEV_ACCEPT`, `OP_PAR_DICT_CONF`, `OP_PAR_MANDATORY_FIELDS` | `FAILURE_PARSING_UNSTRUCTURED` | Matches raw strings to typed properties, exports `ParsedHeader` |
| **Stage 5 (Confidence)**| `ParsedHeader`, `RecognizedToken[]`, `HeaderROI` | Stage 4 | `OP_CON_W_NAME`, `OP_CON_W_DEPTH`, `OP_CON_W_SCALE`, `OP_CON_COMP_THRES` | None (pure math propagation) | Computes field-level confidences and composite score `ConfidenceRecord` |
| **Stage 6 (Validation)** | `ParsedHeader`, `ConfidenceRecord` | Stage 5 | `OP_VAL_MAX_DEPTH`, `OP_VAL_MIN_DEPTH`, `OP_VAL_DEPTH_UNITS`, `OP_VAL_SCALE_RATIOS`, `OP_VAL_DATE_FORMATS` | `FAILURE_VALIDATION_REJECTED` | Evaluates Tiers 1-3 constraints, outputs immutable `ValidationResult` |

### Cyclic Dependency Prevention Guard
To ensure no cyclic dependencies are introduced, compiling the pipeline undergoes a static structure inspection:
$$\text{Dependency Graph } G = (V, E) \quad \text{must form a Directed Acyclic Graph (DAG)}$$
Where $V$ represents the 6 processing stages, and $E$ represents execution transitions. A static dependency guard test (`contract-tests/dependency-guard.test.ts`) actively blocks builds containing imports that bypass this hierarchy.

---

## 4. Scientific Verification Points (SVP)

We define six Scientific Verification Points (SVPs) acting as logical checkpoints in the codebase. These points act as the exact locations for automated regression testing and parameter tuning audits.

```
       Raster Input
            │
            ▼
┌───────────────────────┐
│Stage 1: Localization  ├────────► SVP-1: Localization Division Line check (Header ROI)
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│Stage 2: Text Detection├────────► SVP-2: Segmentation Intersection-over-Union (IoU)
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│Stage 3: Recognition   ├────────► SVP-3: Word/Character Error Rates (CER & WER)
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│Stage 4: Parsing       ├────────► SVP-4: Field Extraction Accuracy (FEA)
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│Stage 5: Confidence    ├────────► SVP-5: Confidence Calibration Accuracy (RMSE_C)
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│Stage 6: Validation    ├────────► SVP-6: Scientific Constraint Compliance (Sanity bounds)
└───────────────────────┘
```

*   **SVP-1 (Localization Peak Prominence)**: Located directly after projection profile gradient analysis. Verifies that $y_{div}$ coordinates fall within standard geometric envelopes and do not bleed into logging grids.
*   **SVP-2 (Layout Overlap Threshold)**: Evaluated directly after anisotropic grouping. Verifies that the horizontal line segmentation has a high vertical overlap tolerance and does not split long characters or columns.
*   **SVP-3 (Transcription Error Verification)**: Located on the recognition adapter outputs. Benchmarks character and word accuracy (CER/WER) against the golden transcription set.
*   **SVP-4 (Fuzzy Parser Distance Accuracy)**: Checkpoint on the parser's matching scores. Measures Levenshtein similarity when converting degraded strings to structured dictionary terms.
*   **SVP-5 (Confidence Calibration Checkpoint)**: Checkpoint inside confidence propagation. Validates that final composite score metrics correlate directly with actual transcription error rates, targeting $\text{RMSE}_C \le 0.08$.
*   **SVP-6 (Sanity Constraint Gate)**: Checkpoint inside validation. Verifies the physical consistency checks (e.g., depths boundaries, unit rules) before exporting.

---

## 5. Development Acceptance Criteria

Each work package must pass a three-tier acceptance verification before being promoted.

```
                  Work Package Implementation
                               │
                               ▼
            ┌──────────────────────────────────────┐
            │   Tier 1: Unit & Contract Tests      │ ──► Target: 100% Passes
            └──────────────────┬───────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────┐
            │   Tier 2: Scientific Tiers A/B/C     │ ──► Target: Meet Tiers Limits
            └──────────────────┬───────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────┐
            │   Tier 3: Regression Performance     │ ──► Target: No metrics regression
            └──────────────────────────────────────┘
```

### Metrics Acceptance Thresholds

| Stage | Target Test Suite | Contract Test File Reference | Golden Dataset Threshold (Clean) | Benchmark Dataset Threshold (Paper) | Stress Dataset Threshold (Degraded) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | `stage1.contract` | `contract-tests/stage1.contract.test.ts` | $\text{IoU} \ge 0.98$ | $\text{IoU} \ge 0.92$ | $\text{IoU} \ge 0.85$ |
| **Stage 2** | `stage2.contract` | `contract-tests/stage2.contract.test.ts` | $\text{IoU}_{lines} \ge 0.98$ | $\text{IoU}_{lines} \ge 0.92$ | $\text{IoU}_{lines} \ge 0.85$ |
| **Stage 3** | `stage3.contract` | `contract-tests/stage3.contract.test.ts` | $\text{CER} \le 1.0\%$ | $\text{CER} \le 4.5\%$ | $\text{CER} \le 10.0\%$ |
| **Stage 4** | `stage4.contract` | `contract-tests/stage4.contract.test.ts` | $\text{FEA} \ge 99.0\%$ | $\text{FEA} \ge 92.0\%$ | $\text{FEA} \ge 85.0\%$ |
| **Stage 5** | `stage5.contract` | `contract-tests/stage5.contract.test.ts` | $\text{RMSE}_C \le 0.05$ | $\text{RMSE}_C \le 0.08$ | $\text{RMSE}_C \le 0.12$ |
| **Stage 6** | `stage6.contract` | `contract-tests/stage6.contract.test.ts` | $100\%$ Validations Pass | $100\%$ Validations Pass | Rejections correctly mapped |

---

## 6. Algorithm Traceability Matrix

The traceability matrix establishes clear, bi-directional paths linking physical system requirements, parameters, error schemas, scientific metrics, source files, test assets, and datasets.

| Requirement ID | Configuration Parameters | System Error Code | Scientific Acceptance Metric | Implementation Source File | Contract Test Suite | Target Benchmark Category |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`OCR-ALG-01`** *(Stage 1: Localization)* | `OP_LOC_MAX_H_PCT`, `OP_LOC_GRAD_THRES`, `OP_LOC_SMOOTH_W`, `OP_LOC_DIV_STRENGTH` | `FAILURE_HEADER_NOT_FOUND` | Header $\text{IoU}$ | `lib/ocr/stages/index.ts` | `stage1.contract.test.ts` | `Golden`, `Benchmark`, `Stress` |
| **`OCR-ALG-01`** *(Stage 2: Detection)* | `OP_DET_KERN_W`, `OP_DET_KERN_H`, `OP_DET_OVERLAP_TOL`, `OP_DET_MIN_AREA`, `OP_DET_NOISE_REJ` | `FAILURE_TEXT_REGION_EMPTY` | Layout $\text{IoU}$ | `lib/ocr/stages/index.ts` | `stage2.contract.test.ts` | `Golden`, `Benchmark` |
| **`OCR-ALG-01`** *(Stage 3: Recognition)* | `OP_REC_TIMEOUT`, `OP_REC_MAX_RETRIES`, `OP_REC_POLL_INT`, `OP_REC_MAX_REGIONS` | `FAILURE_RECOGNITION_TIMEOUT`, `FAILURE_RECOGNITION_FAILED` | $\text{CER}$ & $\text{WER}$ | `lib/ocr/stages/index.ts` | `stage3.contract.test.ts` | `Golden`, `Benchmark`, `Regression` |
| **`OCR-ALG-01`** *(Stage 4: Parsing)* | `OP_PAR_REGEX_PRI`, `OP_PAR_LEV_ACCEPT`, `OP_PAR_DICT_CONF`, `OP_PAR_MANDATORY_FIELDS` | `FAILURE_PARSING_UNSTRUCTURED` | Field Extraction Accuracy ($\text{FEA}$) | `lib/ocr/stages/index.ts` | `stage4.contract.test.ts` | `Golden`, `Benchmark`, `Synthetic` |
| **`OCR-ALG-01`** *(Stage 5: Confidence)* | `OP_CON_W_NAME`, `OP_CON_W_DEPTH`, `OP_CON_W_SCALE`, `OP_CON_COMP_THRES` | None (pure score propagation) | Calibration Error ($\text{RMSE}_C$) | `lib/ocr/stages/index.ts` | `stage5.contract.test.ts` | `Golden`, `Benchmark`, `Regression` |
| **`OCR-ALG-01`** *(Stage 6: Validation)* | `OP_VAL_MAX_DEPTH`, `OP_VAL_MIN_DEPTH`, `OP_VAL_DEPTH_UNITS`, `OP_VAL_SCALE_RATIOS`, `OP_VAL_DATE_FORMATS` | `FAILURE_VALIDATION_REJECTED` | Domain Constraint Accuracy | `lib/ocr/stages/index.ts` | `stage6.contract.test.ts` | `Golden`, `Stress`, `Synthetic` |

---

## 7. Incremental Delivery Order

To minimize system integration risk and avoid downstream testing blockages, the development team follows an **Acyclic Incremental Delivery Sequence**:

$$\text{Stage 1 (Localization)} \longrightarrow \text{Stage 2 (Detection)} \longrightarrow \text{Stage 4 (Parsing)} \longrightarrow \text{Stage 5 (Confidence)} \longrightarrow \text{Stage 6 (Validation)} \longrightarrow \text{Stage 3 (Recognition Adapter)}$$

### Development Sequence Rationale
1. **Mock-Driven Testing (Stages 1, 2, 4, 5, 6 first)**: Spawning heavy WebAssembly sandboxes and worker threads (Stage 3) is a major engineering and memory burden. By developing Stages 4, 5, and 6 early, we can dry-run the entire parsing, confidence propagation, and constraint validation engine using **deterministic synthetic token lists**.
2. **Deterministic Regression Baselines**: Ensuring that the mathematical equations of Stage 5 and the domain rules of Stage 6 function perfectly before integrating the actual character engine (Stage 3) guarantees that any regressions are isolated to OCR transcription anomalies rather than parsing logic bugs.
3. **WASM Isolation decoupling**: Deferring the recognition adapter to the final step allows the core pipeline development to remain completely headless and fast, minimizing browser threading conflicts during initial integration.

---

## 8. Review Gates

Before code for any stage $K$ can be promoted or merged, it must pass through four formal review gates in sequence. No developer or build system may bypass these constraints.

```
       [Stage K Development Complete]
                     │
                     ▼
       ┌───────────────────────────┐
       │ 1. Architectural Review   │ ──► Verify: Zero external dependencies in core,
       └─────────────┬─────────────┘            Strict TypeScript interface adherence
                     │
                     ▼
       ┌───────────────────────────┐
       │ 2. Scientific Review      │ ──► Verify: Mathematical formulas match contracts,
       └─────────────┬─────────────┘            Confidence propagation bounds are checked
                     │
                     ▼
       ┌───────────────────────────┐
       │ 3. Regression Evaluation  │ ──► Verify: `npm run benchmark:ocr` returns 100% PASS,
       └─────────────┬─────────────┘            $\Delta \text{CER} \le 0$, $\Delta \text{IoU} \ge 0$, $\Delta \text{RMSE}_C \le 0$
                     │
                     ▼
       ┌───────────────────────────┐
       │ 4. System Integration     │ ──► Verify: Full compliance contract test suite passing,
       └─────────────┬─────────────┘            Formal approval by SVB / CAB
                     │
                     ▼
        [Promotion to Production Stage]
```

### Transition Constraints
*   **Sequential Locking**: A stage cannot initiate Architectural Review until the preceding stage is certified as merged and deployed.
*   **Regression Penalty Policy**: If any benchmark metric experiences a regression compared to the baseline, the candidate is automatically rejected at Gate 3. No overrides are permitted.
*   **Documentation Binding**: The test reports generated by `npm run test:ocr` and the benchmarks generated by `npm run benchmark:ocr` must be committed as physical artifacts in the build record before Gate 4.

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
