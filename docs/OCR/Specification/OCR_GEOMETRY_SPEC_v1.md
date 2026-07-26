# OCR Coordinate & Geometry System Specification v1.0 (OCR-GEOMETRY-01)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Geometry Specification Only)**  
**Date:** 2026-07-01  

---

## 1. Introduction & Purpose

This document establishes the official **OCR Coordinate & Geometry System Specification v1.0 (OCR-GEOMETRY-01)** for the CitraNeura Application Platform. Following our **Type-Triggered System Design (TTSD)** paradigm, this specification defines the coordinate origin, axis orientation, rotation, boundary conventions, and transformation rules governing visual metadata.

When overlaying OCR bounding boxes (words, lines, or region boxes) onto the interactive Workspace Canvas, any structural ambiguity in the coordinate definitions (e.g., top-left center offset, pixel boundaries, scale ratios, or rotation directions) causes visual misalignments, rendering overlays useless for calibration. This document enforces a rigorous mathematical geometry contract to ensure 100% accurate visual rendering.

---

## 2. Coordinate System Fundamentals

The coordinate systems utilized within the OCR pipeline and Workspace Canvas are governed by the following mathematical and geometric rules:

### 2.1 Origin and Axis Orientation
* **Origin $(0,0)$**: Explicitly defined as the **top-left corner of the top-leftmost pixel** of the parent raster image.
* **Horizontal Axis ($X$)**: Extends to the right. $x \in [0, W]$, where $W$ is the width of the raster image in pixels.
* **Vertical Axis ($Y$)**: Extends downwards. $y \in [0, H]$, where $H$ is the height of the raster image in pixels.

```text
  (0,0) [Origin] ───────────────────────────► +X Axis (Width)
    │
    │
    │
    │        [Bounding Box]
    │        (x_start, y_start) ┌────────────────────────┐
    │                           │                        │
    │                           │  [Raster ROI Content]  │ height (H_box)
    │                           │                        │
    │                           └────────────────────────┘
    ▼                                  width (W_box)
  +Y Axis (Height)
```

### 2.2 Boundary Inclusivity (Pixel Quantization)
To prevent off-by-one errors and ensure correct sub-pixel rendering:
* **Horizontal interval**: Defined as a half-open interval $[x_{start}, x_{end})$, where $x_{start}$ is inclusive and $x_{end}$ is exclusive. The width of a bounding box is $W_{box} = x_{end} - x_{start}$.
* **Vertical interval**: Defined as a half-open interval $[y_{start}, y_{end})$, where $y_{start}$ is inclusive and $y_{end}$ is exclusive. The height of a bounding box is $H_{box} = y_{end} - y_{start}$.

---

## 3. Rotation & Skew Modeling

Well logs can exhibit physical skewing from paper feed operations during scanning. The pipeline models and corrects rotation using standard trigonometry:

### 3.1 Skew Angle ($\theta$)
* Defined in **degrees** as a floating-point number.
* **Positive rotation ($+\theta$)**: Represents **clockwise** rotation.
* **Negative rotation ($-\theta$)**: Represents **counter-clockwise** rotation.
* Range: Bounded strictly within $[-45.0^{\circ}, +45.0^{\circ}]$.

### 3.2 Coordinate Transformation (Deskewing)
To transform a pixel point $P(x, y)$ from a skewed coordinate system to a corrected coordinate system $P'(x', y')$ rotated around a focal point $F(x_f, y_f)$ (typically the center of the bounding box):

$$x' = (x - x_f) \cos(\theta) - (y - y_f) \sin(\theta) + x_f$$

$$y' = (x - x_f) \sin(\theta) + (y - y_f) \cos(\theta) + y_f$$

---

## 4. Canvas Viewport Mapping Transformations

To render the OCR bounding boxes on the Workspace Canvas under active zoom scale factor $S$ and pan offsets $(T_x, T_y)$:

### 4.1 Pixel to Screen Conversion
Let a point in the raw raster coordinates be $P_{raw}(x, y)$. The corresponding coordinates on the physical browser viewport $P_{screen}(x_{screen}, y_{screen})$ are calculated deterministically as:

$$x_{screen} = x \times S + T_x$$

$$y_{screen} = y \times S + T_y$$

### 4.2 Screen to Pixel Conversion (Inverse)
When a user clicks on the viewport canvas to edit or override an OCR region, the physical click coordinates $P_{click}(x_{screen}, y_{screen})$ must be mapped back to the raw raster coordinate space:

$$x = \frac{x_{screen} - T_x}{S}$$

$$y = \frac{y_{screen} - T_y}{S}$$

These conversions must use high-precision floating-point arithmetic, with quantization to integer coordinates occurring only at the final pixel boundary commit phase using the mathematical flooring function:

$$\text{pixelCoord} = \lfloor \text{value} \rfloor$$

---

## 5. Verification Matrix

| Test Case ID | Stage | Validation Scenario | Expected Mathematical Output |
| :--- | :--- | :--- | :--- |
| **TC-GEOM-501** | Transformation | Rot of $(100, 100)$ by $\theta = 0^{\circ}$ around center | Returns $(100, 100)$ exactly. |
| **TC-GEOM-502** | Boundary | Bounding box from $x=10$ to $x=20$ | Width evaluates to exactly $10$ pixels. |
| **TC-GEOM-503** | Canvas | Screen mapping with $S=2.0$, $T_x=50$ for $x=10$ | Viewport screen $x$ coordinate resolves to exactly $70$. |

---

**Certified By:**  
*CitraNeura Core Architecture Board*  
*CitraNeura System Security Division*  
*CitraNeura Scientific Verification Board*  
