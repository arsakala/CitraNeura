# OCR Logging & Telemetry Specification v1.0 (OCR-LOG-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Logging Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Logging & Telemetry Specification v1.0 (OCR-LOG-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the formal JSON formatting, severity levels, correlation keys, and structural schemas for all operational events emitted by the OCR subsystem.

Standardized structured logging is vital for:
* Observing background thread execution and identifying bottlenecks.
* Tracking failure metrics in production without compromising user data privacy.
* Re-routing errors from sandboxed Web Workers directly to the main thread debugger.

---

## 2. Global Event Log Schema

All log messages emitted by any pipeline stage must conform strictly to the following JSON structure:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "OCRStructuredEventLog",
  "type": "object",
  "required": ["timestamp", "executionId", "severity", "stage", "eventCode", "message"],
  "properties": {
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "High-precision UTC ISO-8601 timestamp of the event."
    },
    "executionId": {
      "type": "string",
      "format": "uuid",
      "description": "Correlation ID linking all events belonging to a single pipeline execution run."
    },
    "severity": {
      "type": "string",
      "enum": ["DEBUG", "INFO", "WARNING", "ERROR", "FATAL"]
    },
    "stage": {
      "type": "string",
      "enum": ["INITIALIZATION", "LOCALIZATION", "DETECTION", "RECOGNITION", "PARSING", "VALIDATION", "INGESTION"]
    },
    "eventCode": {
      "type": "string",
      "description": "Unique structured code identifying the event type (e.g., OCR_STG1_ROI_FOUND)."
    },
    "message": {
      "type": "string",
      "description": "Human-readable description of the log event."
    },
    "metadata": {
      "type": "object",
      "description": "Key-value schema-controlled attributes specific to the event code. MUST NOT contain raw image pixels or decrypted sensitive credentials."
    }
  }
}
```

---

## 3. Severity Levels & Core Stage Events

The following severity matrices dictate how events are classified and captured:

### 3.1 Severity Definitions
* **`DEBUG`**: Diagnostic logs of low-level algorithms (e.g., projection moving average window results).
* **`INFO`**: High-level milestones (e.g., stage start, worker initialization, success states).
* **`WARNING`**: Non-blocking anomalies (e.g., Levenshtein fuzzy match below balanced thresholds, unmapped fields, missing optional properties).
* **`ERROR`**: Blocking stage failures. The pipeline execution is truncated, but resources are gracefully cleared.
* **`FATAL`**: Severe application crashes (e.g., out of memory, web worker thread pool unresponsiveness).

### 3.2 Formal Pipeline Event Registry

| Event Code | Stage | Severity | Message Template | Metadata Schema |
| :--- | :--- | :--- | :--- | :--- |
| **`OCR_STG0_START`** | INITIALIZATION | INFO | "OCR pipeline execution started." | `{"expectedDPI": number, "languages": string[]}` |
| **`OCR_STG1_ROI_FOUND`** | LOCALIZATION | INFO | "Header ROI located successfully." | `{"y_div": number, "confidence": number}` |
| **`OCR_STG2_TEXT_FOUND`** | DETECTION | INFO | "Text rows detected in ROI." | `{"regionCount": number, "elapsedMs": number}` |
| **`OCR_STG3_WRK_SPAWN`** | RECOGNITION | DEBUG | "Web Worker thread spawned." | `{"workerId": string, "threadIndex": number}` |
| **`OCR_STG3_REC_DONE`** | RECOGNITION | INFO | "Glyph recognition completed." | `{"tokenCount": number, "elapsedMs": number}` |
| **`OCR_STG4_PAR_DONE`** | PARSING | INFO | "Scientific metadata parsing completed."| `{"mappedFieldCount": number, "unmappedFieldCount": number}` |
| **`OCR_STG6_VAL_PASS`** | VALIDATION | INFO | "Scientific domain validation passed." | `{"compositeConfidence": number, "elapsedMs": number}` |
| **`OCR_STG6_VAL_FAIL`** | VALIDATION | ERROR | "Scientific domain validation failed." | `{"errors": string[], "compositeConfidence": number}` |

---

## 4. Privacy & Telemetry Guardrails

To prevent data leakage of confidential petroleum exploration and logging information:
1. **Raw Pixel Ban**: No raw image pixel vectors, cropped sub-images, or binary pixel arrays may be appended to logging metadata.
2. **Path Sanitization**: Local system directory paths or temporary database keys must be stripped from all logs before writing to telemetry.
3. **Traceability Only**: Log payloads must focus strictly on layout density, parsing confidence, word counts, and stage execution latencies.

---

## 5. Verification Matrix

| Test Case ID | Event Trigger Scenario | Expected Output Log Format |
| :--- | :--- | :--- |
| **TC-LOG-701** | Standard pipeline start | Emits event `OCR_STG0_START` with valid UUID correlation key. |
| **TC-LOG-702** | Validation rejection | Emits `OCR_STG6_VAL_FAIL` with severity `ERROR`, appending list of errors to metadata. |
| **TC-LOG-703** | Web Worker crash | Emits `OCR_STG3_WRK_CRASH` with severity `FATAL` to trigger fallback deallocator. |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
