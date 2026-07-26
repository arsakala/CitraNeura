# DESKEW-SPEC-01 — Geometric Correction

## 1. Objective
Define the mathematical and algorithmic foundation for the `DeskewStage` within the Scientific Image Processing Pipeline. The primary goal is to correct minor rotational skew introduced during the scanning process without degrading image quality or introducing artifacts.

## 2. Approach

### 2.1. Skew Estimation: Projection Profile Method
To estimate the skew angle $\theta$, we rely on the horizontal projection profile variance. Text lines and horizontal grid lines in well logs create dense horizontal bands. When the image is perfectly aligned ($\theta = 0$), the horizontal projection profile (sum of pixel intensities along each row) exhibits maximum variance.

For an angle $\alpha$ within a search range $[-\theta_{max}, \theta_{max}]$:
1. Rotate the image by $\alpha$.
2. Compute the horizontal projection profile $P_\alpha(y) = \sum_x I_\alpha(x, y)$.
3. Compute the variance of the profile $V(\alpha) = \text{Var}(P_\alpha)$.
4. The estimated skew angle $\theta$ is the angle that maximizes $V(\alpha)$.

*Optimization:* To ensure performance, the estimation is performed on a downsampled, coarsely thresholded version of the input frame.

### 2.2. Tolerance Threshold
If the estimated angle $\theta$ satisfies $|\theta| \le \theta_{tolerance}$ (e.g., $0.1^\circ$), the geometric correction is deemed unnecessary. The stage will exit early with a `SKIPPED` status, avoiding the computational cost and interpolation blur of a rotation matrix.

### 2.3. Affine Rotation
For an angle $\theta$ requiring correction, an affine rotation is applied to the full-resolution frame around its center $(c_x, c_y)$:

$$
\begin{bmatrix}
x' \\
y'
\end{bmatrix}
=
\begin{bmatrix}
\cos(\theta) & -\sin(\theta) \\
\sin(\theta) & \cos(\theta)
\end{bmatrix}
\begin{bmatrix}
x - c_x \\
y - c_y
\end{bmatrix}
+
\begin{bmatrix}
c_x \\
c_y
\end{bmatrix}
$$

**Interpolation:** Bilinear interpolation is used to sample the source pixels to preserve smooth intensity transitions in grayscale images.

## 3. Interfaces & Contracts

### 3.1. Input & Output
- **Input:** `PhotometricFrame` (or compatible representation containing grayscale data, width, and height).
- **Output:** `DeskewedFrame`

```typescript
export interface DeskewedFrame extends PhotometricFrame {
  readonly deskewAngle: number;
}
```

### 3.2. Parameters
- `maxAngle` (number): Maximum absolute angle to search (e.g., $5^\circ$).
- `angleStep` (number): Step size for angle search (e.g., $0.1^\circ$).
- `tolerance` (number): Threshold below which rotation is skipped.

### 3.3. Provenance
**ScientificProvenance:**
- `algorithmVersion`: Version of the Deskew algorithm.
- `parametersApplied`: The search bounds and tolerance.
- `deterministicDecisions`: Contains `estimatedAngle` and `wasRotated`.

## 4. Verification Requirements
- `NORMAL` un-rotated image -> Estimated angle ~0 -> Returns `SKIPPED`.
- Image rotated by $2^\circ$ -> Estimated angle ~$-2^\circ$ -> Returns `SUCCESS` with rotated data.
- Provenance must correctly reflect the estimated angle and rotation decision.
