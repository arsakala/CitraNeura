# OCR Metadata and Provenance Specification v1.0 (OCR-METADATA-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Metadata & Provenance Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Metadata and Provenance Specification v1.0 (OCR-METADATA-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the formal structure of execution metadata, algorithmic traceability, and source data provenance.

In scientific software engineering, raw transcription is insufficient. We must be able to trace any digital metadata record back to:
* The exact source raster file.
* The processing version of the algorithm and parameter registry.
* The operational parameters (thread count, memory) and processing timings.
* The spatial boundaries and optical quality indicators.

This contract ensures complete auditable verification for geological records compiled inside the CitraNeura platform.

---

## 2. Provenance and Metadata Schema

Every successful pipeline execution must produce a `PipelineProvenance` block. This block must be appended to the output schema alongside the standard `ParsedHeader` before being committed to the database or Workspace store.

```typescript
export interface PipelineProvenance {
  /** Uniquely generated UUID identifying this specific OCR pipeline execution run */
  executionId: string;
  
  /** Timestamp of execution completion in standard ISO-8601 (UTC) */
  timestamp: string;

  /** Cryptographic SHA-256 hash of the input raw raster image data to establish provenance */
  sourceImageHash: string;

  /** The identifier string of the selected recognition engine adapter (e.g., "tesseract-js-v1") */
  adapterIdentifier: string;

  /** Active thread/worker count used during parallel recognition */
  workerCountAllocated: number;

  /** Total elapsed execution duration in milliseconds */
  elapsedTimeMs: number;

  /** Version identifier of the core OCR algorithm used (e.g., "OCR-ALG-01-v1.0") */
  algorithmVersion: string;

  /** Version identifier of the parameter specification used (e.g., "OCR-PARAM-01-v1.0") */
  parameterVersion: string;

  /** Total count of recognized word tokens extracted during Stage 3 */
  totalTokenCount: number;

  /** Cryptographic SHA-256 checksum of the generated ParsedHeader to verify post-parsing integrity */
  outputChecksum: string;

  /** Precise spatial crop boundaries of the localized Well Header */
  headerROI: {
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  };

  /** The unified list of non-blocking warning strings raised across the six pipeline stages */
  warnings: string[];
}
```

---

## 3. Cryptographic Provenance Constraints

To prevent data tampering or accidental modification of scientific records post-ingestion:

1. **`sourceImageHash` Generation**:
   The input raster image pixel buffer must be hashed using a deterministic cryptographic hashing algorithm (SHA-256) at Stage 1, before any layout processing is initiated:
   
   $$\text{sourceImageHash} = \text{SHA256}(\text{Uint8ClampedArray.buffer})$$

2. **`outputChecksum` Generation**:
   Upon successful validation in Stage 6, the resulting `ParsedHeader` fields (excluding dynamic confidence metrics) are serialized to a canonical JSON string and hashed to form the output integrity checksum:
   
   $$\text{outputChecksum} = \text{SHA256}(\text{CanonicalJSON}(\text{ParsedHeader}))$$

---

## 4. Metadata Integration Architecture

When metadata is committed, it is wrapped in an immutable container within the active Workspace store:

```typescript
export interface MetadataIngestionRecord {
  /** The final verified well header data */
  header: ParsedHeader;
  
  /** Complete audit trail of the extraction process */
  provenance: PipelineProvenance;
}
```

This ensures that any export of the digitized logs (such as exporting to LAS or JSON formats) can bundle the complete scientific provenance metadata, preserving the auditable heritage of the legacy data.

---

## 5. Verification Matrix

| Test Case ID | Stage | Evaluation Scenario | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **TC-META-401** | Stage 1 | Checksum of two identical image buffers | Returns identical `sourceImageHash` values. |
| **TC-META-402** | Stage 6 | Modification of a single parsed depth digit | Recomputed `outputChecksum` changes completely (avalanche effect). |
| **TC-META-403** | Ingest | Prov block missing dynamic execution UUID | Ingestion engine rejects record with a structural verification fault. |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
