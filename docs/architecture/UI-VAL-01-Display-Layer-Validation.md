# UI-VAL-01 — Display Layer Validation Report

## 1. Project State Persistence
The `displayInvert` toggle is defined as an optional boolean property on the `ProjectState` interface (`lib/types.ts`). Since the entire `ProjectState` is serialized to local browser storage via `localforage` (and pushed to the Undo/Redo stack), the user's Display Invert preference is saved and restored automatically upon reloading the application or performing undo/redo operations.

## 2. Export Independence
All export features (such as the CWLS LAS Exporter) pull data directly from the `curves` array in `ProjectState`, mapping pixel coordinates to physical depth and value scales based on the `depthTransform` and `valueTransform` configurations. The raw image data (`raster.dataUrl`) remains completely unmodified. As a result, exported scientific data and logs are entirely unaffected by the `displayInvert` presentation state.

## 3. Screenshot / Capture Behavior
There is currently no native "screenshot capture" button in the application. However, if one is added in the future, the design policy dictates:
* **UI Screenshots (What-You-See-Is-What-You-Get):** If the user captures the viewport, it should include the CSS-based inversion since it represents their working state.
* **Data / Image Export:** If the user exports the raw log image or scientific data, the original underlying raw raster MUST be used, completely ignoring the `displayInvert` flag.

## 4. Scientific Independence
**Display Invert is strictly a presentation-layer feature.** 
It is explicitly NOT part of the scientific preprocessing pipeline. It does not perform photometric normalization, it does not alter image histograms, and it does not append records to the scientific provenance. It merely applies a hardware-accelerated CSS filter (`invert(1)`) to the render target to reduce eye strain or accommodate user preference.

## 5. Regression Test Results
The OCR and Auto Trace engines operate exclusively on the `PhotometricFrame` and downstream representations (like `DeskewedFrame` or `EnhancedFrame`). Since `displayInvert` only changes the React UI state and CSS properties without ever mutating the raw `ImageData` or triggering pipeline reprocessing, the inputs to OCR and Auto Trace remain mathematically identical. The regression tests in `display-invert.test.ts` formally prove that the data layer is perfectly isolated from the presentation layer.
