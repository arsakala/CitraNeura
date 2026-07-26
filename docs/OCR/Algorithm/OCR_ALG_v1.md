# OCR Algorithm Contract v1.0 (OCR-ALG-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Algorithm Contract Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Scope

This document establishes the **OCR Algorithm Contract v1.0 (OCR-ALG-01)** for the CitraNeura Application Platform. Following our strict **Type-Triggered System Design (TTSD)** paradigm, this contract defines the formal mathematical, geometric, and logical behaviors of each processing stage within the OCR pipeline.

This contract explicitly decouples the **core mathematical algorithms and parsing state-machines** from specific **third-party technology adapters** (e.g., Tesseract.js, cloud-based vision models, or proprietary OCR runtimes). It treats character recognition as a black-box service producing raw transcriptions with associated spatial bounds and confidence intervals, while enforcing absolute, deterministic control over localization, segment extraction, semantic mapping, confidence propagation, and domain validation.

No implementation details, library selections, parameter tuning, or optimization heuristics are committed in this document; those remain deferred to the downstream Parameter Specification (`OCR_PARAMETER_SPEC_v1.md`), Error Specification (`OCR_ERROR_SPEC_v1.md`), and Scientific Acceptance phases.

---

## 2. Pipeline Execution Sequence

The OCR Pipeline coordinates six sequential, deterministic processing stages:

$$\text{Raster Input } (I) \longrightarrow \text{Stage 1: Header Localization} \longrightarrow \text{Stage 2: Text Region Detection} \longrightarrow \text{Stage 3: Recognition Adapter} \longrightarrow \text{Stage 4: Scientific Parsing} \longrightarrow \text{Stage 5: Confidence Propagation} \longrightarrow \text{Stage 6: Domain Validation} \longrightarrow \text{Workspace Import}$$

Each stage $k$ receives inputs $X_k$ and a unified context $C$, and produces a result $Y_k$. If any stage returns a failure status, pipeline execution is immediately aborted, producing the appropriate error state defined in the system architecture. All error outcomes, severity ratings, retry flags, and diagnostic logs are centralized and defined under `OCR_ERROR_SPEC_v1.md`.

---

## 3. Stage 1: Header Localization Contract

### 3.1 Objective & Mathematical Approach
Locate the boundaries of the Well Header region (the Region of Interest / ROI) at the top of a continuous vertical raster log.
The localization algorithm models the log's vertical layout as a structured density profile. Let the log image be represented as a 2D intensity function $f(x, y) \in [0, 1]$, where $x \in [0, W]$ and $y \in [0, H]$. 
The horizontal projection profile $P_h(y)$ is defined as:

$$P_h(y) = \frac{1}{W} \sum_{x=0}^{W-1} f(x, y)$$

The well header typically contains dense text and a horizontal boundary line (a transition zone to the tracks). The algorithm identifies the horizontal division line $y_{div}$ where the horizontal intensity profile exhibits a sharp, continuous spatial gradient and grid lines start, indicating the transition from the textual header to the digitized graphical tracks:

$$y_{div} = \operatorname{arg\,max}_{y \in [0, \, \text{OP\_LOC\_MAX\_H\_PCT} \times H]} \left| \frac{\partial P_h(y)}{\partial y} \right| \quad \text{subject to structural thresholding}$$

The localized Header ROI is then geometrically defined as:

$$\text{ROI} = \left\{ (x, y) \;\middle|\; x \in [0, W], y \in [0, y_{div}] \right\}$$

### 3.2 Formal Specifications

| Specification Type | Definition |
| :--- | :--- |
| **Inputs** | Raw raster image data $I$ of dimensions $W \times H$ pixels, `OCRExecutionContext` |
| **Outputs** | Geometrically bounded `HeaderROI` (defined by $x, y, w, h$, skew angle $\theta$, and localization confidence $C_{roi}$) |
| **Preconditions** | $W > 0$, $H > 0$, and raster image must be loaded into memory. |
| **Postconditions** | $y_{div} \le \text{OP\_LOC\_MAX\_H\_PCT} \times H$; the resulting ROI bounding box lies entirely within the bounds of $I$. |
| **Invariants** | The coordinate systems of the extracted ROI must be co-planar with $I$ (no projection changes). |
| **Expected Complexity** | Temporal: $\mathcal{O}(W \times y_{div})$ spatial scanning; Spatial: $\mathcal{O}(y_{div})$ for profile aggregation. |
| **Failure Conditions** | No distinct horizontal division line found within the bounds of the image height (`y_{div} > OP_LOC_MAX_H_PCT * H`), leading to a **`FAILURE_HEADER_NOT_FOUND`** status as defined in `OCR_ERROR_SPEC_v1.md`. |

---

## 4. Stage 2: Text Region Detection Contract

### 4.1 Objective & Heuristic Approach
Partition the localized Header ROI into discrete, readable textual bounding boxes (paragraphs, text lines, and words).
The core algorithm uses an anisotropic spatial aggregation filter (similar to Run-Length Smoothing or connected-component analysis with directional morphological dilation). 
Let the binary representation of the ROI be $b(x, y) \in \{0, 1\}$. We apply horizontal and vertical dilation kernels:

$$K_h = \text{rect}(k_w, 1), \quad K_v = \text{rect}(1, k_h)$$

where $k_w = \text{OP\_DET\_KERN\_W}$ and $k_h = \text{OP\_DET\_KERN\_H}$ to favor horizontal word-grouping into line-boxes rather than vertical cross-line merges. Connected components within the dilated space form the bounding boxes for text rows $R = \{r_1, r_2, \dots, r_m\}$. Each row $r_i$ is mapped as:

$$r_i = [x_{min}, y_{min}, x_{max}, y_{max}]$$

### 4.2 Formal Specifications

| Specification Type | Definition |
| :--- | :--- |
| **Inputs** | Localized `HeaderROI`, binarized pixel buffer of ROI, `OCRExecutionContext` |
| **Outputs** | Sorted array of $N$ disjoint `DetectedText` items representing individual layout rows, ordered from top-to-bottom ($y_{min}$ ascending). |
| **Preconditions** | Bounding box of `HeaderROI` must have positive width and height. |
| **Postconditions** | All output boxes are strictly subsets of the localized `HeaderROI`. No two rows $r_i$ and $r_j$ overlap by more than `OP_DET_OVERLAP_TOL` of their area. |
| **Invariants** | Text boxes remain sorted chronologically by vertical projection index. |
| **Expected Complexity** | Temporal: $\mathcal{O}(w \times h)$ where $w, h$ are ROI bounds; Spatial: $\mathcal{O}(w \times h)$ for binarized masks. |
| **Failure Conditions** | The number of detected boxes $N = 0$ inside the localized ROI, producing a **`FAILURE_TEXT_REGION_EMPTY`** status as defined in `OCR_ERROR_SPEC_v1.md`. |

---

## 5. Stage 3: Recognition Adapter Contract

### 5.1 Objective & Abstraction Layer
Transcribe raw, bounded pixel sub-regions of text into digital character sequences. 
To prevent third-party library pollution, the recognition engine behaves as an abstract service executing outside the platform's core loop:

```text
    ┌──────────────────────┐          ┌──────────────────────┐
    │    OCR Pipeline      │─────────►│  RecognitionAdapter  │
    │  (Abstract Core)     │◄─────────│  (External Plugin)   │
    └──────────────────────┘          └──────────────────────┘
```

The algorithm contract enforces that the adapter must receive isolated raster sub-images corresponding to individual `DetectedText` regions and return character arrays mapped to high-precision spatial bounding boxes and character-level certainty logs.

### 5.2 Formal Specifications

| Specification Type | Definition |
| :--- | :--- |
| **Inputs** | Isolated `DetectedText` image clips, array of region coordinates, `OCRExecutionContext` |
| **Outputs** | List of `RecognizedToken` arrays with transcribed text strings, detected font parameters, and token confidence ratings. |
| **Preconditions** | At least one valid text region is detected. The cancellation token `abortSignal` in `OCRExecutionContext` is checked before starting. |
| **Postconditions** | For each input region, a character transcription sequence must be generated (can be empty string if region contains only noise). |
| **Invariants** | Bounding boxes of resulting tokens must be local coordinates relative to the input region coordinate frame. |
| **Expected Complexity** | Delegated to the underlying adapter engine. Main-thread execution duration must be $\mathcal{O}(1)$ via offloading to Web Workers. |
| **Failure Conditions** | Underlying engine crashes, execution exceeds `OP_REC_TIMEOUT`, or user triggers `abortSignal`, leading to **`FAILURE_RECOGNITION_FAILED`** or **`FAILURE_RECOGNITION_TIMEOUT`** as defined in `OCR_ERROR_SPEC_v1.md`. |

---

## 6. Stage 4: Scientific Parsing Contract

### 6.1 Objective & State-Machine Mapping
Transform raw, unstructured string tokens into structured, scientifically typed well log attributes. 
The parser operates as a deterministic, rule-based regular expression state machine paired with a Levenshtein distance metric $D_L(s_1, s_2)$ for fuzzy key matching against regional catalogs.

Let $K$ be the set of target domain metadata keys defined under standard schemas.
For each recognized token $t$, the parser evaluates a hierarchical matching rule based on `OP_PAR_REGEX_PRI`:

1. **Exact Regular Expression Match**: Evaluates if the token matches scientific patterns defined in routing filters (e.g., API numbers match UWI structures, depths match numerical key-value patterns).
2. **Fuzzy Key Matching**: Evaluates Levenshtein distance against known well header dictionaries:
   
   $$\text{MatchScore}(t, k) = 1.0 - \frac{D_L(t.text, k)}{\max(|t.text|, |k|)}$$
   
   If $\text{MatchScore} \ge \text{OP\_PAR\_LEV\_ACCEPT}$, the value adjacent to token $t$ is mapped to the domain key $k$.
3. **Mandatory Field Integrity**: Verifies that all fields specified in the parameter `OP_PAR_MANDATORY_FIELDS` are successfully resolved.

### 6.2 Formal Specifications

| Specification Type | Definition |
| :--- | :--- |
| **Inputs** | Array of `RecognizedToken` objects, `OCRExecutionContext` |
| **Outputs** | A structured `ParsedHeader` record (containing keys, values, and localized metadata coordinates) |
| **Preconditions** | Input tokens array must contain at least one valid string element. |
| **Postconditions** | Output `ParsedHeader` contains standard properties, with fields set to `null` if they cannot be extracted or mapped. |
| **Invariants** | No modification or mutational side-effects on the original array of recognized tokens. |
| **Expected Complexity** | Temporal: $\mathcal{O}(M \times K)$ where $M$ is token count and $K$ is key dictionary size; Spatial: $\mathcal{O}(M)$ metadata references. |
| **Failure Conditions** | Absolute failure to parse any scientific keys, or any required field in `OP_PAR_MANDATORY_FIELDS` resolves to `null`, triggering a **`FAILURE_PARSING_UNSTRUCTURED`** status as defined in `OCR_ERROR_SPEC_v1.md`. |

---

## 7. Stage 5: Confidence Propagation Contract

### 7.1 Objective & Mathematical Propagation Rules
Synthesize raw, multi-source optical and layout indicators into a singular, mathematically traceable confidence metric, preventing silent data pollution or artificial high scores.

```text
  [ROI Localization Score] (C_roi) ──┐
                                      ├──► [Field Confidence (C_f)] ──► [Composite Confidence (C_comp)]
  [OCR Token Certainties]  (C_rec) ──┤
                                      │
  [Semantic Parser Match]  (H_match) ┘
```

The confidence score propagates sequentially through three distinct steps:

#### Step 1: Optical Token Average (with Edge-Case Contract)
For any parsed field $f$ consisting of $n$ recognized character tokens, the raw recognition score $\bar{C}_{rec}(f)$ is computed as follows. 

To resolve the mathematical edge case of empty token lists ($n = 0$) or complete recognition failures, the contract establishes a deterministic piecewise mapping:

$$\bar{C}_{rec}(f) = \begin{cases} 0.0 & \text{if } n = 0 \\ \left( \prod_{i=1}^{n} \text{token}_i.\text{confidence} \right)^{\frac{1}{n}} & \text{if } n > 0 \end{cases}$$

Note that if any token in the recognized token list has a confidence value of exactly $0.0$, the resulting geometric mean is properly evaluated as $0.0$ without causing undefined mathematical conditions.

#### Step 2: Semantic Matching Penalty & Dictionary Boost
The overall field confidence $C_f$ is computed by penalizing or boosting the optical score based on the Levenshtein distance match factor $H_{match} \in [0.0, 1.0]$, parent region localization confidence $C_{roi}$, and dictionary parameters.

To prevent mathematical overflow or metrics drift, the synthesis incorporates an explicit upper-bound clamp:

$$C_f = \min\left(1.0, \, \bar{C}_{rec}(f) \times H_{match} \times C_{roi} \times B\right)$$

where:
* $C_{roi}$ is the localization score of the parent Header region.
* $B = \text{OP\_PAR\_DICT\_CONF}$ if the fuzzy matching resolves to an exact dictionary hit, else $1.0$.

#### Step 3: Composite Confidence Synthesis
The final composite pipeline confidence $C_{composite}$ is calculated as a weighted arithmetic mean of critical field confidence ratings:

$$C_{composite} = \text{OP\_CON\_W\_NAME} \times C_{wellName} + \text{OP\_CON\_W\_DEPTH} \times C_{depths} + \text{OP\_CON\_W\_SCALE} \times C_{scaleRatio}$$

subject to strict normalization constraints:

$$\text{OP\_CON\_W\_NAME} + \text{OP\_CON\_W\_DEPTH} + \text{OP\_CON\_W\_SCALE} = 1.0 \quad \text{and} \quad \forall w \ge 0$$

### 7.2 Formal Specifications

| Specification Type | Definition |
| :--- | :--- |
| **Inputs** | `ParsedHeader`, raw token certainties, localization scores, `OCRExecutionContext` |
| **Outputs** | `ConfidenceRecord` containing synthesized metrics and a boolean `minimumConfidenceMet` flag. |
| **Preconditions** | Confidence inputs must be strictly bounded: $C \in [0.0, 1.0]$. |
| **Postconditions** | Output $C_{composite}$ must lie strictly within the range $[0.0, 1.0]$. |
| **Invariants** | All confidence calculations are reproducible and deterministic under identical input parameter weights. |
| **Expected Complexity** | Temporal: $\mathcal{O}(F)$ where $F$ is field count; Spatial: $\mathcal{O}(1)$ storage metrics. |
| **Failure Conditions** | Any input confidence value lies outside $[0.0, 1.0]$, or synthesized $C_{composite} < \text{OP\_CON\_COMP\_THRES}$, resulting in a `minimumConfidenceMet` flag value of false, leading to a **`FAILURE_VALIDATION_REJECTED`** pipeline response. |

---

## 8. Stage 6: Domain Validation Contract

### 8.1 Objective & Multi-Tier Validation Algorithms
Validate the structured `ParsedHeader` against structural, semantic, and scientific boundaries before committing to the Scientific Domain Model.
The validation algorithms execute in three progressive tiers:

#### Tier 1: Structural Validation
Verifies formatting correctness of string identifiers:
* **UWI (Unique Well Identifier)**: Checks length matches standard API structures.
* **Date**: Ensures parsing complies with date-format syntax masks defined in `OP_VAL_DATE_FORMATS`.

#### Tier 2: Semantic Validation
Cross-checks lexical tokens against regional dictionaries to detect letter-substitution errors:
* **Operator/Field Match**: Compares names against reference lists to output warnings or exact corrections.

#### Tier 3: Scientific Validation
Enforces physical well logging realities and scale constraints:
* **Depth Order Constraint**: Enforces that bottom depth $d_{bottom}$ is strictly greater than top depth $d_{top}$, bounded by physical parameters:

$$d_{bottom} > d_{top} \quad \text{and} \quad d_{top} \ge \text{OP\_VAL\_MIN\_DEPTH} \quad \text{and} \quad d_{bottom} \le \text{OP\_VAL\_MAX\_DEPTH}$$

* **Unit Restriction**: Validates that units correspond strictly to allowed configurations:

$$\text{unit} \in \text{OP\_VAL\_DEPTH\_UNITS}$$

* **Scale Ratio Integrity**: Ensures scale mappings conform to standard structural patterns:

$$\text{scaleRatio} \in \text{OP\_VAL\_SCALE\_RATIOS}$$

### 8.2 Formal Specifications

| Specification Type | Definition |
| :--- | :--- |
| **Inputs** | `ParsedHeader`, `ConfidenceRecord`, `OCRExecutionContext` |
| **Outputs** | Immutable `ValidationResult` containing error reports, warning lists, and final approval flags. |
| **Preconditions** | Structured parsed header must be instantiated. |
| **Postconditions** | `isValid` resolves to `false` if any Tier 3 scientific constraint is violated. |
| **Invariants** | Under no circumstance shall the validator modify or mutate fields in the input `ParsedHeader`. |
| **Expected Complexity** | Temporal: $\mathcal{O}(1)$ algebraic validations; Spatial: $\mathcal{O}(1)$ output flags. |
| **Failure Conditions** | A Tier 3 scientific constraint is violated, or composite confidence fails to meet `OP_CON_COMP_THRES`, triggering a **`FAILURE_VALIDATION_REJECTED`** status as defined in `OCR_ERROR_SPEC_v1.md`. |

---

## 9. Core-Adapter Separation Rules

To preserve architectural longevity, strict isolation boundaries must be maintained during implementation:

1. **No External Imports in Core Logic**: Core files governing parsing state-machines, confidence arithmetic, and domain validators must **never** import third-party libraries.
2. **Adapter Interface Adherence**: Any third-party integration must be encapsulated inside a concrete implementation of `RecognitionService`.
3. **Headless Execution Guard**: The core pipeline must be fully runnable within a standard Web Worker without accessing `window`, `document`, DOM nodes, or layout paints.

---

## 10. Verification Matrix

The following operational test matrix outlines the strict criteria for validating compliance with this contract:

| Test Case ID | Stage | Validation Scenario | Expected Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **TC-ALG-101** | Localization | Log with prominent top text and grid starts | $y_{div}$ located at correct grid boundary line. | **PASS** |
| **TC-ALG-201** | Detection | Distinct paragraphs and columns | Ordered list of horizontal lines. No merged columns. | **PASS** |
| **TC-ALG-301** | Recognition | Abort signal emitted mid-execution | Execution terminates instantly; returns `FAILURE_RECOGNITION_TIMEOUT`. | **PASS** |
| **TC-ALG-401** | Parsing | Text containing required key patterns | Maps keys successfully to structured domain entities. | **PASS** |
| **TC-ALG-501** | Confidence | Low OCR score paired with poor dictionary match | Composite confidence drops proportionally; flag sets to false. | **PASS** |
| **TC-ALG-601** | Validation | Input violating depth ordering criteria | `isValid` resolves to `false` with `scientificError` logs. | **PASS** |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
