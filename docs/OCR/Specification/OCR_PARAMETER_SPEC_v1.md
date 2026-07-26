# OCR Parameter Specification v1.0 (OCR-PARAM-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Parameter Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Parameter Governance

### 1.1 Purpose
This document establishes the official **OCR Parameter Specification v1.0 (OCR-PARAM-01)** for the CitraNeura Application Platform. Following the **Type-Triggered System Design (TTSD)** paradigm, this specification is the single, centralized, frozen authority for all configuration values, bounds, and thresholds governing the OCR subsystem.

### 1.2 Core Architectural Principle
The separation of concern between algorithms and parameters is governed by a strict unidirectional consumption rule:
> **Algorithms consume parameters. Algorithms do not define parameter values.**

All numerical tuning, scaling, and threshold constants are excluded from the algorithmic contracts (`OCR_ALG_v1.md`) and must be resolved dynamically at runtime by querying this parameter registry.

### 1.3 Ownership
The **CitraNeura Scientific Verification Board (SVB)** holds ultimate sovereignty over this parameter registry. No client application, component, or developer may hardcode overrides or modify these values at runtime without executing a formal change workflow.

### 1.4 Versioning & Freeze Policy
* This specification is frozen under Major Version `1.0`.
* Any modification of a value classified as a **Scientific Threshold** or **Domain Configuration** requires a full rerun of the Scientific Acceptance Criteria (SAC) and a regression validation suite, triggering a minor or major version bump.
* Modifications of **Engineering Thresholds** require a regression run and an operational benchmark verification.
* Modifications of **Operational Configurations** require a localized regression validation.

---

## 2. Global OCR Parameters

The following master registry lists every configurable constant in the CitraNeura OCR Subsystem:

| Parameter ID | Name | Description | Type | Unit | Allowed Range / Allowed Set | Default Value / Current Set | Class | Stage Using It | Change Requirement |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`OP_LOC_MAX_H_PCT`** | Max Search Height Factor | Bounding limit of vertical image search for header division line | Float | Ratio | `[0.05, 0.50]` | `0.25` | Scientific Threshold | Stage 1 | Regression + SAC |
| **`OP_LOC_GRAD_THRES`** | Min Profile Gradient | Minimum relative intensity change to identify vertical transitions | Float | Ratio | `[0.01, 1.00]` | `0.15` | Scientific Threshold | Stage 1 | Regression + SAC |
| **`OP_LOC_SMOOTH_W`** | Smoothing Window Size | Width of moving average filter applied to the vertical projection profile | Integer | Pixels | `[1, 100]` | `15` | Engineering Threshold | Stage 1 | Regression + Benchmark |
| **`OP_LOC_DIV_STRENGTH`**| Min Divider Intensity | Minimal peak magnitude for horizontal grid division indicator | Float | Ratio | `[0.10, 1.00]` | `0.40` | Scientific Threshold | Stage 1 | Regression + SAC |
| **`OP_LOC_CONF_THRES`**  | ROI Confidence Threshold | Minimum acceptable confidence for localized well header region | Float | Ratio | `[0.00, 1.00]` | `0.70` | Scientific Threshold | Stage 1 | Regression + SAC |
| **`OP_DET_KERN_W`** | Horizontal Kernel Width | Morphological horizontal dilation kernel width for word-to-line aggregation | Integer | Pixels | `[5, 150]` | `60` | Engineering Threshold | Stage 2 | Regression + Benchmark |
| **`OP_DET_KERN_H`** | Vertical Kernel Height | Morphological vertical dilation kernel height for baseline isolation | Integer | Pixels | `[1, 20]` | `3` | Engineering Threshold | Stage 2 | Regression + Benchmark |
| **`OP_DET_OVERLAP_TOL`** | Overlap Tolerance | Maximum bounding box overlap ratio allowed before merging regions | Float | Ratio | `[0.00, 0.50]` | `0.10` | Engineering Threshold | Stage 2 | Regression + Benchmark |
| **`OP_DET_MIN_AREA`** | Min Text Box Area | Bounding area threshold below which components are treated as noise | Integer | Pixels² | `[10, 1000]` | `150` | Engineering Threshold | Stage 2 | Regression + Benchmark |
| **`OP_DET_NOISE_REJ`** | Noise Rejection Ratio | Ratio of aspect-to-density used to prune non-text graphic artifacts | Float | Ratio | `[0.05, 0.95]` | `0.12` | Engineering Threshold | Stage 2 | Regression + Benchmark |
| **`OP_REC_TIMEOUT`** | Recognition Timeout | Maximum time allowed for complete glyph recognition execution | Integer | ms | `[500, 30000]`| `10000`| Operational Config | Stage 3 | Regression Only |
| **`OP_REC_MAX_RETRIES`** | Max Recognition Retries | Maximum retry attempts for transient worker initialization crashes | Integer | Counts | `[0, 5]` | `2` | Operational Config | Stage 3 | Regression Only |
| **`OP_REC_POLL_INT`** | Cancellation Poll Interval| Time interval to check for AbortSignal emissions | Integer | ms | `[10, 1000]` | `100` | Operational Config | Stage 3 | Regression Only |
| **`OP_REC_MAX_REGIONS`** | Max Region Limit | Upper bound on input regions to prevent browser heap overflow | Integer | Counts | `[5, 500]` | `100` | Engineering Threshold | Stage 3 | Regression + Benchmark |
| **`OP_PAR_REGEX_PRI`** | Regex Matching Priority | Hierarchy matching rank (Strict, Balanced, or Loose strategy) | String | Enum | `{'STRICT', 'BALANCED', 'LOOSE'}` | `'STRICT'` | Operational Config | Stage 4 | Regression Only |
| **`OP_PAR_LEV_ACCEPT`** | Levenshtein Threshold | Minimum normalized Levenshtein similarity for fuzzy matching | Float | Ratio | `[0.50, 1.00]` | `0.80` | Scientific Threshold | Stage 4 | Regression + SAC |
| **`OP_PAR_DICT_CONF`** | Dictionary Boost factor | Multiplicative confidence modifier for exact dictionary hits | Float | Ratio | `[1.00, 1.50]` | `1.15` | Scientific Threshold | Stage 4 | Regression + SAC |
| **`OP_PAR_MANDATORY_FIELDS`** | Mandatory Field List | Set of critical well metadata fields required to avoid parsing failure | Array | None | Subset of Domain Fields | `['wellName', 'startDepth', 'endDepth', 'depthUnit']` | Domain Configuration | Stage 4 | Regression + SAC |
| **`OP_CON_W_NAME`** | Well Name Weight | Weight coefficient for well name confidence in composite synthesis | Float | Ratio | `[0.00, 1.00]` | `0.40` | Scientific Threshold | Stage 5 | Regression + SAC |
| **`OP_CON_W_DEPTH`** | Depths Weight | Weight coefficient for start/end depths in composite synthesis | Float | Ratio | `[0.00, 1.00]` | `0.40` | Scientific Threshold | Stage 5 | Regression + SAC |
| **`OP_CON_W_SCALE`** | Scale Ratio Weight | Weight coefficient for scale ratio in composite synthesis | Float | Ratio | `[0.00, 1.00]` | `0.20` | Scientific Threshold | Stage 5 | Regression + SAC |
| **`OP_CON_COMP_THRES`**| Min Composite Confidence | Minimum acceptable confidence for successful pipeline verification | Float | Ratio | `[0.00, 1.00]` | `0.65` | Scientific Threshold | Stage 5 | Regression + SAC |
| **`OP_VAL_MAX_DEPTH`** | Maximum Depth Boundary | Physical limit bounding the bottom depth of any logging run | Float | Feet | `[100, 50000]`| `30000`| Scientific Threshold | Stage 6 | Regression + SAC |
| **`OP_VAL_MIN_DEPTH`** | Minimum Depth Boundary | Physical limit bounding the starting depth of any logging run | Float | Feet | `[0, 1000]` | `0` | Scientific Threshold | Stage 6 | Regression + SAC |
| **`OP_VAL_DEPTH_UNITS`** | Supported Depth Units | List of allowed standard depth physical units | Array | None | Subset of `['m', 'ft']` | `['m', 'ft']` | Domain Configuration | Stage 6 | Regression + SAC |
| **`OP_VAL_SCALE_RATIOS`**| Allowed Scale Ratios | Set of valid spatial mapping scale patterns for calibration | Array | None | Subset of Standard Mappings| `['1:100', '1:200', '1:500', '1:1000', '1:1200']` | Domain Configuration | Stage 6 | Regression + SAC |
| **`OP_VAL_DATE_FORMATS`**| Supported Date Formats| Valid date syntax schemas parsed into ISO format | Array | None | Subset of standard date masks | `['YYYY-MM-DD', 'YYYY/MM/DD', 'DD-MM-YYYY', 'DD/MM/YYYY']` | Domain Configuration | Stage 6 | Regression + SAC |
| **`OP_WRK_MAX_MEM`** | Max Worker Memory | Memory budget allocated per isolated Web Worker runtime instance | Integer | MB | `[32, 512]` | `128` | Engineering Threshold | Workers | Regression + Benchmark |
| **`OP_WRK_POOL_SIZE`** | Worker Count Limit | Maximum concurrent background tasks allowed for recognition | Integer | Threads | `[1, 8]` | `4` | Engineering Threshold | Workers | Regression + Benchmark |
| **`OP_WRK_POOL_POLICY`**| Worker Pool Policy | Thread count calculation strategy | String | Enum | `{'static', 'dynamic'}` | `'dynamic'` | Engineering Threshold | Workers | Regression + Benchmark |

---

## 3. Stage 1: Header Localization Parameters

### 3.1 Parameters Extraction & Contextual Bindings
* **`OP_LOC_MAX_H_PCT` (Default: `0.25`)**: Bounds the search space of the projection profile. Physical well headers occupy the topmost region of the paper well log; searching beyond the top 25% height wastes memory and risks mistaking track grid lines for horizontal dividers.
* **`OP_LOC_GRAD_THRES` (Default: `0.15`)**: Controls edge sensitivity when detecting the divider line. Prevents low-contrast noise, scanlines, or paper creases from falsely triggering as structural boundary divisions.
* **`OP_LOC_SMOOTH_W` (Default: `15` px)**: Smooths spatial noise in the horizontal projection profile. A 15-pixel window filters scanning shadows, dirt speckles, and individual text lines, exposing the global transition envelope.
* **`OP_LOC_DIV_STRENGTH` (Default: `0.40`)**: Filters weak peaks. The transition boundary is marked by a prominent black grid-header boundary; any line candidates displaying a profile change of less than 0.40 are discarded.
* **`OP_LOC_CONF_THRES` (Default: `0.70`)**: The minimum localization confidence required. If the best found dividing line fails to meet 0.70 confidence, the engine triggers a `FAILURE_HEADER_NOT_FOUND` state (see `OCR_ERROR_SPEC_v1.md`).

---

## 4. Stage 2: Text Region Detection Parameters

### 4.1 Parameters Extraction & Contextual Bindings
* **`OP_DET_KERN_W` (Default: `60` px)**: Width of horizontal dilation. Since text line elements are read left-to-right, 60px grouping merges individual characters and adjacent words into coherent text blocks while preserving multi-column margins.
* **`OP_DET_KERN_H` (Default: `3` px)**: Height of vertical dilation. Restricting dilation to 3px prevents separate rows from merging vertically, preserving spatial isolation between lines.
* **`OP_DET_OVERLAP_TOL` (Default: `0.10`)**: The bounding box intersection-over-union (IoU) limit. If two detected regions overlap by more than 10%, they are unified into a single line to account for skewed character rows.
* **`OP_DET_MIN_AREA` (Default: `150` px²)**: Prunes small artifacts. Bounding blocks smaller than 150 square pixels (e.g., speckles of dust, coffee stains, isolated scan artifacts) are immediately filtered.
* **`OP_DET_NOISE_REJ` (Default: `0.12`)**: Prunes thin horizontal or vertical scanning rules. Bounding boxes displaying an aspect ratio or pixel density outer bounds of less than 12% are ignored.

---

## 5. Stage 3: Recognition Adapter Parameters

### 5.1 Parameters Extraction & Contextual Bindings
* **`OP_REC_TIMEOUT` (Default: `10000` ms)**: The absolute execution ceiling. Character recognition should execute within seconds; if a worker hangs or becomes unresponsive for more than 10 seconds, the pipeline is terminated with a `FAILURE_RECOGNITION_TIMEOUT` (see `OCR_ERROR_SPEC_v1.md`).
* **`OP_REC_MAX_RETRIES` (Default: `2`)**: Fault tolerance. If the underlying Web Worker or WASM sandbox fails, the orchestrator triggers up to 2 clean re-initializations before resolving to failure.
* **`OP_REC_POLL_INT` (Default: `100` ms)**: Polling interval. Regulates CPU consumption when monitoring the `AbortSignal` for cancellation requests, preventing thread starvation.
* **`OP_REC_MAX_REGIONS` (Default: `100`)**: Bounds input text segments to prevent heap crashes under degraded logs featuring thousands of non-text artifacts.

---

## 6. Stage 4: Scientific Parsing Parameters

### 6.1 Parameters Extraction & Contextual Bindings
* **`OP_PAR_REGEX_PRI` (Default: `'STRICT'`)**: Priority routing. `'STRICT'` enforces rigorous matching criteria first (e.g., standard ISO date formats or API-UWI formats) to avoid loose key-value mis-mapping on complex headers.
* **`OP_PAR_LEV_ACCEPT` (Default: `0.80`)**: Levenshtein similarity limit. Accepts OCR transcription errors (e.g., `"VVEL NANE"`, `"E1ELD"`) with up to 20% edit distance difference when mapping to known dictionary fields (e.g., `"WELL NAME"`, `"FIELD"`).
* **`OP_PAR_DICT_CONF` (Default: `1.15`)**: Multiplication boost factor. When fuzzy matching resolves to an exact dictionary hit, the corresponding token confidence is boosted by 1.15x (capped at 1.0) to prioritize structured terms over unstructured fragments.
* **`OP_PAR_MANDATORY_FIELDS` (Default: `['wellName', 'startDepth', 'endDepth', 'depthUnit']`)**: The set of critical attributes that must be successfully resolved from the unstructured text. If any element of this list remains unresolved (`null`) after parsing, the pipeline enters a validation rejection sequence.

---

## 7. Stage 5: Confidence Propagation Parameters

### 7.1 Parameters Extraction & Contextual Bindings and Normalization Constraints
* **`OP_CON_W_NAME` (Default: `0.40`)**, **`OP_CON_W_DEPTH` (Default: `0.40`)**, and **`OP_CON_W_SCALE` (Default: `0.20`)**: The critical field coefficients.
* **`OP_CON_COMP_THRES` (Default: `0.65`)**: The minimum composite score limit. If the synthesized confidence score falls below 65%, the run is rejected with a `FAILURE_VALIDATION_REJECTED` status to protect the Scientific Domain Model.

#### Formal Mathematical Constraints on Weight Normalization
To prevent mathematical drift or arbitrary inflation of confidence metrics, the weights utilized during composite confidence synthesis are strictly bound by the following formal validation rules:

$$\sum_{c \in \{name, depth, scale\}} w_c = \text{OP\_CON\_W\_NAME} + \text{OP\_CON\_W\_DEPTH} + \text{OP\_CON\_W\_SCALE} = 1.0$$

$$\forall c \in \{name, depth, scale\}, \quad w_c \ge 0$$

If either constraint is violated during execution, the propagation engine throws an immediate initialization exception, preventing corrupted composite confidence scores from being written to the metadata structures.

#### Formal Mathematical Expression for Confidence Boost
Let $\bar{C}_{rec}(f)$ be the raw optical character recognition score, $H_{match}$ the Levenshtein match factor, and $C_{roi}$ the parent region localization confidence. The field confidence $C_f$ is boosted by $B = \text{OP\_PAR\_DICT\_CONF}$ on exact dictionary matches:

$$C_f = \min\left(1.0, \, \bar{C}_{rec}(f) \times H_{match} \times C_{roi} \times B\right)$$

---

## 8. Stage 6: Domain Validation Parameters

### 8.1 Parameters Extraction & Contextual Bindings
* **`OP_VAL_DEPTH_UNITS` (Default: `['m', 'ft']`)**: Defines the physical units permitted during geological parsing. Any extracted unit outside of this array will trigger immediate validation rejection.
* **`OP_VAL_SCALE_RATIOS` (Default: `['1:100', '1:200', '1:500', '1:1000', '1:1200']`)**: Enforces physical scaling ratios commonly utilized on physical well logs.
* **`OP_VAL_DATE_FORMATS` (Default: `['YYYY-MM-DD', 'YYYY/MM/DD', 'DD-MM-YYYY', 'DD/MM/YYYY']`)**: Acceptable syntax formats mapped during ISO-8601 formatting checks. Note that `DD/MM/YYYY` is standard, while arbitrary date permutations outside this list are rejected.
* **`OP_VAL_MIN_DEPTH` (Default: `0` ft)** and **`OP_VAL_MAX_DEPTH` (Default: `30000` ft)**: Set physical safety bounds. Any parsed depths negative or exceeding 30,000 feet are scientifically invalid, violating physical boundary rules.

---

## 9. Worker Parameters

### 9.1 Background Execution Settings and Threading Formalization
* **`OP_WRK_MAX_MEM` (Default: `128` MB)**: Limits memory allocation per Web Worker instance. Prevents out-of-memory container thrashing under heavy concurrent processing load.
* **`OP_WRK_POOL_SIZE` (Default: `4` concurrent tasks)**: Bounds thread spawning. Allocates a maximum of 4 Web Workers, optimizing CPU core scheduling on modern client architectures.
* **`OP_WRK_POOL_POLICY` (Default: `'dynamic'`)**: Pool allocation behavior. Under `'dynamic'`, the worker size scales based on available logical cores up to `OP_WRK_POOL_SIZE`. Under `'static'`, the thread pool allocates exactly `OP_WRK_POOL_SIZE` threads regardless of system load.

#### Mathematical Definition of Thread Count Policy
Let $N_{threads}$ be the actual number of worker threads allocated, $\text{logicalCores}$ be the hardware thread capability returned by the browser or environment, and $P = \text{OP\_WRK\_POOL\_SIZE}$ be the configured worker limit. The threading formula is defined as:

$$N_{threads} = \begin{cases} P & \text{if } \text{OP\_WRK\_POOL\_POLICY} = \text{'static'} \\ \max(1, \min(\text{logicalCores}, P)) & \text{if } \text{OP\_WRK\_POOL\_POLICY} = \text{'dynamic'} \end{cases}$$

---

## 10. Parameter Classification

To ensure clear governance, every parameter is assigned to exactly one of the following classes. No parameter may belong to multiple classes.

```text
                                       ┌──────────────────────────────────────────────┐
                                       │            PARAMETER CLASSIFICATION          │
                                       └──────────────────────┬───────────────────────┘
          ┌────────────────────────────┼──────────────────────┴───────────────────────┼────────────────────────────┐
          ▼                            ▼                                              ▼                            ▼
┌───────────────────┐        ┌───────────────────┐                          ┌───────────────────┐        ┌───────────────────┐
│Scientific Thres.  │        │Engineering Thres. │                          │Operational Config │        │Domain Config.     │
│- OP_LOC_MAX_H_PCT │        │- OP_LOC_SMOOTH_W  │                          │- OP_REC_TIMEOUT   │        │- OP_VAL_DEPTH_UNIT│
│- OP_LOC_GRAD_THRES│        │- OP_DET_KERN_W    │                          │- OP_REC_MAX_RETRI │        │- OP_VAL_SCALE_RATI│
│- OP_VAL_MAX_DEPTH │        │- OP_WRK_MAX_MEM   │                          │- OP_PAR_REGEX_PRI │        │- OP_PAR_MANDATORY │
└───────────────────┘        └───────────────────┘                          └───────────────────┘        └───────────────────┘
```

### 10.1 Mathematical Constants
* **Empty / None**: There are no custom configurable parameter inputs belonging to this class in v1.0. All mathematical constants used by the algorithms (e.g., Euler's number $e$, Pi $\pi$, and algebraic coefficients of geometric derivations) are fixed mathematical identities and cannot be configured or overridden.

### 10.2 Scientific Thresholds (Controlled by SVB, triggers SAC rerun)
* `OP_LOC_MAX_H_PCT`
* `OP_LOC_GRAD_THRES`
* `OP_LOC_DIV_STRENGTH`
* `OP_LOC_CONF_THRES`
* `OP_PAR_LEV_ACCEPT`
* `OP_PAR_DICT_CONF`
* `OP_CON_W_NAME`
* `OP_CON_W_DEPTH`
* `OP_CON_W_SCALE`
* `OP_CON_COMP_THRES`
* `OP_VAL_MAX_DEPTH`
* `OP_VAL_MIN_DEPTH`

### 10.3 Engineering Thresholds (Governed by Tech Lead, triggers regression & benchmark)
* `OP_LOC_SMOOTH_W`
* `OP_DET_KERN_W`
* `OP_DET_KERN_H`
* `OP_DET_OVERLAP_TOL`
* `OP_DET_MIN_AREA`
* `OP_DET_NOISE_REJ`
* `OP_REC_MAX_REGIONS`
* `OP_WRK_MAX_MEM`
* `OP_WRK_POOL_SIZE`
* `OP_WRK_POOL_POLICY`

### 10.4 Operational Configurations (Adjustable for deployments, triggers regression tests)
* `OP_REC_TIMEOUT`
* `OP_REC_MAX_RETRIES`
* `OP_REC_POLL_INT`
* `OP_PAR_REGEX_PRI`

### 10.5 Domain Configurations (Governed by Domain Experts, triggers SAC rerun)
* `OP_PAR_MANDATORY_FIELDS`
* `OP_VAL_DEPTH_UNITS`
* `OP_VAL_SCALE_RATIOS`
* `OP_VAL_DATE_FORMATS`

---

## 11. Parameter Dependency Matrix

This matrix maps each parameter to the algorithmic stage it directly influences, its affected output, and its downstream cross-stage consequences:

| Parameter ID | Direct Algorithm Stage | Affected Output Artifact | Downstream Cross-Stage Impact |
| :--- | :--- | :--- | :--- |
| **`OP_LOC_MAX_H_PCT`** | Stage 1: Localization | ROI vertical bounds ($y_{div}$) | Limits binarization mask size in Stage 2; cuts noise in Stage 3 |
| **`OP_LOC_GRAD_THRES`** | Stage 1: Localization | Divider line coordinates | Direct coordinates feed to cropping boundary in Stage 2 |
| **`OP_LOC_SMOOTH_W`** | Stage 1: Localization | Moving average profile data | Prevents high-frequency grid noises from leaking into Stage 2 |
| **`OP_LOC_DIV_STRENGTH`**| Stage 1: Localization | Peak gradient valid flags | Prevents empty localization processing in subsequent stages |
| **`OP_LOC_CONF_THRES`**  | Stage 1: Localization | Region validation outcome | Propagates $C_{roi}$ score into Stage 5 composite confidence |
| **`OP_DET_KERN_W`** | Stage 2: Detection | Line bounding box width | Controls token horizontal grouping boundaries in Stage 3 |
| **`OP_DET_KERN_H`** | Stage 2: Detection | Text line vertical separation | Keeps multi-line groupings distinct, feeding correct order into Stage 3 |
| **`OP_DET_OVERLAP_TOL`** | Stage 2: Detection | Integrated multi-word bounding boxes | Prevents double token recognition in Stage 3 |
| **`OP_DET_MIN_AREA`** | Stage 2: Detection | Noise-filtered row array | Reduces token load overhead on the Web Workers in Stage 3 |
| **`OP_DET_NOISE_REJ`** | Stage 2: Detection | Grid-line filtered bounding boxes | Reduces false positive background text lines in Stage 3 |
| **`OP_REC_TIMEOUT`** | Stage 3: Recognition | Worker thread control state | Truncates processing early, preventing Stage 4 initialization |
| **`OP_REC_MAX_RETRIES`** | Stage 3: Recognition | Thread crash recovery state | Directly delays overall pipeline latency through restarts |
| **`OP_REC_POLL_INT`** | Stage 3: Recognition | Cancellation validation loop | Determines main-thread feedback interval for user abort requests |
| **`OP_REC_MAX_REGIONS`** | Stage 3: Recognition | Thread task scheduling list | Caps total input load, safeguarding heap space for parsing |
| **`OP_PAR_REGEX_PRI`** | Stage 4: Parsing | Domain key-value associations | Impacts dictionary matching efficiency in Stage 5 confidence scoring |
| **`OP_PAR_LEV_ACCEPT`** | Stage 4: Parsing | Transcribed well log text pairs | Formulates fuzzy matching quality factor in Stage 5 confidence scoring |
| **`OP_PAR_DICT_CONF`** | Stage 4: Parsing | Dictionary hit scoring boost | Directly inflates or penalizes field-level score in Stage 5 |
| **`OP_PAR_MANDATORY_FIELDS`**| Stage 4: Parsing | Parsed domain metadata record | Determines immediate pipeline validation rejection in Stage 6 |
| **`OP_CON_W_NAME`** | Stage 5: Confidence | Composite confidence rating | Decides final import acceptance threshold in Stage 6 validation |
| **`OP_CON_W_DEPTH`** | Stage 5: Confidence | Composite confidence rating | Decides final import acceptance threshold in Stage 6 validation |
| **`OP_CON_W_SCALE`** | Stage 5: Confidence | Composite confidence rating | Decides final import acceptance threshold in Stage 6 validation |
| **`OP_CON_COMP_THRES`**| Stage 5: Confidence | Quality threshold approval flag | Dictates whether Workspace import command receives SUCCESS or REJECT |
| **`OP_VAL_MAX_DEPTH`** | Stage 6: Validation | Over-bounds depth status | Disqualifies physical well structure from being imported into SDM |
| **`OP_VAL_MIN_DEPTH`** | Stage 6: Validation | Under-bounds depth status | Disqualifies physical well structure from being imported into SDM |
| **`OP_VAL_DEPTH_UNITS`** | Stage 6: Validation | Metric verification status | Triggers unit scaling and correction workflows inside SDM |
| **`OP_VAL_SCALE_RATIOS`**| Stage 6: Validation | Calibration ratio validity | Sets standard calibration multiplier inside core Canvas display |
| **`OP_VAL_DATE_FORMATS`**| Stage 6: Validation | Standard date string formatting | Prevents corrupted timestamp indexes inside database storage |
| **`OP_WRK_MAX_MEM`** | Isolated Workers | Worker process memory footprint | Limits thread memory leaks from blocking parser execution |
| **`OP_WRK_POOL_SIZE`** | Isolated Workers | Worker thread concurrency limit | Caps total system thread footprint during pipeline run |
| **`OP_WRK_POOL_POLICY`**| Isolated Workers | Worker thread allocation strategy| Modulates resource utilization dynamically on limited core CPUs |

---

## 12. Change Policy

To guarantee strict scientific stability throughout development, any parameter modifications must conform to this change policy:

| Parameter Class | Modification Impact Level | Formal Verification Requirements | Versioning Impact | Approval Authority |
| :--- | :--- | :--- | :--- | :--- |
| **Scientific Thresholds** | High | Full regression suite, full Scientific Acceptance Criteria (SAC) validation suite, and golden-reference dataset comparisons | Minor/Major Version bump | Scientific Verification Board (SVB) |
| **Domain Configurations** | High | Full regression suite, full Scientific Acceptance Criteria (SAC) validation suite | Minor/Major Version bump | Scientific Verification Board (SVB) / Domain Lead |
| **Engineering Thresholds**| Medium | Standard regression suite, resource-utilization benchmarking, and worker thread concurrency testing | Patch Version bump | Technical Lead / Chief Architect |
| **Operational Configs** | Low | Local integration tests and quick environment verification checks | No version bump | Release Engineer |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
