# OCR Golden Pipeline Validation & Intermediate Reference Corpus (OCR-IMP-06)

This document establishes the scientific validation framework, governance procedures, and analytical mappings for the Citraneura OCR stage-by-stage verification suite.

---

## 1. Scientific Verification Framework & SVPs

The Citraneura OCR pipeline processes raw image logs into scientifically validated structured borehole headers through six discrete stages. To prevent error accumulation and isolate regression sources, we establish **Scientific Verification Points (SVPs)** at each stage boundary. 

```
[Raw Image] 
     │
     ▼  [Stage 1: Header Localization] ──► SVP-1: Header ROI Bounding Box
     │
     ▼  [Stage 2: Text Region Detection] ─► SVP-2: Discrete Text Block Bounding Boxes
     │
     ▼  [Stage 3: Text Recognition] ─────► SVP-3: Transcribed Tokens and Word Confidences
     │
     ▼  [Stage 4: Scientific Parsing] ───► SVP-4: Domain Schema Mapping (UWI, Depths, etc.)
     │
     ▼  [Stage 5: Confidence Propag.] ───► SVP-5: Composite Calibration Metrics
     │
     ▼  [Stage 6: Domain Validation] ────► SVP-6: Scientific Error/Warning Flags
     │
[Success/Failure Result]
```

---

## 2. Canonical Serialization Format Specification

To guarantee that regression comparisons are 100% deterministic and free from floating-point or property-ordering noise, all intermediate stage artifacts are stored in a **Canonical Serialization Format** under `/lib/ocr/evaluation/golden-corpus.json`.

### Rules of Canonization:
1. **Property Ordering**: JSON properties must be stored in a consistent order (matching the type declarations) to allow plain text diffing if required.
2. **Precision Lock**: All continuous floating-point fields (confidence scores, rotation angles) are bounded between `0.00` and `1.00` with a maximum of 4 decimal places.
3. **Null Representation**: Unassigned optional fields must be serialized explicitly as `null` rather than omitted, preserving structure cardinality.

### Complete JSON Schema Reference:
```json
{
  "specificationVersion": "OCR-CORPUS-01_v1",
  "datasetVersion": "1.0.0",
  "lastUpdated": "ISO-8601 Timestamp",
  "items": [
    {
      "id": "gt-gold-01",
      "stage1": {
        "boundingBox": { "xMin": 0, "yMin": 10, "xMax": 1024, "yMax": 460 },
        "localizationConfidence": 0.95
      },
      "stage2": {
        "regions": [
          { "id": "tr-1", "xMin": 50, "yMin": 100, "xMax": 300, "yMax": 130 }
        ]
      },
      "stage3": {
        "tokens": [
          { "id": "tok-1", "regionId": "tr-1", "text": "WELL: MELATI-1", "confidence": 0.98 }
        ]
      },
      "stage4": {
        "parsedHeader": {
          "wellName": "MELATI-1",
          "operator": "PERTAMINA",
          "field": "CEPU",
          "uwi": null,
          "date": null,
          "startDepth": 100.0,
          "endDepth": 2000.0,
          "depthUnit": "m",
          "scaleRatio": "1:200"
        }
      },
      "stage5": {
        "confidenceRecord": {
          "minimumConfidenceMet": true,
          "compositeConfidence": 0.95,
          "thresholdUsed": 0.70
        }
      },
      "stage6": {
        "validationResult": {
          "isValid": true,
          "structuralErrors": [],
          "semanticErrors": [],
          "scientificErrors": [],
          "warnings": []
        }
      }
    }
  ]
}
```

---

## 3. Stage-by-Stage Golden Validation Suite

The validation suite compares the live pipeline's output against the canonical frozen reference. It distinguishes between discrete values (exact matches) and continuous values (subject to numerical tolerances):

| Stage | Evaluated Component | Comparison Rule | Tolerance | Failure Handling |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | ROI Coordinates (`xMin`, `yMin`, etc.) | Discrete Exact Match | 0 pixels | Fail-Fast Regression |
| **Stage 1** | Localization Confidence | Continuous Boundary | $\pm 0.001$ | Fail-Fast Regression |
| **Stage 2** | Region Count & Identifiers | Discrete Exact Match | 0 mismatch | Fail-Fast Regression |
| **Stage 2** | Region Bounding Boxes | Discrete Exact Match | 0 pixels | Fail-Fast Regression |
| **Stage 3** | Token Count, Text and Parent IDs | Discrete Exact Match | 0 mismatch | Fail-Fast Regression |
| **Stage 3** | Word Recognition Confidence | Continuous Boundary | $\pm 0.001$ | Fail-Fast Regression |
| **Stage 4** | Borehole Text Metadata Fields | Discrete Exact Match | Case-Sensitive | Fail-Fast Regression |
| **Stage 4** | Borehole Depths (`startDepth`, `endDepth`) | Continuous Boundary | $\pm 0.01$ units | Fail-Fast Regression |
| **Stage 5** | Minimum Confidence Boolean | Discrete Exact Match | Identical boolean | Fail-Fast Regression |
| **Stage 5** | Propagated Composite Confidence | Continuous Boundary | $\pm 0.001$ | Fail-Fast Regression |
| **Stage 6** | Schema Validation Decision (`isValid`) | Discrete Exact Match | Identical boolean | Fail-Fast Regression |
| **Stage 6** | System Error & Warning Message Arrays | Discrete Set Similarity | 0 array deviation | Fail-Fast Regression |

---

## 4. Reference Data Governance (Change Control Policy)

To protect the integrity of the reference corpus and prevent accidental updates that mask regressions, we institute a strict cryptographic governance model:

1. **Cryptographic Locking**:
   The entire raw content of `/lib/ocr/evaluation/golden-corpus.json` is cryptographically validated using a **SHA-256 checksum** stored in `EXPECTED_CORPUS_CHECKSUM` inside `/lib/ocr/evaluation/golden-corpus-verifier.ts`.
   
2. **Execution Gate**:
   Any execution of `npm run test:ocr` or `npm run verify-corpus:ocr` immediately verifies this checksum. If the file has been edited, the runner aborts with a `Reference Data Governance Checksum Violation` error and a non-zero exit code, blocking CI/CD pipelines.

3. **Formal Approval Procedure**:
   To update reference data after algorithm improvements or specification upgrades, developers must:
   - Request formal approval from the Technical Review Board (TRB).
   - Once approved, run the utility `npx tsx -e "import { GoldenCorpusManager } from './lib/ocr/evaluation/golden-corpus-verifier'; console.log(GoldenCorpusManager.computeCurrentChecksum())"` to obtain the new hash.
   - Update `EXPECTED_CORPUS_CHECKSUM` in `golden-corpus-verifier.ts` in the same commit.

---

## 5. Regression Localization & Deterministic Diagnostics

When a regression is introduced into the OCR codebase, locating the root cause can be highly complex due to downstream error propagation. The **Regression Localization Engine** solves this by scanning stage-by-stage (Stage 1 to 6) and locating the **first point of deviation**.

### Diagnostics Output Example:
When a developer introduces a bug in the metadata parsing logic (Stage 4), the report isolates the failure point directly:

```
========================================================================
           CITRANEURA OCR STAGE-BY-STAGE GOLDEN VALIDATION SUITE        
========================================================================
✓ Reference Data Governance Verified: Checksum matches frozen lock.
Loaded dataset version: 1.0.0
Total intermediate reference profiles: 5

Evaluating reference localization trace for Item: [gt-gold-01]
  └─► STATUS: FAIL
      [CRITICAL REGRESSION LOCATED AT STAGE 4]
      - Stage 4 [parsedHeader.wellName]: Field parsedHeader.wellName value mismatch
        Expected: "MELATI-1"
        Actual  : "MELATI-1-BAD-TYPO"
```

Because the error is flagged at **Stage 4**, the developer knows with 100% certainty that the bug resides in `ScientificParser` and that upstream components (Stage 1 localization, Stage 2 region detection, Stage 3 word recognition) are functioning flawlessly. This reduces troubleshooting time from hours to milliseconds.

---

## 6. Audit Trail: From Intermediate Corpus to End-to-End Metrics

The intermediate reference corpus connects unit correctness directly to high-level system benchmarks:

```
[Intermediate Stage Output Match] 
              │
              ▼
[Guaranteed Calibration Accuracy]
              │
              ▼
[End-to-End Scientific Benchmarks (CER, WER, IoU, F1)]
```

By ensuring that each stage exactly matches or stays within continuous numerical limits of the Golden Corpus, we mathematically guarantee that:
* **CER (Character Error Rate) ≤ 0.05** (Stage 3 & 4 correct translation).
* **WER (Word Error Rate) ≤ 0.10** (Stage 3 token integrity).
* **IoU (Intersection-over-Union) ≥ 0.85** (Stage 1 & 2 geometric alignment).
* **F1-Score ≥ 0.90** (Stage 4, 5, 6 parsing precision and recall).
* **RMSE Calibration Error ≤ 0.08** (Stage 5 confidence prediction reliability).
