# OCR Scientific Acceptance Criteria Specification v1.0 (OCR-SAC-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Scientific Acceptance Criteria Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Scientific Acceptance Criteria Specification v1.0 (OCR-SAC-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the formal metrics, algorithms, and targets required by the **CitraNeura Scientific Verification Board (SVB)** to validate and approve the OCR subsystem.

Unlike standard consumer software where "it seems to work" is sufficient, scientific geological workflows demand mathematically verifiable accuracy metrics. Any modification to core parsing algorithms (`OCR_ALG_v1.md`) or scientific parameter registries (`OCR_PARAM-01`) must pass the rigorous validation criteria defined herein before production deployment.

---

## 2. Scientific Evaluation Metrics

The accuracy of the OCR pipeline is quantified using five formal scientific metrics:

### 2.1 Character Error Rate (CER)
Measures raw character-level glyph transcription accuracy. It is calculated using the Levenshtein edit distance at the character level:

$$\text{CER} = \frac{S + D + I}{N}$$

Where:
* $S$ is the number of character substitutions.
* $D$ is the number of character deletions.
* $I$ is the number of character insertions.
* $N$ is the total number of characters in the ground-truth reference string.

### 2.2 Word Error Rate (WER)
Measures word-level transcription accuracy, penalizing word-splitting or merge faults:

$$\text{WER} = \frac{S_w + D_w + I_w}{N_w}$$

Where:
* $S_w, D_w, I_w$ are word-level substitutions, deletions, and insertions.
* $N_w$ is the total count of words in the ground-truth reference string.

### 2.3 Intersection-over-Union (IoU)
Quantifies layout segmentation accuracy for the localized `HeaderROI`:

$$\text{IoU} = \frac{|\text{ROI}_{pred} \cap \text{ROI}_{true}|}{|\text{ROI}_{pred} \cup \text{ROI}_{true}|}$$

Where:
* $\text{ROI}_{pred}$ is the bounding box predicted by Stage 1.
* $\text{ROI}_{true}$ is the manually verified ground-truth bounding box.

### 2.4 Field Extraction Accuracy (FEA)
The percentage of mandatory scientific well fields correctly extracted and mapped:

$$\text{FEA} = \frac{\text{Count of correctly parsed fields}}{\text{Total mandatory fields}} \times 100\%$$

### 2.5 Confidence Calibration RMSE (RMSE_C)
Measures the reliability of the confidence propagation engine, ensuring synthesized confidence correlates with real transcription accuracy:

$$\text{RMSE}_C = \sqrt{\frac{1}{M} \sum_{k=1}^{M} (C_{composite, k} - \text{Accuracy}_k)^2}$$

Where $\text{Accuracy}_k = 1.0 - \text{WER}_k$, and $M$ is the evaluation dataset size.

---

## 3. Tier-Based Acceptance Targets

To achieve official scientific certification, the pipeline must meet the following performance bounds across our standardized test sets:

| Metric | Target (Tier A: Clean Scans) | Target (Tier B: Historic/Degraded Paper Logs) | Target (Tier C: High-Stress Scans) |
| :--- | :--- | :--- | :--- |
| **`Header IoU`** | $\ge 0.98$ | $\ge 0.92$ | $\ge 0.85$ |
| **`Character Error Rate (CER)`**| $\le 1.0\%$ | $\le 4.5\%$ | $\le 10.0\%$ |
| **`Word Error Rate (WER)`** | $\le 2.0\%$ | $\le 8.0\%$ | $\le 15.00\%$ |
| **`Field Extraction Accuracy (FEA)`**| $\ge 99.0\%$ | $\ge 92.0\%$ | $\ge 85.0\%$ |
| **`Confidence Calibration RMSE`** | $\le 0.05$ | $\le 0.08$ | $\le 0.12$ |

---

## 4. Verification Protocol

The Scientific Verification Board executes validations under a strict, non-human-biased protocol:

1. **Ground-Truth Preservation**: Golden and benchmark reference datasets are locked and inaccessible to the active production pipelines.
2. **Automated Rerun Trigger**:
   * Any change to **Scientific Thresholds** requires automated rerunning of the complete Tier A, B, and C test suites.
   * If any metric drops below the defined acceptance threshold, the build is blocked and flagged as "SCIENTIFIC_REJECTED".
3. **Statistical Reproducibility**: Run results must display a variance of $\sigma^2 \le 10^{-6}$ across multiple identical local hardware thread configurations to prevent non-deterministic multi-threading calculations from skewing scientific results.

---

## 5. Verification Matrix

| Test Case ID | Stage | Evaluation Scenario | Expected Metric Resolution |
| :--- | :--- | :--- | :--- |
| **TC-SAC-801** | Stage 1 | Locating Header on Tier A scan | `IoU` must exceed `0.98`. |
| **TC-SAC-802** | Stage 3 | Transcribing text on degraded historic scan | `CER` must remain below `4.5%`. |
| **TC-SAC-803** | Stage 5 | Evaluating Confidence RMSE on all tiers | `RMSE_C` must not exceed `0.08`. |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
