# OCR Pipeline State Machine Specification v1.0 (OCR-STATE-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (State Machine Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Pipeline State Machine Specification v1.0 (OCR-STATE-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this document defines the formal finite state machine (FSM) governing pipeline execution, transition triggers, and state invariant rules.

A structured state machine prevents race conditions, illegal states (e.g., executing structural parsing without character recognition), and memory leaks during execution, guaranteeing a deterministic lifecycle.

---

## 2. Pipeline Finite State Machine

The OCR pipeline flows through a sequential, non-skipping series of execution states, terminating either in a `Completed` success state or a descriptive `Failed` error state.

```text
       ┌───────────┐
       │   Idle    │
       └─────┬─────┘
             │ (startPipeline)
             ▼
       ┌───────────┐
       │  Loading  │
       └─────┬─────┘
             │ (workerReady)
             ▼
       ┌───────────┐
       │Localizing │──────────────────────────────────────┐
       └─────┬─────┘                                      │
             │ (headerFound)                              │
             ▼                                            │
       ┌───────────┐                                      │
       │ Detecting │──────────────────────────────────────┤
             │ (regionsFound)                             │
             ▼                                            │
       ┌───────────┐                                      │ (anyStageFailure / abort)
       │Recognizing│──────────────────────────────────────┤
             │ (tokensRecognized)                         │
             ▼                                            │
       ┌───────────┐                                      │
       │  Parsing  │──────────────────────────────────────┤
             │ (parsedOk)                                 │
             ▼                                            │
       ┌───────────┐                                      │
       │Propagating│──────────────────────────────────────┤
             │ (scoresCalculated)                         │
             ▼                                            │
       ┌───────────┐                                      │
       │Validating │──────────────────────────────────────┘
       └─────┬─────┘
             ├──────────────────────┐
             │ (validationPassed)   │ (validationFailed)
             ▼                      ▼
       ┌───────────┐          ┌───────────┐
       │ Completed │          │  Failed   │
       └───────────┘          └───────────┘
```

---

## 3. Detailed State Definitions & Invariance Rules

The following table formally defines each state and its strict operational boundaries:

| State | Definition / Execution Stage | Invariance Rules (Must be true in this state) |
| :--- | :--- | :--- |
| **`Idle`** | Pipeline is uninitialized and awaiting user image selection. | No execution timers are active. Image pixel buffers are empty. |
| **`Loading`** | Thread pooling and worker environments are initializing. | Recognition engine resources are allocation-in-progress. `abortSignal` is active. |
| **`Localizing`** | Stage 1 (Header Localization) is actively scanning the log. | System is parsing the vertical intensity profile of the log. Bounding ROI is unset. |
| **`Detecting`** | Stage 2 (Text Region Detection) is processing the ROI. | `HeaderROI` is set and valid. Output text regions list is unallocated. |
| **`Recognizing`** | Stage 3 (Recognition Adapter) is transcribing text in parallel. | Text regions are detected and non-empty. Spelled characters are buffer-contained. |
| **`Parsing`** | Stage 4 (Scientific Parsing) is structuring raw tokens. | Word tokens list is set and non-empty. Structured domains are unmapped. |
| **`Propagating`**| Stage 5 (Confidence Propagation) is calculating metrics. | `ParsedHeader` contains populated fields. Composite confidence score is unset. |
| **`Validating`** | Stage 6 (Domain Validation) is testing domain boundaries. | All individual and composite confidence scores are calculated and bounded in `[0.0, 1.0]`. |
| **`Completed`** | Pipeline successfully executed. Output metadata is ready for Workspace ingestion. | Structured metadata is valid, approved, frozen, and ready for commands. |
| **`Failed`** | Execution aborted due to failure or cancellation. | Execution details and active error codes are frozen. Threads are released. |

---

## 4. Valid Transition Table

The state engine must strictly enforce that transitions only occur according to this deterministic schema. Any unlisted transition must trigger an immediate exception.

| Current State | Target State | Triggering Event | Postconditions |
| :--- | :--- | :--- | :--- |
| **`Idle`** | **`Loading`** | `startPipeline` | System allocates background workers. |
| **`Loading`** | **`Localizing`** | `workerReady` | Image is loaded into Stage 1 scan workspace. |
| **`Loading`** | **`Failed`** | `workerInitFailed` or `abort` | Error state is flagged with code `FAILURE_RECOGNITION_FAILED`. |
| **`Localizing`** | **`Detecting`** | `headerFound` | `HeaderROI` is populated and matches image bounds. |
| **`Localizing`** | **`Failed`** | `headerNotFound` or `abort` | Error state is flagged with code `FAILURE_HEADER_NOT_FOUND`. |
| **`Detecting`** | **`Recognizing`**| `regionsFound` | List of `DetectedText` regions contains $N > 0$ items. |
| **`Detecting`** | **`Failed`** | `regionsEmpty` or `abort` | Error state is flagged with code `FAILURE_TEXT_REGION_EMPTY`. |
| **`Recognizing`**| **`Parsing`** | `tokensRecognized` | List of `RecognizedToken` tokens is populated. |
| **`Recognizing`**| **`Failed`** | `recognitionFailed`, `timeout`, or `abort` | Error state is flagged with `FAILURE_RECOGNITION_FAILED` or `TIMEOUT`. |
| **`Parsing`** | **`Propagating`**| `parsedOk` | Structured `ParsedHeader` is instantiated. |
| **`Parsing`** | **`Failed`** | `parsingFailed` or `abort` | Error state is flagged with code `FAILURE_PARSING_UNSTRUCTURED`. |
| **`Propagating`**| **`Validating`** | `scoresCalculated` | All metric indices are generated and mapped. |
| **`Propagating`**| **`Failed`** | `propagationError` or `abort` | Error state is flagged with code `FAILURE_VALIDATION_REJECTED`. |
| **`Validating`** | **`Completed`** | `validationPassed` | Output data is approved. `ValidationResult.isValid` is `true`. |
| **`Validating`** | **`Failed`** | `validationFailed` or `abort` | Error state is flagged with code `FAILURE_VALIDATION_REJECTED`. |
| **`Completed`** | **`Idle`** | `reset` | Resources are cleared, returning system to baseline. |
| **`Failed`** | **`Idle`** | `reset` | Error records and thread pools are safely disposed and cleared. |

---

## 5. Verification Matrix

| Test Case ID | Initial State | Trigger Event | Expected Final State | Status |
| :--- | :--- | :--- | :--- | :---: |
| **TC-STATE-301** | `Idle` | `tokensRecognized` | Error Exception (Illegal Transition) | **PASS** |
| **TC-STATE-302** | `Recognizing` | `abort` | `Failed` (Clean worker termination) | **PASS** |
| **TC-STATE-303** | `Completed` | `startPipeline` | Error Exception (Must reset to Idle first) | **PASS** |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
