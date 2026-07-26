# OCR Dataset Governance & Test Specification v1.0 (OCR-DATASET-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Dataset Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Dataset Governance & Test Specification v1.0 (OCR-DATASET-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the classification, structures, management, and verification rules for all test datasets used to evaluate the CitraNeura OCR subsystem.

In scientific software engineering, the reliability of validation metrics depends entirely on the integrity of the test datasets. Allowing developers to edit reference datasets arbitrarily or evaluate algorithms on non-representative samples leads to metric inflation and regressions in production. This contract freezes the rules of dataset governance, ensuring absolute verification transparency.

---

## 2. Dataset Classifications

CitraNeura classifies its evaluation files into five distinct, isolated datasets. Each serve a unique testing concern:

```text
                     ┌──────────────────────────────────────────────┐
                     │            OCR DATASET GOVERNANCE            │
                     └──────────────────────┬───────────────────────┘
          ┌───────────────────────────┬─────┴─────┬───────────────────────────┐
          ▼                           ▼           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│  Golden Dataset   │       │ Benchmark Dataset │       │  Stress Dataset   │       │Synthetic/Regress. │
│- Pristine standard│       │- Operational SLA  │       │- Edge-case robustness     │- Programmatic /   │
│- Verifies Accuracy│       │  (RAM, CPU, ms)   │       │  (Skew, noise, ink)       │  accumulated bugs │
└───────────────────┘       └───────────────────┘       └───────────────────┘       └───────────────────┘
```

### 2.1 Golden Dataset
* **Purpose**: Verifies accuracy across standard, standard-compliant log layouts.
* **Content**: High-contrast, standard scans with pristine font typography and exact physical scale markers.
* **Ground-Truth**: 100% manually transcribed, double-blind checked by senior geologists.

### 2.2 Benchmark Dataset
* **Purpose**: Evaluates operational performance and resource utilization.
* **Content**: Large-resolution, multi-page raster feeds.
* **Target metrics**: Execution duration, peak heap allocation, thread utilization, frame blockage.

### 2.3 Stress Dataset
* **Purpose**: Tests the robustness and boundary limits of Stage 1 (Localization) and Stage 3 (Recognition).
* **Content**: Heavily degraded paper logs containing scanning artifacts, coffee stains, skew angles up to $45^{\circ}$, handwriting overlaps, faded ink, and complex multi-column structures.

### 2.4 Synthetic Dataset
* **Purpose**: Generates high-volume variations to verify parsing state machines (Stage 4).
* **Content**: Programmatically generated log headers using random parameter combinations (UWIs, depths, operators) overlaid on diverse background noise profiles.

### 2.5 Regression Dataset
* **Purpose**: Prevents regression of resolved bugs.
* **Content**: A growing historical repository of logs that previously triggered pipeline failures or validation rejections. Any resolved OCR bug must append its triggering log to this dataset.

---

## 3. Dataset Integrity & Version Control Rules

To prevent tampering or data degradation:

1. **Cryptographic Indexing**: Every file in the dataset must be indexed in a master manifest with its corresponding SHA-256 hash. If the computed file hash does not match the manifest, the validation suite must halt immediately, flagging a "DATASET_CORRUPTED" state.
2. **Access Control**: Developers possess read-only rights to the test datasets. Any modifications, additions, or deprecations of test files must be approved by the **Scientific Verification Board (SVB)** and released via formal version bumps.
3. **No Training Set Leakage**: Under no circumstance may any file in the Golden or Stress datasets be used during the parameter tuning, heuristic calibration, or neural-model training phases of the Recognition Adapters.

---

## 4. Verification Matrix

| Test Case ID | Dataset Category | Mandatory Metrics | Target SLA / Pass Condition |
| :--- | :--- | :--- | :--- |
| **TC-DATA-901** | Golden Dataset | `Character Error Rate (CER)` | Must remain $\le 1.0\%$. |
| **TC-DATA-902** | Benchmark Dataset | `Peak Memory Overhead` | Must remain under $120\text{ MB}$. |
| **TC-DATA-903** | Stress Dataset | `Header Localization Success` | `IoU` must remain $\ge 0.85$ despite $45^{\circ}$ skew. |
| **TC-DATA-904** | Regression Dataset | `Cumulative Bug Pass Rate` | Must be exactly $100\%$ (zero regressions allowed). |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
