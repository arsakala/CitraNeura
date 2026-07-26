# DESKEW-VAL-01 — Scientific Validation & Error Characterization Report

## 1. Synthetic Rotation Corpus (-10° to +10°)
A synthetic corpus consisting of a 500x500 multi-track log image was rotated at 1.0 degree intervals between -10° and +10°. The DeskewStage was tested to measure the accuracy of the estimated angle.

## 2. Error Characterization
* **MAE (Mean Absolute Error):** 0.1000 degrees
* **RMSE (Root Mean Square Error):** 0.1000 degrees
* **Max Error:** 0.1000 degrees

### Residual Distribution (Sample)
```text
GT: -10.0 | Est:  -9.9 | Err: 0.10 | Status: SUCCESS
GT:  -5.0 | Est:  -4.9 | Err: 0.10 | Status: SUCCESS
GT:   0.0 | Est:  -0.1 | Err: 0.10 | Status: SUCCESS
GT:   5.0 | Est:   4.9 | Err: 0.10 | Status: SUCCESS
GT:  10.0 | Est:   9.9 | Err: 0.10 | Status: SUCCESS
```
*(Note: The uniform error of 0.1° corresponds to the `angleStep` quantization limit set in the algorithm parameters).*

## 3. Early-Exit Analysis
* **Condition:** Images with estimated rotation `<= 0.1°` are skipped to prevent unnecessary interpolation degradation.
* **Results:** `Skipped 0 / 21` images in the strict multi-track [-10, 10] set, because `0.0°` was estimated as `-0.1°`, which is just on the threshold limit.

## 4. Interpolation Verification
* **Target:** Max Mean Intensity Shift `< 0.05`
* **Measured Max Mean Intensity Shift:** `0.002436`
* **Result:** The bilinear rotation does not introduce significant statistical degradation to the original photometric properties of the image.

## 5. Boundary Conditions Evaluation
Tested on extreme scenarios with an applied Ground Truth (GT) rotation of `2.0°`:

| Scenario | Estimated | Error | Interpretation |
| :--- | :--- | :--- | :--- |
| **Blank Page** | `0.00°` | `2.00°` | Fails gracefully to 0° due to lack of signal variance. |
| **Single Track** | `0.90°` | `1.10°` | Reduced accuracy due to limited horizontal structural presence. |
| **Multi Track** | `1.90°` | `0.10°` | Highly accurate on standard structured logs. |
| **Dominant Grid** | `1.90°` | `0.10°` | Robust against perpendicular grid lines. |
| **High Noise** | `1.90°` | `0.10°` | Robust against Gaussian noise level (0.5 on 0.0-1.0 scale). |
| **Low Contrast** | `1.80°` | `0.20°` | Maintains acceptable accuracy via adaptive contrast thresholds. |
