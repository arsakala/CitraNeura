# Auto Trace v1.0: Reproducibility Package

**Version:** 1.0.0
**Date:** June 30, 2026

This Reproducibility Package is provided to ensure full scientific transparency and auditability of the Auto Trace v1.0 algorithm as implemented in the CitraNeura framework. 

## 1. Directory Structure

All components necessary for reproducing the validation results are self-contained within this repository:

*   **Algorithm Source Code**: `/lib/auto-trace/`
    *   `measurements.ts`: CIELAB conversion and Hessian/Frangi Ridge Detection.
    *   `cost.ts`: Unified Cost Function computing normalized edge and color alignments.
    *   `astar-solver.ts`: The Directional A* Search Engine.
    *   `types.ts`: Type definitions and the single source of truth for the default Auto Trace Parameters.
*   **Scientific Validation Engine**: `/lib/scientific-validation.ts`
    *   Contains the mathematical definitions of the Real-World Scenarios (clean, noisy, skewed, etc.).
    *   Contains the `runRealWorldValidation` function which calculates RMSE, completion rates, and cross-interference markers.
*   **Live Self-Test Suite**: `/lib/auto-trace/self-test.ts`
    *   Contains atomic checks for CIELAB math, Gaussian smoothing energy conservation, Hessian discrimination, and the full end-to-end A* path solver on synthetic data.
*   **Documentation**: `/docs/`
    *   `AUTO-TRACE-ARCHITECTURE.md`
    *   `PARAMETER-SPECIFICATION.md`
    *   `SCIENTIFIC-ACCEPTANCE-CRITERIA.md`
    *   `AUTO-TRACE-VALIDATION-REPORT.md`

## 2. Real-World Validation Dataset

The system simulates 6 real-world physical scan cases within `getRealWorldCases()` in `/lib/scientific-validation.ts`. These cases mathematically model scanning artifacts (e.g., Gaussian noise for thermal degradation, affine rotations for skew, and frequency-based overlays for grid lines) over synthetic pristine sedimentary geology curves.

*   `case_clean_gr`: Pristine baseline.
*   `case_medium_rhob`: Standard quality with mild fading.
*   `case_noisy_nphi`: Thermal noise and +0.45 ft physical stretch.
*   `case_skewed_gr`: 1.8° rotational affine skew.
*   `case_gridline_ild`: Overlapping grid line frequency interference.
*   `case_lowres_dt`: 75 DPI staircase quantization.

## 3. Fixed Parameters & Configuration

As mandated by the SAC, the following parameters are strictly frozen to produce the baseline validation report. Third parties MUST use these exact defaults to reproduce the claims:

*   `colorTolerance` ($E_{max}$): **40.0**
*   `lineWidthSigma` ($\sigma$): **1.5**
*   `maxTurningAngle` ($\Theta_{max}$): **45°** ($\pi/4$)
*   `maxGapTolerance` ($\tau_{gap}$): **100.0**
*   **Weights**:
    *   `wColor` ($w_1$): **0.40**
    *   `wRidge` ($w_2$): **0.25**
    *   `wOrient` ($w_3$): **0.15**
    *   `wMomentum` ($w_4$): **0.20**

## 4. Execution Procedures

### 4.1 Running the Atomic Self-Test Suite (TTSD Verification)

1. Open the CitraNeura application.
2. Select the "Digitize" tab on the left-hand rail.
3. Switch the action mode to "Auto Trace".
4. Scroll to the bottom of the tool panel and click the **"Run Diagnostics Suite"** button.
5. A modal will execute `runAutoTraceDiagnostics()` locally and display the PASS/FAIL status of:
    * CIELAB space conversions.
    * Gaussian Smoothing.
    * Hessian Ridge Detection.
    * Unified Cost Function balancing.
    * Directional A* Solver tracing on synthetic images.

### 4.2 Re-running the Full End-to-End Benchmark

Currently, the end-to-end SAC validation benchmark is executed programmatically via the `scientific-validation.ts` test harness. 
To manually trigger or audit the validation loop across the 6 synthetic-real cases:
1. Navigate to the "Quality Control" (QC) tab.
2. A list of all historical metrics and current validation data is displayed, correlating directly to the real-time calculated RMSE and statistical confidence from digitized curves.

### 4.3 End-to-End LAS Export Audit

To verify the integration with the Scientific Domain:
1. Digitize a track manually or using the Auto Trace function.
2. Navigate to the "Export" tab.
3. Review the summary of exported curves.
4. Export the data to `.LAS` format.
5. The extracted physical values (e.g., API, Ohmm) represent the mathematically transformed raw pixel coordinates, adjusted for log depth shifts and control points.

## 5. Extensibility

This package guarantees the core algorithm is frozen and auditable. Any future modifications to `measurements.ts` or `cost.ts` will break the self-test hashes. All third-party engineers must ensure `runAutoTraceDiagnostics()` passes completely before submitting any pull requests or optimizations.
