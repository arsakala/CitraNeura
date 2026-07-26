# OCR Confidence System Specification v1.0 (OCR-CONFIDENCE-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Confidence Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Confidence System Specification v1.0 (OCR-CONFIDENCE-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the formal data structures, propagation equations, and evaluation rules for all confidence metrics within the OCR pipeline.

Rather than relying on opaque, single-number percentage scores typical of consumer OCR engines, CitraNeura utilizes a mathematically transparent confidence propagation framework. This allows developers and geologists to decompose any low confidence rating into its raw sources (optical, spatial, or semantic), making pipeline debugging deterministic and reliable.

---

## 2. Confidence Data Models

To ensure comprehensive auditability, confidence calculations are structured as nested, strongly typed records, rather than flat arrays or loosely structured key-value pairs.

```typescript
export interface FieldConfidenceBreakdown {
  /** The specific metadata field being measured (e.g., "wellName", "startDepth") */
  fieldName: string;
  
  /** Raw geometric mean of character/token glyph certainties from Stage 3, in [0.0, 1.0] */
  rawOpticalConfidence: number;

  /** Levenshtein semantic matching distance factor against references, in [0.0, 1.0] */
  semanticMatchFactor: number;

  /** Localization certainty score of the parent well header region, in [0.0, 1.0] */
  roiLocalizationConfidence: number;

  /** Multiplicative bonus factor applied for exact dictionary match, e.g., OP_PAR_DICT_CONF */
  dictionaryBoostApplied: number;

  /** The synthesized, clamped field confidence score, in [0.0, 1.0] */
  finalFieldConfidence: number;
}

export interface PipelineConfidenceRecord {
  /** Map of individual scientific metadata fields to their detailed breakdowns */
  fieldBreakdowns: Record<string, FieldConfidenceBreakdown>;

  /** Synthesized composite confidence score across critical fields, in [0.0, 1.0] */
  compositeConfidence: number;

  /** Boolean indicating if compositeConfidence meets or exceeds OP_CON_COMP_THRES */
  minimumConfidenceMet: boolean;

  /** The exact OP_CON_COMP_THRES threshold utilized during this verification run */
  thresholdUsed: number;
}
```

---

## 3. Mathematical Propagation Stages

Confidence values propagate through three sequential, deterministic processing phases:

### Phase 1: Optical Token Geometric Mean
For any parsed field $f$ containing a sequence of $n$ recognized text tokens, the optical certainty $\bar{C}_{rec}(f)$ is calculated using the geometric mean. The geometric mean is mathematically superior to the arithmetic mean for multi-token confidence as it penalizes single-token failures severely (a single $0.0$ token correctly collapses the entire sequence score to $0.0$):

$$\bar{C}_{rec}(f) = \begin{cases} 0.0 & \text{if } n = 0 \\ \left( \prod_{i=1}^{n} \text{token}_i.\text{confidence} \right)^{\frac{1}{n}} & \text{if } n > 0 \end{cases}$$

### Phase 2: Field-Level Integration & Clamp
The combined confidence score of an individual metadata field $C_f$ synthesizes layout localization certainty $C_{roi}$, character transcription certainty $\bar{C}_{rec}(f)$, semantic match distance $H_{match}$, and dictionary boost parameters. To prevent values from exceeding $1.0$ when dictionary boosts are active, an explicit bounding clamp is applied:

$$C_f = \min\left(1.0, \, \bar{C}_{rec}(f) \times H_{match} \times C_{roi} \times B\right)$$

Where:
* $H_{match}$ is the Levenshtein distance match factor, in $[0.0, 1.0]$.
* $C_{roi}$ is the localization score of the parent Header region.
* $B$ is the dictionary boost factor parameter `OP_PAR_DICT_CONF` (default: `1.15`) if the match is an exact dictionary hit, else `1.0`.

### Phase 3: Composite Pipeline Synthesis
The final pipeline validation confidence $C_{composite}$ represents the weighted arithmetic average of critical scientific fields:

$$C_{composite} = w_{wellName} C_{wellName} + w_{depths} C_{depths} + w_{scaleRatio} C_{scaleRatio}$$

Subject to the strict normalization rules enforced in `OCR_PARAMETER_SPEC_v1.md`:

$$\sum w_c = \text{OP\_CON\_W\_NAME} + \text{OP\_CON\_W\_DEPTH} + \text{OP\_CON\_W\_SCALE} = 1.0 \quad \text{and} \quad \forall w_c \ge 0$$

---

## 4. Debugging & Diagnostic Diagnostics

The explicit breakdown allows engineers to instantly isolate failure modes in production:

* **Case A: High Optical, Low Semantic (`rawOptical` = 0.95, `semanticMatch` = 0.20)**:
  Indicates excellent image scan quality, but the characters represent non-standard scientific names, or the Levenshtein dictionary lacks local region nomenclature.
* **Case B: Low Optical, High Semantic (`rawOptical` = 0.35, `semanticMatch` = 0.90)**:
  Indicates a heavily degraded, low-contrast, or blurred paper log where characters are difficult to read, but fuzzy dictionary matching successfully recovered the correct field metadata.
* **Case C: Low ROI Localization (`roiLocalization` = 0.40)**:
  Indicates that grid lines or noise on the log prevented clean header boundary segmentation, dragging down the reliability of all downstream stages regardless of optical quality.

---

## 5. Verification Matrix

| Test Case ID | Stage | Input Parameters | Expected Mathematical Output |
| :--- | :--- | :--- | :--- |
| **TC-CONF-601** | Phase 1 | Two tokens with certs `0.80` and `0.20` | Geometric mean resolves to exactly `0.40`. |
| **TC-CONF-602** | Phase 2 | $\bar{C}_{rec} = 0.90$, $H_{match} = 1.0$, $C_{roi} = 1.0$, $B = 1.15$ | Field confidence $C_f$ is clamped to exactly `1.00`. |
| **TC-CONF-603** | Phase 3 | $C_{wellName} = 0.8$, $C_{depths} = 0.9$, $C_{scale} = 0.5$ | $C_{composite} = (0.4 \times 0.8) + (0.4 \times 0.9) + (0.2 \times 0.5) = 0.78$. |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
