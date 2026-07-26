# OCR Error Specification v1.0 (OCR-ERR-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Error Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Error Governance & Classification

This document establishes the official **OCR Error Specification v1.0 (OCR-ERR-01)**. In alignment with our **Type-Triggered System Design (TTSD)** paradigm, all failure states resolving from the stateless OCR execution pipeline are standardized as deterministic error codes.

Each failure code is fully defined with severity levels, operational retryability status, localized user messages, internal debug descriptions, and concrete recovery workflows.

### 1.1 Severity Classifications
* **FATAL**: The pipeline execution is permanently aborted. The system cannot proceed, and local memory or state is preserved without modification.
* **WARNING**: Non-terminating alerts indicating potential degraded quality, minor parse gaps, or out-of-boundary anomalies. The pipeline proceeds to completion.

---

## 2. Master Error Registry

The following registry is the sole source of truth for all pipeline failure states:

| Error Code | Stage | Severity | Retryable | User-Facing Message | Internal Diagnostic Message | Recovery Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`FAILURE_HEADER_NOT_FOUND`** | Stage 1 | FATAL | No | "Gagal mendeteksi kop kertas log (Header ROI). Pastikan berkas pindaian Anda memiliki kop yang terlihat jelas di bagian atas." | Peak division line gradient $y_{div} > \text{OP\_LOC\_MAX\_H\_PCT} \times H$ or localization confidence $C_{roi} < \text{OP\_LOC\_CONF\_THRES}$. | Prompt user to manually crop the header region or adjust file contrast. |
| **`FAILURE_TEXT_REGION_EMPTY`** | Stage 2 | FATAL | No | "Kop log berhasil dideteksi, namun tidak ditemukan teks di dalamnya." | Connected-component analysis yielded zero text block regions ($N = 0$) inside the cropped ROI bounding box. | Verify image is not completely blank or excessively dark. Adjust binarization thresholds. |
| **`FAILURE_RECOGNITION_TIMEOUT`** | Stage 3 | FATAL | Yes | "Proses pengenalan teks melebihi batas waktu yang ditentukan. Silakan coba kembali." | Web Worker execution duration exceeded $\text{OP\_REC\_TIMEOUT}$ milliseconds before returning transcription. | Retry the execution block. If failure persists, lower $\text{OP\_REC\_MAX\_REGIONS}$. |
| **`FAILURE_RECOGNITION_FAILED`** | Stage 3 | FATAL | Yes | "Terjadi kegagalan sistem saat mengenali karakter teks log." | Web Worker environment crashed, WASM thread panicked, or internal engine initialization failed. | Re-initialize the Web Worker context. Max retries defined by $\text{OP\_REC\_MAX\_RETRIES}$. |
| **`FAILURE_PARSING_UNSTRUCTURED`** | Stage 4 | FATAL | No | "Gagal mengekstrak data terstruktur log dari teks yang dibaca." | Mandatory fields specified in `OP_PAR_MANDATORY_FIELDS` parsed as `null` after evaluating hierarchical regular expressions. | Ensure the well log header contains readable well name and depth details. |
| **`FAILURE_VALIDATION_REJECTED`** | Stage 6 | FATAL | No | "Log berhasil diproses tetapi data tidak lulus validasi ilmiah." | Scientific validator resolved `isValid: false` due to physical boundary violations or composite confidence $C_{composite} < \text{OP\_CON\_COMP\_THRES}$. | Check logical depth bounds (depth bottom must be greater than start depth) and physical unit types. |

---

## 3. Propagation & UI Interaction Contract

1. **Deterministic Error Matching**: When the orchestrator returns a non-SUCCESS status, it **must** map the resulting status string strictly to one of the six frozen codes in Section 2.
2. **Telemetry Safety**: High-precision stack traces or raw adapter exception details are strictly confined to the **Internal Diagnostic Message** log payload, protecting the user-facing interface from implementation leakage.
3. **Recovery Redirection**: The core application UI components leverage the **Recovery Recommendation** metadata to dynamically toggle specific fallback controls (such as opening the manual correction panel or suggesting a target DPI adjustment).

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
