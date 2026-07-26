# CitraNeura OCR Formal Algorithm Specification v1.0 (OCR-IMP-05)

**Project:** CitraNeura Application Platform  
**Subsystem:** Optical Character Recognition (OCR) Engine & Pipeline  
**Status:** **FROZEN (Formal Mathematical & Algorithmic Specification)**  
**Date:** 2026-07-09  

---

## Certification & Signatures

This document represents the absolute frozen mathematical and algorithmic specification of the CitraNeura OCR Subsystem under Milestone **OCR-IMP-05**. All subsequent development work is strictly bound to this specification as a literal translation into type-safe code. No algorithmic variation or ad-hoc heuristics may be introduced during the coding phase without formal amendment of this document.

```
+------------------------------------------------------------+
|                       CERTIFIED BY:                        |
|                                                            |
|  [Signed] CitraNeura Core Architecture Board (CAB)         |
|  [Signed] CitraNeura System Security Division (SSD)        |
|  [Signed] CitraNeura Scientific Verification Board (SVB)   |
+------------------------------------------------------------+
```

---

## 1. Mathematical Foundations of Core Operations

This section details the formal mathematical formulations underpinning all core OCR processing stages.

### 1.1 Horizontal Projection Profile & Smoothing (Stage 1)
Let $I(x, y) \in [0.0, 1.0]$ denote the grayscale intensity of a pixel at coordinate $(x, y)$ in an image of dimensions $W \times H$, where $0.0$ represents pure black and $1.0$ represents pure white.

The **Horizontal Projection Profile** $P_h(y)$ is the column-mean pixel intensity for each row $y \in [0, H-1]$:
$$P_h(y) = \frac{1}{W} \sum_{x=0}^{W-1} I(x, y)$$

To eliminate high-frequency noise induced by text glyphs and grid lines, the profile is filtered using a moving-average window of width $2k + 1$ (where $k = \lfloor \text{OP\_LOC\_SMOOTH\_W} / 2 \rfloor$):
$$P_h^{smooth}(y) = \frac{1}{2k + 1} \sum_{j=-k}^{k} P_h(y + j)$$

The **First-Order Central Difference Spatial Gradient** $G_h(y)$ is defined as:
$$G_h(y) = \left| P_h^{smooth}(y+1) - P_h^{smooth}(y-1) \right|$$

---

### 1.2 Anisotropic Morphological Dilation (Stage 2)
Let $I_{bin}(x, y) \in \{0, 1\}$ be the binarized image (foreground text is $1$, background is $0$). Let $B$ be a rectangular structuring element defined by width $K_w = \text{OP\_DET\_KERN\_W}$ and height $K_h = \text{OP\_DET\_KERN\_H}$:
$$B = \left[ -\lfloor K_w/2 \rfloor, \lfloor K_w/2 \rfloor \right] \times \left[ -\lfloor K_h/2 \rfloor, \lfloor K_h/2 \rfloor \right]$$

Since $K_w \gg K_h$ (anisotropic), the **Dilation Operator** $\oplus$ merges characters horizontally to form solid text baseline lines while avoiding vertical merging:
$$(I_{bin} \oplus B)(x, y) = \max_{(dx, dy) \in B} I_{bin}(x - dx, y - dy)$$

---

### 1.3 Connected-Component Labeling (CCL) (Stage 2)
Given the dilated binary mask $M_{dil} = I_{bin} \oplus B$, the Connected-Component Labeling (CCL) maps each pixel $p = (x, y)$ to a label $L(p) \in \{0, 1, \dots, N_c\}$ using an 8-connectivity relation:
$$8\text{-Neighbors}(x, y) = \left\{ (x+u, y+v) \mid u,v \in \{-1,0,1\}, \, (u,v) \neq (0,0) \right\}$$

The labeling function $L(p)$ satisfies:
1. $L(p) = 0 \iff M_{dil}(p) = 0$ (background)
2. $L(p) = L(q) > 0 \iff p$ and $q$ are connected by a path of pixels $p_1, \dots, p_m$ where $M_{dil}(p_i) = 1$ and $p_{i+1} \in 8\text{-Neighbors}(p_i)$.

---

### 1.4 Bounding-Box Merge & Overlap Evaluation (Stage 2)
For each connected component $C_i = \{ p \mid L(p) = i \}$, the minimal enclosing bounding box is $Box_i = [x_{min}^i, y_{min}^i, x_{max}^i, y_{max}^i]$.

The intersection area $A_{\cap}(Box_i, Box_j)$ of two bounding boxes is:
$$A_{\cap}(Box_i, Box_j) = \max\left(0, \min(x_{max}^i, x_{max}^j) - \max(x_{min}^i, x_{min}^j)\right) \times \max\left(0, \min(y_{max}^i, y_{max}^j) - \max(y_{min}^i, y_{min}^j)\right)$$

The **Overlap Ratio** $R_{overlap}(Box_i, Box_j)$ is computed relative to the smaller box area:
$$R_{overlap}(Box_i, Box_j) = \frac{A_{\cap}(Box_i, Box_j)}{\min\left(\text{Area}(Box_i), \, \text{Area}(Box_j)\right)}$$

If $R_{overlap}(Box_i, Box_j) > \text{OP\_DET\_OVERLAP\_TOL}$, the boxes are merged into a single composite box $Box_{merged}$:
$$Box_{merged} = \left[ \min(x_{min}^i, x_{min}^j), \, \min(y_{min}^i, y_{min}^j), \, \max(x_{max}^i, x_{max}^j), \, \max(y_{max}^i, y_{max}^j) \right]$$

---

### 1.5 Spatial Token Clustering (Stage 4)
Let $T = \{ t_1, t_2, \dots, t_n \}$ be the set of recognized tokens, where each token $t_i$ has a transcribed string $s_i$, bounding box $Box_i = [x_{min}^i, y_{min}^i, x_{max}^i, y_{max}^i]$, and character confidence array.

Two tokens $t_a$ and $t_b$ belong to the same logical text row if their vertical overlap projection ratio exceeds the threshold $T_{row\_align} = 0.50$:
$$\text{Overlap}_v(t_a, t_b) = \frac{\max\left(0, \, \min(y_{max}^a, y_{max}^b) - \max(y_{min}^a, y_{min}^b)\right)}{\min\left(y_{max}^a - y_{min}^a, \, y_{max}^b - y_{min}^b\right)} \ge 0.50$$

---

### 1.6 Confidence Propagation & Weighting Mathematics (Stage 5)
Let $f$ represent a parsed field (e.g., `wellName`, `startDepth`, `endDepth`). 

1.  **Optical Mean Confidence** $\bar{C}_{rec}(f)$: The geometric mean of the character confidence values $c_i \in [0.0, 1.0]$ for all tokens associated with the field:
    $$\bar{C}_{rec}(f) = \left( \prod_{i=1}^{n} c_i \right)^{\frac{1}{n}}$$
    If $n = 0$, $\bar{C}_{rec}(f) = 0.0$.

2.  **Localization Penalized Confidence** $C_{penalized}(f)$:
    $$C_{penalized}(f) = \bar{C}_{rec}(f) \times C_{roi}$$
    where $C_{roi} \in [0.0, 1.0]$ is the localization confidence score of the parent well header.

3.  **Fuzzy Match Discounting**:
    Let $S_{Lev}(s_{raw}, s_{dict}) \in [0.0, 1.0]$ be the normalized Levenshtein similarity:
    $$S_{Lev}(s_{raw}, s_{dict}) = 1.0 - \frac{\text{LevenshteinDistance}(s_{raw}, s_{dict})}{\max\left(|s_{raw}|, |s_{dict}|\right)}$$
    The final field confidence $C_f$ is:
    $$C_f = \text{clamp}\left( C_{penalized}(f) \times S_{Lev}(s_{raw}, s_{dict}) \times \beta, \, 0.0, \, 1.0 \right)$$
    where $\beta = \text{OP\_PAR\_DICT\_CONF}$ if an exact or fuzzy dictionary match is committed, else $\beta = 1.0$.

4.  **Composite Confidence Synthesis** $C_{composite}$:
    $$C_{composite} = w_{name} C_{wellName} + w_{depth} C_{depth} + w_{scale} C_{scale}$$
    where:
    *   $C_{depth} = \frac{1}{2}\left( C_{startDepth} + C_{endDepth} \right)$
    *   $w_{name} = \text{OP\_CON\_W\_NAME}$
    *   $w_{depth} = \text{OP\_CON\_W\_DEPTH}$
    *   $w_{scale} = \text{OP\_CON\_W\_SCALE}$
    *   Constraint: $w_{name} + w_{depth} + w_{scale} = 1.0$

---

### 1.7 Domain Validation Constraints (Stage 6)
A parsed document is structurally and scientifically valid ($isValid = \text{true}$) if and only if it satisfies the complete set of logical assertions:

$$\text{Validation}(D) \iff \left( \begin{aligned}
&C_{composite} \ge \text{OP\_CON\_COMP\_THRES} \\
&\land \forall f \in \text{OP\_PAR\_MANDATORY\_FIELDS}, \, D[f] \neq \text{null} \\
&\land D[startDepth] \ge \text{OP\_VAL\_MIN\_DEPTH} \\
&\land D[endDepth] \le \text{OP\_VAL\_MAX\_DEPTH} \\
&\land D[endDepth] > D[startDepth] \\
&\land D[depthUnit] \in \text{OP\_VAL\_DEPTH\_UNITS} \\
&\land D[scaleRatio] \in \text{OP\_VAL\_SCALE\_RATIOS}
\end{aligned} \right)$$

---

## 2. Deterministic Decision Tables

These tables define the deterministic logic paths for resolving ambiguous geometric, structural, or lexical states.

### 2.1 Table 2.1: Multiple ROI Division Line Candidates (Tie-Breaking)
**Context:** During Stage 1, several horizontal projection profile gradient peaks exceed `OP_LOC_GRAD_THRES`.

| Condition 1: Peak Strength ($G_h(y)$) | Condition 2: Vertical Position ($y$) | Condition 3: Underlaying Area Density | Resolution Action |
| :--- | :--- | :--- | :--- |
| Multiple peaks $\ge \text{OP\_LOC\_DIV\_STRENGTH}$ | At least one candidate $y \le \text{OP\_LOC\_MAX\_H\_PCT} \times H$ | Remaining area ($[y, H]$) density $> 0.05$ | Select the **uppermost** peak ($y_{min}$) satisfying both bounds. |
| No peak $\ge \text{OP\_LOC\_DIV\_STRENGTH}$ | Peak $y$ is in range $[0.05H, \text{OP\_LOC\_MAX\_H\_PCT} \times H]$ | Strongest gradient prominence among local neighborhood | Fall back to the absolute local maximum gradient peak; apply a $-0.15$ confidence penalty to $C_{roi}$. |
| All peaks $y > \text{OP\_LOC\_MAX\_H\_PCT} \times H$ | Any | Any | Reject immediately; throw **`FAILURE_HEADER_NOT_FOUND`**. |

---

### 2.2 Table 2.2: Overlapping Bounding Boxes (Layout Merging vs. Column Splitting)
**Context:** Two text bounding boxes $Box_1$ and $Box_2$ overlap horizontally or vertically.

| Horizontal Overlap Ratio | Vertical Overlap Ratio | Vertical Box Center Offset | Resolution Action |
| :--- | :--- | :--- | :--- |
| $\ge \text{OP\_DET\_OVERLAP\_TOL}$ | $\ge 0.60$ | $\le \frac{1}{2} \text{Height}_{avg}$ | **Merge**: Combine $Box_1$ and $Box_2$ into $Box_{merged}$ (Same line text segments). |
| $\le \text{OP\_DET\_OVERLAP\_TOL}$ | $\ge 0.60$ | $\le \frac{1}{2} \text{Height}_{avg}$ | **Column Split**: Treat as distinct side-by-side text items; sort horizontally by ascending $x_{min}$ coordinate. |
| Any | $\le 0.15$ | $> 1.2 \text{Height}_{avg}$ | **Line Break**: Keep as separate vertical boxes. Sort vertically by ascending $y_{min}$ coordinate. |

---

### 2.3 Table 2.3: Lexical Dictionary Fuzzy Match Tie-Breaking
**Context:** A parsed Well Name or Operator matches multiple dictionary terms with Levenshtein similarities exceeding `OP_PAR_LEV_ACCEPT`.

| Similarity Delta ($S_1 - S_2$) | Exact Dict Check (Primary Database) | Frequency Weighting (Catalog) | Final Resolution Choice |
| :--- | :--- | :--- | :--- |
| $> 0.05$ | Any | Any | Select Candidate 1 (Highest score dominates). |
| $\le 0.05$ (Tie) | Only one is an exact match | Any | Select the exact dictionary match candidate. |
| $\le 0.05$ (Tie) | Both fuzzy / Both exact | One has higher catalog frequency index | Select the candidate with the higher global logging catalog frequency. |
| $\le 0.05$ (Tie) | Both fuzzy / Both exact | Identical frequency/No metadata | Keep the original literal recognized string intact; do not perform dictionary substitution; compute confidence without dictionary boost. |

---

## 3. Formal Stage-by-Stage Specifications

This section provides the deterministic step-by-step logic, flow diagrams, and validation constraints for each of the 6 pipeline stages.

---

### 3.1 Stage 1: Well Header Localization

#### 3.1.1 Flow Diagram
```
              +-------------------------------------+
              |      Raw Raster Image Input (I)     |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-1.1: Image Normalization     |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-1.2: Grayscale Conversion    |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |  WP-1.3: Horizontal Proj. Profile   |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |      WP-1.4: Profile Smoothing      |
              +------------------+------------------+
                                 |
                                 v
              +--------------------+----------------+
              | WP-1.5: Divider Line Det. (Peak G) |
              +--------------------+----------------+
                                 |
                       Is a strong peak found?
                     /                       \
                  YES                         NO
                  /                             \
                 v                               v
    +-------------------------+     +--------------------------+
    |  WP-1.6: ROI Extraction |     | Throw Fatal Exception:   |
    +------------+------------+     | FAILURE_HEADER_NOT_FOUND |
                 |                  +--------------------------+
                 v
    +-------------------------+
    | WP-1.7: Conf. Eval      |
    +------------+------------+
                 |
        Does C_roi pass?
       /                \
    YES                  NO
    /                      \
   v                        v
+-------------------------+  +--------------------------+
|  WP-1.8: Type Validation |  | Throw Fatal Exception:   |
|  (HeaderROI Contract)   |  | FAILURE_HEADER_NOT_FOUND |
+-------------------------+  +--------------------------+
```

#### 3.1.2 Work Package Detailed Specifications

##### WP-1.1: Image Normalization
*   **Goal:** Equalize spatial illumination and mitigate paper scan noise.
*   **Input:** Multi-channel raw raster data ($W \times H$).
*   **Deterministic Algorithm:**
    1. Apply spatial bilateral smoothing filter with standard range $\sigma_r = 0.1$ and spatial domain $\sigma_s = 2.0$.
    2. Adjust intensity levels such that the 1st percentile maps to $0.0$ and the 99th percentile maps to $1.0$.
*   **Time/Space Complexity:** $\mathcal{O}(W \cdot H)$ / $\mathcal{O}(W \cdot H)$.
*   **Parameters:** `OP_LOC_MAX_H_PCT`.
*   **Failure Conditions:** Image pixel variance $\sigma^2 \approx 0.0$ (uniform color canvas).
*   **Preconditions:** Input raster contains valid, non-null numerical image buffers.
*   **Postconditions:** Image contrast maximized; histogram spreads across $[0.0, 1.0]$.
*   **Invariants:** Horizontal and vertical pixel dimensions remain unchanged.

##### WP-1.2: Grayscale Conversion
*   **Goal:** Compress raw RGB representation into a single high-fidelity luminance channel.
*   **Input:** Normalised RGB tensor.
*   **Deterministic Algorithm:**
    For each spatial coordinate $(x, y)$, compute:
    $$Y(x, y) = 0.299 \cdot R(x, y) + 0.587 \cdot G(x, y) + 0.114 \cdot B(x, y)$$
*   **Time/Space Complexity:** $\mathcal{O}(W \cdot H)$ / $\mathcal{O}(W \cdot H)$ (or single channel buffer allocation).
*   **Parameters:** None.
*   **Failure Conditions:** Missing input color channels.
*   **Preconditions:** Multi-channel normalized buffer populated.
*   **Postconditions:** Output single-channel matrix of floating-point values in $[0.0, 1.0]$.
*   **Invariants:** Structural image resolution $(W \times H)$ is strictly preserved.

##### WP-1.3: Horizontal Projection Profile Calculation
*   **Goal:** Reduce 2D spatial dimensions to 1D vertical density values.
*   **Input:** Single-channel grayscale matrix $Y$.
*   **Deterministic Algorithm:**
    Compute column average for each row index $y \in [0, \lfloor \text{OP\_LOC\_MAX\_H\_PCT} \cdot H \rfloor]$:
    $$P_h(y) = \frac{1}{W}\sum_{x=0}^{W-1} Y(x, y)$$
*   **Time/Space Complexity:** $\mathcal{O}(W \cdot H)$ / $\mathcal{O}(H)$.
*   **Parameters:** `OP_LOC_MAX_H_PCT`.
*   **Failure Conditions:** Height $H < 10$.
*   **Preconditions:** Grayscale image matrix allocated.
*   **Postconditions:** Floating point profile array $P_h$ of length $\lfloor \text{OP\_LOC\_MAX\_H\_PCT} \cdot H \rfloor$ generated.
*   **Invariants:** Profile bounds are restricted to the upper limit defined by `OP_LOC_MAX_H_PCT`.

##### WP-1.4: Profile Smoothing
*   **Goal:** Suppress local high-frequency line peaks caused by individual text characters.
*   **Input:** Projection profile array $P_h$.
*   **Deterministic Algorithm:**
    Convolve $P_h$ with a uniform box kernel of width $2k+1$, where $k = \lfloor \text{OP\_LOC\_SMOOTH\_W} / 2 \rfloor$:
    $$P_h^{smooth}(y) = \frac{1}{2k+1} \sum_{j=-k}^{k} P_h(y + j)$$
    Handle boundaries using zero-padding or edge-replication.
*   **Time/Space Complexity:** $\mathcal{O}(H)$ / $\mathcal{O}(H)$.
*   **Parameters:** `OP_LOC_SMOOTH_W`.
*   **Failure Conditions:** Smooth window size greater than profile array size.
*   **Preconditions:** Raw profile array $P_h$ initialized.
*   **Postconditions:** Smoothed profile $P_h^{smooth}$ contains only low-frequency structural envelopes.
*   **Invariants:** Array size remains constant.

##### WP-1.5: Divider Line Detection
*   **Goal:** Pinpoint the precise vertical divider line bounding the header ROI.
*   **Input:** Smoothed profile $P_h^{smooth}$.
*   **Deterministic Algorithm:**
    1. Compute first-order central difference gradient profile:
       $$G_h(y) = \left| P_h^{smooth}(y+1) - P_h^{smooth}(y-1) \right|$$
    2. Identify all peak indices where $G_h(y)$ is a local maximum and $G_h(y) \ge \text{OP\_LOC\_GRAD\_THRES}$.
    3. Apply Decision Table 2.1 to select the optimal peak coordinate $y_{div}$.
*   **Time/Space Complexity:** $\mathcal{O}(H)$ / $\mathcal{O}(H)$.
*   **Parameters:** `OP_LOC_GRAD_THRES`, `OP_LOC_DIV_STRENGTH`, `OP_LOC_MAX_H_PCT`.
*   **Failure Conditions:** No peak matches gradient thresholds; triggers `FAILURE_HEADER_NOT_FOUND`.
*   **Preconditions:** Smoothed profile exists and contains variance.
*   **Postconditions:** Integer vertical division boundary $y_{div}$ resolved.
*   **Invariants:** $0 < y_{div} \le \text{OP\_LOC\_MAX\_H\_PCT} \cdot H$.

##### WP-1.6: ROI Extraction
*   **Goal:** Crop and isolate the header portion of the document.
*   **Input:** Original normalized image $I$, divider coordinate $y_{div}$.
*   **Deterministic Algorithm:**
    Isolate the sub-grid $I_{roi}$ by slicing the image buffer:
    $$I_{roi} = I[0 \dots W-1, \, 0 \dots y_{div}]$$
*   **Time/Space Complexity:** $\mathcal{O}(W \cdot y_{div})$ / $\mathcal{O}(W \cdot y_{div})$.
*   **Parameters:** None.
*   **Failure Conditions:** $y_{div} \le 0$.
*   **Preconditions:** Valid image and positive divider coordinate.
*   **Postconditions:** Isolated raster sub-image $I_{roi}$ allocated.
*   **Invariants:** Image aspect-ratio is preserved for the sub-region.

##### WP-1.7: Localization Confidence Evaluation
*   **Goal:** Calculate a mathematical confidence score representing ROI localization accuracy.
*   **Input:** Peak gradient value $G_h(y_{div})$, average background gradient.
*   **Deterministic Algorithm:**
    Compute:
    $$C_{roi} = \frac{G_h(y_{div})}{\max_{y} G_h(y)} \times \left(1.0 - \frac{\text{Mean}_{y \neq y_{div}}(G_h(y))}{\max_{y} G_h(y)}\right)$$
    Assert that $C_{roi} \ge \text{OP\_LOC\_CONF\_THRES}$.
*   **Time/Space Complexity:** $\mathcal{O}(H)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_LOC_CONF_THRES`.
*   **Failure Conditions:** $C_{roi} < \text{OP\_LOC\_CONF\_THRES}$; triggers `FAILURE_HEADER_NOT_FOUND`.
*   **Preconditions:** Division peak and gradient array populated.
*   **Postconditions:** Real confidence value $C_{roi} \in [0.0, 1.0]$ evaluated.
*   **Invariants:** Confidence is bounded by $[0.0, 1.0]$.

##### WP-1.8: Stage 1 Contract and Type Validation
*   **Goal:** Enforce compile-locked type structures on stage boundaries.
*   **Input:** $I_{roi}$, $C_{roi}$.
*   **Deterministic Algorithm:**
    Construct the `HeaderROI` data structure:
    ```typescript
    interface HeaderROI {
      boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number };
      localizationConfidence: number;
      roiBuffer: ImageData;
    }
    ```
    Assert all parameters comply with their respective structural invariants.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$ reference allocations.
*   **Parameters:** None.
*   **Failure Conditions:** Type assertions fail.
*   **Preconditions:** Verification checks passed.
*   **Postconditions:** Immutable `HeaderROI` structure exported.
*   **Invariants:** Object schemas are immutable.

#### 3.1.3 Scientific Verification Point (SVP-1)
*   **Expected Intermediate Outputs:** Smoothed profile array displaying a singular dominant local derivative maximum matching the black margin boundary of the log.
*   **Acceptance Criteria:** Localization accuracy intersection-over-union ($\text{IoU}_{roi} \ge 0.92$ on degraded Stress files).
*   **Regression Checks:** Ensure $y_{div}$ coordinate variations remain under $\pm 3$ pixels relative to the physical baseline standard.
*   **Benchmark Dataset:** `Golden`, `Benchmark`, `Stress`.

---

### 3.2 Stage 2: Text Region Detection

#### 3.2.1 Flow Diagram
```
              +-------------------------------------+
              |         HeaderROI Input (S1)        |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-2.1: Local Adaptive Thres     |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-2.2: Anisotropic Dilation     |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |   WP-2.3: Connected Comp. Labeling  |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-2.4: Area & Noise Rejection   |
              +------------------+------------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-2.5: Bounding Box Union Merg   |
              +--------------------+----------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-2.6: Vertical Layout Sorting   |
              +--------------------+----------------+
                                 |
                        Are regions found?
                     /                      \
                  YES                        NO
                  /                            \
                 v                              v
    +-------------------------+     +--------------------------+
    | WP-2.7: Type Validation |     | Throw Fatal Exception:   |
    |  (DetectedText[] Out)   |     | FAILURE_TEXT_REGION_EMPTY|
    +-------------------------+     +--------------------------+
```

#### 3.2.2 Work Package Detailed Specifications

##### WP-2.1: Image Thresholding
*   **Goal:** Convert continuous-tone ROI grayscale into high-contrast binary masks.
*   **Input:** Isolated well header raster buffer $I_{roi}$.
*   **Deterministic Algorithm:**
    Compute adaptive binarization using Sauvola's thresholding:
    $$T(x, y) = m(x, y) \cdot \left[ 1.0 + k_{sauvola} \cdot \left( \frac{s(x, y)}{R_{sauvola}} - 1.0 \right) \right]$$
    where $m(x, y)$ and $s(x, y)$ are the local mean and standard deviation in a window of size $15 \times 15$, $k_{sauvola} = 0.20$, and $R_{sauvola} = 0.50$.
*   **Time/Space Complexity:** $\mathcal{O}(W_{roi} \cdot H_{roi})$ / $\mathcal{O}(W_{roi} \cdot H_{roi})$.
*   **Parameters:** None.
*   **Failure Conditions:** Local standard deviation approaches $0.0$ across the entire image grid.
*   **Preconditions:** `HeaderROI` buffer allocated and initialized.
*   **Postconditions:** Binary mask $M_{bin}(x, y) \in \{0, 1\}$ generated.
*   **Invariants:** Array size matches $I_{roi}$ resolution.

##### WP-2.2: Anisotropic Horizontal Morphological Dilation
*   **Goal:** Link contiguous characters on the same baseline into unified row structures.
*   **Input:** Binary mask $M_{bin}$.
*   **Deterministic Algorithm:**
    Convolve $M_{bin}$ with a rectangular structuring box of dimensions $K_w = \text{OP\_DET\_KERN\_W}$ and $K_h = \text{OP\_DET\_KERN\_H}$:
    $$M_{dil}(x, y) = \max_{dx, dy} M_{bin}(x - dx, y - dy)$$
    using optimized horizontal 1D decomposition sweeps.
*   **Time/Space Complexity:** $\mathcal{O}(W_{roi} \cdot H_{roi})$ / $\mathcal{O}(W_{roi} \cdot H_{roi})$.
*   **Parameters:** `OP_DET_KERN_W`, `OP_DET_KERN_H`.
*   **Failure Conditions:** Kernel sizes $K_w, K_h$ exceed ROI array dimensions.
*   **Preconditions:** Binary mask $M_{bin}$ populated.
*   **Postconditions:** Dense, horizontally connected text line masks generated.
*   **Invariants:** Line layout configurations are preserved.

##### WP-2.3: Connected Component Extraction
*   **Goal:** Detect separate structural blobs in the dilated binary mask.
*   **Input:** Dilated mask $M_{dil}$.
*   **Deterministic Algorithm:**
    Run a two-pass Connected Component Labeling (CCL) with an equivalence table over an 8-connectivity layout, assigning a unique identifier $L(p)$ to each distinct pixel group.
*   **Time/Space Complexity:** $\mathcal{O}(W_{roi} \cdot H_{roi})$ / $\mathcal{O}(W_{roi} \cdot H_{roi})$.
*   **Parameters:** None.
*   **Failure Conditions:** Number of separate components exceeds $5000$.
*   **Preconditions:** Dilated mask buffer exists.
*   **Postconditions:** Array of spatial labeled regions $C_1, \dots, C_M$ mapped.
*   **Invariants:** Label indices are unique and deterministic.

##### WP-2.4: Area & Aspect Noise Rejection
*   **Goal:** Prune speckles, grid line residues, or large non-text artifacts.
*   **Input:** Labeled components $C_i$.
*   **Deterministic Algorithm:**
    For each component $C_i$ with bounding box $[x_{min}, y_{min}, x_{max}, y_{max}]$:
    1. Compute area $A_i = (x_{max} - x_{min} + 1) \cdot (y_{max} - y_{min} + 1)$.
    2. Compute aspect ratio $R_i = (x_{max} - x_{min} + 1) / (y_{max} - y_{min} + 1)$.
    3. Retain component if and only if:
       $$A_i \ge \text{OP\_DET\_MIN\_AREA} \quad \land \quad R_i \ge \text{OP\_DET\_NOISE\_REJ}$$
*   **Time/Space Complexity:** $\mathcal{O}(M)$ / $\mathcal{O}(M)$ tracking array slots.
*   **Parameters:** `OP_DET_MIN_AREA`, `OP_DET_NOISE_REJ`.
*   **Failure Conditions:** None (empty components list is handled downstream).
*   **Preconditions:** Connected components labeled and bounding boxes computed.
*   **Postconditions:** Set of filtered text-only boxes $Box_{filtered}$ produced.
*   **Invariants:** Bounding box coordinate boundaries are locked.

##### WP-2.5: Bounding Box Union & Merging
*   **Goal:** Merge text regions that overlap.
*   **Input:** Filtered bounding boxes $Box_{filtered}$.
*   **Deterministic Algorithm:**
    1. Order candidates in ascending order of their $x_{min}$ coordinates.
    2. For each pair of boxes $B_i$ and $B_j$:
       Evaluate overlap ratio $R_{overlap}$ using the formula in Section 1.4.
    3. If $R_{overlap} > \text{OP\_DET\_OVERLAP\_TOL}$, replace $B_i$ and $B_j$ with the unified box $Box_{merged}$.
    4. Repeat iteratively until no pair of boxes violates the threshold.
*   **Time/Space Complexity:** $\mathcal{O}(M^2)$ / $\mathcal{O}(M)$.
*   **Parameters:** `OP_DET_OVERLAP_TOL`.
*   **Failure Conditions:** Infinite loop (prevented by strict size reduction per iteration).
*   **Preconditions:** Filtered boxes populated.
*   **Postconditions:** Overlapping and fragmented regions combined into clean line boxes.
*   **Invariants:** Coordinates are bounded by the ROI frame limits.

##### WP-2.6: Top-to-Bottom Layout Sorting
*   **Goal:** Establish a deterministic sequence for optical transcription scanning.
*   **Input:** Merged bounding boxes $Box_{merged}$.
*   **Deterministic Algorithm:**
    Sort the list of boxes using a compound comparison operator:
    $$Box_a < Box_b \iff \left( \begin{aligned}
    &y_{min}^a < y_{min}^b - \epsilon \\
    &\lor \left( |y_{min}^a - y_{min}^b| \le \epsilon \land x_{min}^a < x_{min}^b \right)
    \end{aligned} \right)$$
    where $\epsilon = \frac{1}{2}\text{Height}_{avg}$ to handle slight slant distortions.
*   **Time/Space Complexity:** $\mathcal{O}(M \log M)$ / $\mathcal{O}(M)$.
*   **Parameters:** None.
*   **Failure Conditions:** Circular sort loops (prevented by strict ordering relations).
*   **Preconditions:** Bounding box list populated.
*   **Postconditions:** Vertically ordered array of text regions $Box_{sorted}$ produced.
*   **Invariants:** Top-to-bottom spatial hierarchy is strictly enforced.

##### WP-2.7: Stage 2 Contract and Type Validation
*   **Goal:** Construct the formal Stage 2 output arrays.
*   **Input:** Ordered bounding boxes $Box_{sorted}$.
*   **Deterministic Algorithm:**
    Convert boxes into `DetectedText` structures:
    ```typescript
    interface DetectedText {
      regionId: string;
      boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number };
      rawCropBuffer: ImageData;
    }
    ```
    Throw **`FAILURE_TEXT_REGION_EMPTY`** if the array length is zero.
*   **Time/Space Complexity:** $\mathcal{O}(M \cdot W_{crop} \cdot H_{crop})$ / $\mathcal{O}(M \cdot W_{crop} \cdot H_{crop})$.
*   **Parameters:** None.
*   **Failure Conditions:** Zero regions found; triggers `FAILURE_TEXT_REGION_EMPTY`.
*   **Preconditions:** Correct type definitions.
*   **Postconditions:** Validated array of `DetectedText` structures exported.
*   **Invariants:** All generated region IDs are unique.

#### 3.2.3 Scientific Verification Point (SVP-2)
*   **Expected Intermediate Outputs:** Well-isolated horizontal rectangles capturing the key-value labels in the header without slicing text baseline blocks.
*   **Acceptance Criteria:** Overlap segmentation Intersection-over-Union ($\text{IoU}_{lines} \ge 0.92$ on degraded Stress logs).
*   **Regression Checks:** Confirm that no multi-column structures are merged into a single field block unless specifically allowed.
*   **Benchmark Dataset:** `Golden`, `Benchmark`, `Synthetic`.

---

### 3.3 Stage 3: Recognition Adapter Integration

#### 3.3.1 Flow Diagram
```
              +-------------------------------------+
              |       DetectedText[] Input (S2)     |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-3.1: Adapter Abstraction      |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-3.2: Worker Pool Prov        |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-3.3: Image Slicing Crops     |
              +------------------+------------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-3.4: Parallel Task Sched       |
              +--------------------+----------------+
                                 |
                     Does thread finish in time?
                     /                       \
                  YES                         NO
                  /                             \
                 v                               v
    +-------------------------+     +--------------------------+
    | WP-3.5: WASM Execution  |     | Throw Fatal Exception:   |
    | (Monitoring Retries)    |     |FAILURE_RECOGNITION_TIME/ |
    +------------+------------+     | FAILURE_RECOGNITION_FAIL |
                 |                  +--------------------------+
                 v
    +-------------------------+
    | WP-3.6: Character Parse |
    +------------+------------+
                 |
                 v
    +-------------------------+
    | WP-3.7: Resource Disp   |
    +------------+------------+
                 |
                 v
    +-------------------------+
    | WP-3.8: Type Validation |
    | (RecognizedToken[] Out) |
    +-------------------------+
```

#### 3.3.2 Work Package Detailed Specifications

##### WP-3.1: Adapter Abstraction
*   **Goal:** Abstract third-party character recognition engines behind a strict system interface boundary.
*   **Input:** Adapter configuration settings.
*   **Deterministic Algorithm:**
    Instantiate the abstract adapter factory. Direct execution paths bypass library-specific types, using only the `OCRAdapter` interface wrapper.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Adapter library not resolved in classpath.
*   **Preconditions:** Core interface contract specifications are active.
*   **Postconditions:** Headless, abstract instance of the engine loaded.
*   **Invariants:** Zero external library classes leak into the core processing thread.

##### WP-3.2: Worker Pool Provisioning
*   **Goal:** Manage multi-threaded background Web Worker threads.
*   **Input:** Hardware execution configuration parameters.
*   **Deterministic Algorithm:**
    Spawn background workers up to `OP_WRK_POOL_SIZE` threads. Apply the dynamic scaling rule:
    $$\text{Threads}_{active} = \min\left(\text{OP\_WRK\_POOL\_SIZE}, \, \text{navigator.hardwareConcurrency} - 1\right)$$
    Enforce memory budget parameters `OP_WRK_MAX_MEM` on each child sandbox.
*   **Time/Space Complexity:** $\mathcal{O}(\text{Threads})$ / $\mathcal{O}(\text{Threads} \cdot \text{OP\_WRK\_MAX\_MEM})$.
*   **Parameters:** `OP_WRK_POOL_SIZE`, `OP_WRK_MAX_MEM`, `OP_WRK_POOL_POLICY`.
*   **Failure Conditions:** Native worker execution environment fails to initialize.
*   **Preconditions:** Main execution thread active.
*   **Postconditions:** Monitored worker thread arrays running idle in the background.
*   **Invariants:** Maximum worker count does not exceed `OP_WRK_POOL_SIZE`.

##### WP-3.3: Image Slicing and Cropping
*   **Goal:** Generate small, optimized sub-rasters for each text region.
*   **Input:** `DetectedText[]` structures.
*   **Deterministic Algorithm:**
    For each region bounding box, slice the original grayscale matrix, allocating isolated pixel byte arrays. Limit processing to `OP_REC_MAX_REGIONS` blocks to prevent system memory overload.
*   **Time/Space Complexity:** $\mathcal{O}(\sum W_{crop} \cdot H_{crop})$ / $\mathcal{O}(\sum W_{crop} \cdot H_{crop})$.
*   **Parameters:** `OP_REC_MAX_REGIONS`.
*   **Failure Conditions:** Number of input regions exceeds `OP_REC_MAX_REGIONS`.
*   **Preconditions:** DetectedText bounding box values calculated.
*   **Postconditions:** Isolated pixel slice arrays stored.
*   **Invariants:** Dimensions of the cropped buffers must match bounding box coordinate delta calculations.

##### WP-3.4: Parallel Task Scheduling
*   **Goal:** Balance crop recognition tasks across background worker threads.
*   **Input:** Crop buffers queue.
*   **Deterministic Algorithm:**
    Initialize a task queue. Distribute sub-image segments to idle workers in a round-robin schedule. Re-queue tasks if worker timeouts occur.
*   **Time/Space Complexity:** $\mathcal{O}(M)$ / $\mathcal{O}(M)$ scheduling references.
*   **Parameters:** None.
*   **Failure Conditions:** All worker threads enter deadlocked execution loops.
*   **Preconditions:** Image slices and worker pool are both active.
*   **Postconditions:** Synchronized scheduling list allocated.
*   **Invariants:** A single crop slice is routed to exactly one worker at any given time.

##### WP-3.5: WASM Execution & Timeout Management
*   **Goal:** Execute the core neural glyph recognition engine within Web Worker sandboxes.
*   **Input:** Image crop byte array.
*   **Deterministic Algorithm:**
    1. Transfer the crop byte array to the target Web Worker.
    2. Start a timer monitor thread. If execution time exceeds `OP_REC_TIMEOUT` ms, emit an `AbortSignal` to terminate the worker thread.
    3. If a crash or timeout occurs, retry the execution up to `OP_REC_MAX_RETRIES` times.
    4. On failure, throw **`FAILURE_RECOGNITION_TIMEOUT`** or **`FAILURE_RECOGNITION_FAILED`**.
*   **Time/Space Complexity:** $\mathcal{O}(W_{crop} \cdot H_{crop})$ / $\mathcal{O}(\text{WASM\_Heap})$.
*   **Parameters:** `OP_REC_TIMEOUT`, `OP_REC_MAX_RETRIES`, `OP_REC_POLL_INT`.
*   **Failure Conditions:** Timeout exceeded or worker crashed beyond maximum retries.
*   **Preconditions:** Web Worker initialized and WASM module compiled.
*   **Postconditions:** Unstructured character classification lists resolved.
*   **Invariants:** Timer values are monitored relative to system execution epochs.

##### WP-3.6: Character Parsing & Language Tagging
*   **Goal:** Convert raw neural net logit arrays into UTF-8 characters with localization tags.
*   **Input:** Neural output classifications.
*   **Deterministic Algorithm:**
    Apply greedy beam-search decoding over glyph probability arrays. Exclude non-ASCII sequences; enforce standard language formatting tags (e.g., ISO `'eng'` or `'ind'`).
*   **Time/Space Complexity:** $\mathcal{O}(L_{string})$ / $\mathcal{O}(L_{string})$.
*   **Parameters:** None.
*   **Failure Conditions:** Corrupted beam state or invalid text output encoding.
*   **Preconditions:** Classification probability arrays populated.
*   **Postconditions:** Clean, localized UTF-8 text strings generated.
*   **Invariants:** Text output is strictly valid UTF-8.

##### WP-3.7: Resource Disposal
*   **Goal:** Prevent memory leaks in the browser environment.
*   **Input:** Worker pool indices.
*   **Deterministic Algorithm:**
    After processing, explicitly deallocate image crop buffers from worker heap memory, clear thread-local caches, and terminate inactive threads.
*   **Time/Space Complexity:** $\mathcal{O}(\text{Threads})$ / $\mathcal{O}(1)$ heap release.
*   **Parameters:** None.
*   **Failure Conditions:** Worker terminate method blocked.
*   **Preconditions:** Recognition pipeline complete.
*   **Postconditions:** Sandbox allocations reclaimed.
*   **Invariants:** Garbage collector registers active deallocations.

##### WP-3.8: Stage 3 Contract and Type Validation
*   **Goal:** Package unstructured outputs into type-safe recognized token lists.
*   **Input:** Decoded character structures.
*   **Deterministic Algorithm:**
    Format characters into the `RecognizedToken` structure:
    ```typescript
    interface RecognizedToken {
      tokenId: string;
      regionId: string;
      text: string;
      boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number };
      confidence: number;
    }
    ```
*   **Time/Space Complexity:** $\mathcal{O}(N_{tokens})$ / $\mathcal{O}(N_{tokens})$.
*   **Parameters:** None.
*   **Failure Conditions:** Output validation asserts fail.
*   **Preconditions:** UTF-8 character conversion complete.
*   **Postconditions:** Export validated `RecognizedToken[]` structures.
*   **Invariants:** Bounding box values match spatial limits.

#### 3.3.3 Scientific Verification Point (SVP-3)
*   **Expected Intermediate Outputs:** Accurately transcribed character lists with precise, individual glyph confidence numbers.
*   **Acceptance Criteria:** Character Error Rate ($\text{CER} \le 1.0\%$ on clean Golden files; $\text{CER} \le 10.0\%$ on Stress logs).
*   **Regression Checks:** Ensure that numeric structures (e.g., depth numbers, scale coordinates) undergo zero character substitutions.
*   **Benchmark Dataset:** `Golden`, `Benchmark`, `Regression`.

---

### 3.4 Stage 4: Scientific Parsing

#### 3.4.1 Flow Diagram
```
              +-------------------------------------+
              |      RecognizedToken[] Input (S3)   |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-4.1: Token Spatial Alignment  |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-4.2: Well Name Regex Fuzzy   |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |   WP-4.3: Operator & Field Catalog  |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-4.4: UWI & Date ISO Parsing   |
              +------------------+------------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-4.5: Depth & Scale Interpreter|
              +--------------------+----------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-4.6: Mandatory Field Assert   |
              +--------------------+----------------+
                                 |
                     All mandatory fields parsed?
                     /                       \
                  YES                         NO
                  /                             \
                 v                               v
    +-------------------------+     +--------------------------+
    | WP-4.7: Type Validation |     | Throw Fatal Exception:   |
    |  (ParsedHeader Output)  |     | FAILURE_PARSING_UNSTRUCT |
    +-------------------------+     +--------------------------+
```

#### 3.4.2 Work Package Detailed Specifications

##### WP-4.1: Token Spatial Alignment
*   **Goal:** Re-group separated token segments into coherent key-value pairs based on vertical and horizontal alignment.
*   **Input:** Unstructured `RecognizedToken[]` arrays.
*   **Deterministic Algorithm:**
    1. Group tokens into logical rows using the spatial overlap formula in Section 1.5.
    2. Sort tokens within each row horizontally by ascending $x_{min}$ coordinate.
    3. Concatenate adjacent tokens where horizontal spacing $dx \le 2.5 \cdot \text{Width}_{char\_avg}$.
*   **Time/Space Complexity:** $\mathcal{O}(N \log N)$ / $\mathcal{O}(N)$.
*   **Parameters:** None.
*   **Failure Conditions:** Token list empty.
*   **Preconditions:** Word boundary spatial measurements complete.
*   **Postconditions:** Ordered, logical lines of key-value text pairs constructed.
*   **Invariants:** Logical row associations are preserved.

##### WP-4.2: Well Name Parsing
*   **Goal:** Extract the legal name of the well log from unstructured rows.
*   **Input:** Aligned key-value row arrays.
*   **Deterministic Algorithm:**
    1. Apply prioritized regular expressions matching well-label prefixes (e.g., `WELL:`, `WELL NAME:`).
    2. Extract the associated value token.
    3. Match extracted values against the official regional well directory using Levenshtein distance:
       If similarity $S_{Lev} \ge \text{OP\_PAR\_LEV\_ACCEPT}$, apply the dictionary substitution.
    4. Resolve ties using Decision Table 2.3.
*   **Time/Space Complexity:** $\mathcal{O}(N \cdot L_{regex})$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_PAR_LEV_ACCEPT`, `OP_PAR_REGEX_PRI`.
*   **Failure Conditions:** String length falls below $1$ character.
*   **Preconditions:** Aligned text rows generated.
*   **Postconditions:** Validated string well name parsed.
*   **Invariants:** Regex templates comply with system rules.

##### WP-4.3: Operator & Field Mapping
*   **Goal:** Parse company operator names and geographical field locations.
*   **Input:** Aligned key-value text rows.
*   **Deterministic Algorithm:**
    Scan text rows for company and geographical labels (e.g., `OPERATOR:`, `FIELD:`). Execute fuzzy catalog checks against the global directories. If an exact match is resolved, apply the confidence modifier `OP_PAR_DICT_CONF`.
*   **Time/Space Complexity:** $\mathcal{O}(N \cdot M_{dict})$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_PAR_DICT_CONF`, `OP_PAR_LEV_ACCEPT`.
*   **Failure Conditions:** None (non-mandatory fields can fall back to `null`).
*   **Preconditions:** Aligned text rows generated.
*   **Postconditions:** Operator and field values resolved.
*   **Invariants:** Matches are mapped to frozen dictionary lists.

##### WP-4.4: UWI and Date Parsing
*   **Goal:** Parse the Unique Well Identifier (UWI) and standard log dates.
*   **Input:** Aligned key-value text rows.
*   **Deterministic Algorithm:**
    1. Scan for `UWI:` or `API NO:` labels, extracting numerical values.
    2. Match dates using pattern sequences listed in `OP_VAL_DATE_FORMATS`.
    3. Reformat dates to strict ISO-8601 (`YYYY-MM-DD`) formatting.
*   **Time/Space Complexity:** $\mathcal{O}(N)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_VAL_DATE_FORMATS`.
*   **Failure Conditions:** UWI parsing contains illegal alphabetic characters when numeric layout is expected.
*   **Preconditions:** Text rows populated.
*   **Postconditions:** Normalized UWI and standard date entries resolved.
*   **Invariants:** Date outputs match standard ISO specifications.

##### WP-4.5: Scientific Depth & Scale Interpreter
*   **Goal:** Extract starting depths, ending depths, unit metrics, and physical log scales.
*   **Input:** Aligned key-value text rows.
*   **Deterministic Algorithm:**
    1. Locate labels `START DEPTH:`, `END DEPTH:`, `BOTTOM DEPTH:`, `DEPTH UNIT:`, and `SCALE:`.
    2. Extract numeric values for depths, converting strings to floating-point numbers.
    3. Extract the scale ratio string (e.g., `'1:200'`).
*   **Time/Space Complexity:** $\mathcal{O}(N)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Depth values contain non-numeric character strings.
*   **Preconditions:** Text rows populated.
*   **Postconditions:** Float depth metrics and scale attributes resolved.
*   **Invariants:** Depths are stored as real floating-point values.

##### WP-4.6: Mandatory Field Completeness Check
*   **Goal:** Ensure all critical well parameters are extracted.
*   **Input:** Parsed field structures.
*   **Deterministic Algorithm:**
    Verify that every field key listed in `OP_PAR_MANDATORY_FIELDS` is populated with a non-null, valid value.
*   **Time/Space Complexity:** $\mathcal{O}(|\text{MandatoryFields}|)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_PAR_MANDATORY_FIELDS`.
*   **Failure Conditions:** Any mandatory field is missing; triggers **`FAILURE_PARSING_UNSTRUCTURED`**.
*   **Preconditions:** All field extraction routines executed.
*   **Postconditions:** Document completeness verified.
*   **Invariants:** Mandatory field list remains constant.

##### WP-4.7: Stage 4 Contract and Type Validation
*   **Goal:** Export structured properties complying with core types.
*   **Input:** Validated fields.
*   **Deterministic Algorithm:**
    Package fields into the typed `ParsedHeader` structure:
    ```typescript
    interface ParsedHeader {
      wellName: string;
      operator: string | null;
      field: string | null;
      uwi: string | null;
      date: string | null;
      startDepth: number;
      endDepth: number;
      depthUnit: string;
      scaleRatio: string;
    }
    ```
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Structural type mapping errors.
*   **Preconditions:** Completeness validations passed.
*   **Postconditions:** Validated `ParsedHeader` structure exported.
*   **Invariants:** Field schema configurations are immutable.

#### 3.4.3 Scientific Verification Point (SVP-4)
*   **Expected Intermediate Outputs:** Well-structured key-value dictionaries with Levenshtein-matched strings.
*   **Acceptance Criteria:** Field Extraction Accuracy ($\text{FEA} \ge 92.0\%$ on Benchmark; $\text{FEA} \ge 85.0\%$ on Stress logs).
*   **Regression Checks:** Ensure that well names are not mapped to wrong lease terms due to Levenshtein distance over-matching.
*   **Benchmark Dataset:** `Golden`, `Benchmark`, `Synthetic`.

---

### 3.5 Stage 5: Confidence Propagation

#### 3.5.1 Flow Diagram
```
              +-------------------------------------+
              |      ParsedHeader & Token Inputs    |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-5.1: Optical Average Geom     |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-5.2: ROI Localization Penal  |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |   WP-5.3: Semantic Dictionary Boost |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |    WP-5.4: Mathematical Metric Clamp|
              +------------------+------------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-5.5: Weighted Composite Synth |
              +--------------------+----------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-5.6: Threshold Verification   |
              +--------------------+----------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-5.7: Stage 5 Type Validation   |
              |     (ConfidenceRecord Output)      |
              +-------------------------------------+
```

#### 3.5.2 Work Package Detailed Specifications

##### WP-5.1: Optical Average Extraction
*   **Goal:** Calculate baseline character-level confidence for each parsed field.
*   **Input:** `ParsedHeader` properties, associated token confidence arrays.
*   **Deterministic Algorithm:**
    For each field $f$, compute the geometric mean of its $n$ character confidence values $c_1, \dots, c_n$:
    $$\bar{C}_{rec}(f) = \left( \prod_{i=1}^n c_i \right)^{1/n}$$
    If $n = 0$, set $\bar{C}_{rec}(f) = 0.0$.
*   **Time/Space Complexity:** $\mathcal{O}(L_{chars})$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Negative confidence values.
*   **Preconditions:** Tokens successfully mapped to fields.
*   **Postconditions:** Grayscale optical averages calculated for all fields.
*   **Invariants:** Baseline averages are bounded by $[0.0, 1.0]$.

##### WP-5.2: Localization Penalty Multiplication
*   **Goal:** Scale field confidence values by the parent well header localization confidence.
*   **Input:** Optical averages, localization score $C_{roi}$.
*   **Deterministic Algorithm:**
    Compute:
    $$C_{penalized}(f) = \bar{C}_{rec}(f) \times C_{roi}$$
*   **Time/Space Complexity:** $\mathcal{O}(1)$ per field / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Localization score $C_{roi}$ is outside $[0.0, 1.0]$.
*   **Preconditions:** Localization score and optical averages computed.
*   **Postconditions:** Penalized confidence values generated.
*   **Invariants:** Score penalization is strictly monotonic.

##### WP-5.3: Semantic Dictionary Adjustments
*   **Goal:** Adjust confidence scores based on lexical directory checks.
*   **Input:** Penalized scores, dictionary search similarity profiles.
*   **Deterministic Algorithm:**
    Adjust confidence based Levenshtein similarity:
    $$C_{adjusted}(f) = C_{penalized}(f) \times S_{Lev}(s_{raw}, s_{dict}) \times \beta$$
    where $\beta = \text{OP\_PAR\_DICT\_CONF}$ for committed dictionary matches, else $\beta = 1.0$.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_PAR_DICT_CONF`.
*   **Failure Conditions:** Adjustments result in negative scores.
*   **Preconditions:** Dictionary similarity metrics calculated.
*   **Postconditions:** Semantically adjusted scores resolved.
*   **Invariants:** Adjustments do not bypass physical boundaries.

##### WP-5.4: Mathematical Metric Clamping
*   **Goal:** Enforce strict mathematical boundaries on propagated scores.
*   **Input:** Adjusted scores $C_{adjusted}(f)$.
*   **Deterministic Algorithm:**
    Clamp all confidence metrics to the interval $[0.0, 1.0]$:
    $$C_f = \max\left(0.0, \, \min(1.0, \, C_{adjusted}(f))\right)$$
*   **Time/Space Complexity:** $\mathcal{O}(1)$ per field / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** None.
*   **Preconditions:** Score adjustment calculations complete.
*   **Postconditions:** Mathematical confidence values $C_f \in [0.0, 1.0]$ locked.
*   **Invariants:** Scores strictly comply with $[0.0, 1.0]$ boundaries.

##### WP-5.5: Weighted Composite Confidence Synthesis
*   **Goal:** Synthesize field-level confidences into a single composite pipeline confidence score.
*   **Input:** Clamped field scores $C_f$.
*   **Deterministic Algorithm:**
    Compute the weighted composite confidence $C_{composite}$:
    $$C_{composite} = w_{name} C_{wellName} + w_{depth} C_{depth} + w_{scale} C_{scale}$$
    where $C_{depth} = \frac{1}{2}(C_{startDepth} + C_{endDepth})$, and weights are defined by the parameter registry.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_CON_W_NAME`, `OP_CON_W_DEPTH`, `OP_CON_W_SCALE`.
*   **Failure Conditions:** Sum of weight parameters $\neq 1.0$.
*   **Preconditions:** Clamped field scores computed.
*   **Postconditions:** Floating point score $C_{composite}$ calculated.
*   **Invariants:** Composite score values are bounded by $[0.0, 1.0]$.

##### WP-5.6: Threshold Verification
*   **Goal:** Assess if the pipeline confidence meets accuracy limits.
*   **Input:** Composite score $C_{composite}$.
*   **Deterministic Algorithm:**
    Verify if the composite confidence meets the minimum threshold:
    $$\text{minimumConfidenceMet} = (C_{composite} \ge \text{OP\_CON\_COMP\_THRES})$$
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_CON_COMP_THRES`.
*   **Failure Conditions:** None (failure state is propagated downstream to Stage 6).
*   **Preconditions:** Composite score $C_{composite}$ synthesized.
*   **Postconditions:** Boolean state flag resolved.
*   **Invariants:** Threshold comparison is evaluated deterministically.

##### WP-5.7: Stage 5 Contract and Type Validation
*   **Goal:** Package confidence metrics into typed structures.
*   **Input:** $C_{composite}$, $\text{minimumConfidenceMet}$.
*   **Deterministic Algorithm:**
    Construct the `ConfidenceRecord` structure:
    ```typescript
    interface ConfidenceRecord {
      minimumConfidenceMet: boolean;
      compositeConfidence: number;
      thresholdUsed: number;
      fieldConfidences: Record<string, number>;
    }
    ```
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Structure generation errors.
*   **Preconditions:** Confidence scores and thresholds evaluated.
*   **Postconditions:** Validated `ConfidenceRecord` structure exported.
*   **Invariants:** Structure definitions remain immutable.

#### 3.5.3 Scientific Verification Point (SVP-5)
*   **Expected Intermediate Outputs:** Well-calibrated confidence records where low-quality scans correlate with low confidence scores.
*   **Acceptance Criteria:** Confidence calibration error ($\text{RMSE}_C \le 0.08$ across all reference runs).
*   **Regression Checks:** Ensure that any degradation in OCR character accuracy results in a proportional decrease in $C_{composite}$.
*   **Benchmark Dataset:** `Golden`, `Benchmark`, `Regression`.

---

### 3.6 Stage 6: Domain Validation

#### 3.6.1 Flow Diagram
```
              +-------------------------------------+
              |   ParsedHeader & ConfRecord Inputs  |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-6.1: Tier 1 Structural Audit |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-6.2: Tier 2 Semantic Audit   |
              +------------------+------------------+
                                 |
                                 v
              +-------------------------------------+
              |     WP-6.3: Tier 3 Scientific Audit |
              +------------------+------------------+
                                 |
                                 v
              +--------------------+----------------+
              |   WP-6.4: Warning & Err Aggregation|
              +--------------------+----------------+
                                 |
                       Is validation successful?
                     /                           \
                  YES                             NO
                  /                                 \
                 v                                   v
    +-------------------------+         +--------------------------+
    | WP-6.5: Final Evaluation|         | Throw Fatal Exception:   |
    | (Export SUCCESS State)  |         | FAILURE_VALIDATION_REJECT|
    +------------+------------+         +--------------------------+
                 |
                 v
    +-------------------------+
    | WP-6.6: S6 Type Valid   |
    | (ValidationResult Out)  |
    +-------------------------+
```

#### 3.6.2 Work Package Detailed Specifications

##### WP-6.1: Tier 1 Structural Auditing
*   **Goal:** Validate structural and syntax schemas for all extracted fields.
*   **Input:** `ParsedHeader` values.
*   **Deterministic Algorithm:**
    Verify extracted strings against structural schemas:
    1. Check if dates comply with ISO-8601 formatting patterns.
    2. Validate UWI codes against standard format lengths.
    Append structural violations to the validation error tracking list.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** None.
*   **Preconditions:** `ParsedHeader` fields populated.
*   **Postconditions:** Structural error arrays updated.
*   **Invariants:** Schema structures remain constant.

##### WP-6.2: Tier 2 Semantic Verification
*   **Goal:** Verify lexical field values against regional catalogs.
*   **Input:** Extracted `wellName`, `operator`, `field`.
*   **Deterministic Algorithm:**
    Verify extracted terms against authorized regional catalogs. If values do not match directory records, append warnings to the tracking lists.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** None.
*   **Preconditions:** Extraction and catalog directories initialized.
*   **Postconditions:** Semantic warning arrays updated.
*   **Invariants:** Directory mappings are immutable.

##### WP-6.3: Tier 3 Scientific Boundary Verification
*   **Goal:** Verify physical and geological boundaries for logging depths and scales.
*   **Input:** Extracted scientific measurements.
*   **Deterministic Algorithm:**
    Verify that scientific measurements comply with physical boundaries:
    1. Confirm starting and ending depth bounds:
       $$startDepth \ge \text{OP\_VAL\_MIN\_DEPTH} \quad \land \quad endDepth \le \text{OP\_VAL\_MAX\_DEPTH}$$
    2. Confirm ending depth is greater than starting depth:
       $$endDepth > startDepth$$
    3. Validate that units and scales match configured options:
       $$depthUnit \in \text{OP\_VAL\_DEPTH\_UNITS} \quad \land \quad scaleRatio \in \text{OP\_VAL\_SCALE\_RATIOS}$$
    Append physical anomalies to the scientific error tracking array.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** `OP_VAL_MIN_DEPTH`, `OP_VAL_MAX_DEPTH`, `OP_VAL_DEPTH_UNITS`, `OP_VAL_SCALE_RATIOS`.
*   **Failure Conditions:** Physical parameters fall outside configured ranges.
*   **Preconditions:** Float depth and scale calculations completed.
*   **Postconditions:** Scientific error tracking arrays updated.
*   **Invariants:** Boundary rules are strictly enforced.

##### WP-6.4: Warning & Error Aggregation
*   **Goal:** Collect and organize all validation anomalies across structural, semantic, and scientific checks.
*   **Input:** Error and warning tracking lists.
*   **Deterministic Algorithm:**
    Consolidate all encountered anomalies into structured lists, categorized by validation tier.
*   **Time/Space Complexity:** $\mathcal{O}(N_{errors})$ / $\mathcal{O}(N_{errors})$.
*   **Parameters:** None.
*   **Failure Conditions:** None.
*   **Preconditions:** Structural, semantic, and scientific evaluations completed.
*   **Postconditions:** Unified anomaly dictionaries populated.
*   **Invariants:** Output arrays remain ordered by severity.

##### WP-6.5: Final Status Evaluation
*   **Goal:** Determine the final pipeline validation state.
*   **Input:** Consolidation error lists, composite confidence score.
*   **Deterministic Algorithm:**
    Evaluate the final pipeline validation status:
    $$isValid = \left( N_{errors} = 0 \quad \land \quad minimumConfidenceMet = \text{true} \right)$$
    If $isValid$ is false, throw the fatal validation exception **`FAILURE_VALIDATION_REJECTED`**.
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** $isValid$ evaluates to false; triggers `FAILURE_VALIDATION_REJECTED`.
*   **Preconditions:** Error collections compiled and confidence records evaluated.
*   **Postconditions:** Validated execution pipeline status returned.
*   **Invariants:** Successful executions are free of structural or scientific errors.

##### WP-6.6: Stage 6 Contract and Type Validation
*   **Goal:** Package final outputs into type-safe validation structures.
*   **Input:** Verification results.
*   **Deterministic Algorithm:**
    Format validation results into the `ValidationResult` structure:
    ```typescript
    interface ValidationResult {
      isValid: boolean;
      header: ParsedHeader;
      structuralErrors: string[];
      semanticErrors: string[];
      scientificErrors: string[];
      warnings: string[];
      confidenceRecord: ConfidenceRecord;
    }
    ```
*   **Time/Space Complexity:** $\mathcal{O}(1)$ / $\mathcal{O}(1)$.
*   **Parameters:** None.
*   **Failure Conditions:** Structural type mapping errors.
*   **Preconditions:** Validation checks passed.
*   **Postconditions:** Immutable `ValidationResult` structure exported.
*   **Invariants:** All outputs comply with core system contracts.

#### 3.6.3 Scientific Verification Point (SVP-6)
*   **Expected Intermediate Outputs:** Detailed validation results listing encountered warnings or structural anomalies.
*   **Acceptance Criteria:** Accurate error categorization and rejection of out-of-bounds inputs.
*   **Regression Checks:** Ensure that valid logs are never falsely rejected due to boundary tuning variations.
*   **Benchmark Dataset:** `Golden`, `Stress`, `Synthetic`.

---

## 4. Formal Specification Freeze Review

### 4.1 Traceability Verification Check
The CitraNeura Scientific Verification Board confirms that this formal specification establishes complete coverage of all core requirements. Every algorithmic stage has been mapped to its respective parameter bounds, error states, and validation checks.

### 4.2 Behavior Locking Directive
By certifying this Milestone **OCR-IMP-05** as **PASS**, the specification is officially **FROZEN**. No runtime heuristics, magic numbers, or custom behavior overrides may be introduced during implementation. Coding phase transitions must follow a literal translation of this document into TypeScript, ensuring strict compliance with all system contracts and scientific verification points.

---
*CitraNeura Scientific Verification Board (SVB)*  
*CitraNeura Core Architecture Board (CAB)*  
*CitraNeura System Security Division (SSD)*  
*Status: CERTIFIED & ENFORCED*  
