# Auto Trace Architecture Design Document (ADD)

**Project:** CitraNeura Petrophysical Digitizer  
**Subject:** Scientific Redesign of the Auto Trace Algorithm  
**Status:** Design Phase (Pre-Implementation)  

---

## 1. Introduction
The current Auto Trace algorithm employs a row-by-row scanning heuristic with basic RGB thresholding. While lightweight, it is a proof-of-concept that fundamentally fails on complex topologies (crossings, gaps, horizontal excursions, and noise). 

This Architecture Design Document (ADD) proposes a mathematically rigorous, structurally robust algorithm rooted in scientific image processing and graph theory. The goal is to design an algorithm that prioritizes scientific validity, repeatability, and robustness over arbitrary heuristics.

---

## 2. Mathematical Formulation

Before selecting a specific optimization algorithm, the curve tracing task must be formalized mathematically. This specification is agnostic to the eventual solver (A*, Dynamic Programming, etc.).

### 2.1 Problem Definition
*   **Input**: 
    *   A 2D raster image $I: \Omega \rightarrow \mathbb{R}^3$, where $\Omega \subset \mathbb{Z}^2$ is the discrete pixel domain, and the channels represent RGB color values.
    *   An initial seed point $p_0 = (x_0, y_0) \in \Omega$ and initial heading vector $\theta_0$, usually provided by the user's click.
    *   A reference target color $C_{target}$.
*   **Output**: An ordered sequence of points $P = \{p_0, p_1, \dots, p_n\}$ where $p_i \in \Omega$, representing the physical centerline of the digitized curve.
*   **Domain Mapping**: The mapping from the pixel domain $(x, y)$ to the scientific domain $(value, depth)$ is defined by an external affine or non-linear transformation $T(x,y) \rightarrow (v, d)$. The extraction logic operates strictly within the pixel domain $\Omega$.

### 2.2 Measurement & Observation Model
The evidence that a pixel $p=(x,y)$ belongs to the target curve is modeled via specific observations derived from the raw image. To construct a balanced cost function, each observation must be rigorously defined, normalized to a common scale $[0, 1]$, and mathematically justified as a cost penalty or likelihood.

1.  **Color Distance ($M_{color}$)**:
    *   **Definition**: The perceptual distance between the pixel's color $I(p)$ and the target color $C_{target}$.
    *   **Measurement**: $\Delta E_{LAB}(I(p), C_{target})$ computed in the CIELAB color space.
    *   **Range & Normalization**: $\Delta E$ values typically range from 0 (perfect match) to $\sim 100$ (opposite colors). We normalize this into a cost using a clamped linear function: $M_{color}(p) = \min(1.0, \frac{\Delta E}{E_{max}})$, where $E_{max}$ is a tolerance threshold.
    *   **Justification**: Treated as a direct cost. Pixels with colors vastly different from the target should incur maximum penalty (cost approaching 1), preventing the trace from snapping to unrelated curves or grid lines.

2.  **Structural Ridgeness ($M_{ridge}$)**:
    *   **Definition**: The morphological probability that $p$ resides on a line-like (tubular) structure, filtering out blobs or uniform backgrounds.
    *   **Measurement**: The Frangi vesselness measure $V(p)$, derived from the eigenvalues ($\lambda_1, \lambda_2$) of the local Hessian matrix. For a dark line on a light background, we look for $\lambda_1 \approx 0$ and $\lambda_2 \gg 0$.
    *   **Range & Normalization**: The Frangi filter outputs a likelihood $L_{ridge}(p) \in [0, 1]$, where 1 indicates a perfect ridge. We transform this likelihood into a cost: $M_{ridge}(p) = 1 - L_{ridge}(p)$.
    *   **Justification**: Treated as an inverse likelihood (cost). It forces the algorithm to stay within the structural boundaries of the curve, even if the ink color has faded.

3.  **Orientation Alignment ($M_{orient}$)**:
    *   **Definition**: The agreement between the tracker's proposed traversal direction ($\theta$) and the physical curve's local tangent.
    *   **Measurement**: The principal eigenvector $\vec{v}_1$ of the Hessian matrix provides the local curve orientation $\theta_{pixel}$.
    *   **Range & Normalization**: The angular difference $\Delta \theta = |\theta - \theta_{pixel}|$. Since curves are undirected locally, $\Delta \theta \in [0, \pi/2]$. The cost is normalized as $M_{orient}(p, \theta) = 1 - \cos(2 \cdot \Delta \theta)$.
    *   **Justification**: Treated as a directional cost penalty. It prevents the tracer from moving orthogonally to the physical ink trace (e.g., arbitrarily crossing a line rather than following it).

These normalized measurements ($M_{color}$, $M_{ridge}$, $M_{orient}$) share a uniform $[0, 1]$ scale, allowing them to be linearly combined without one arbitrarily dominating the others due to mismatched physical units.

### 2.3 Unified Cost Function
The total cost of traversing from a state $s_{i-1}$ to $s_i$ integrates the normalized observation models and the internal kinematic momentum. Let $s_i = (x_i, y_i, \theta_i)$ be the current state. The transition cost function $C(s_{i-1}, s_i)$ is formulated as:

$$C(s_{i-1}, s_i) = w_1 \cdot M_{color}(x_i, y_i) + w_2 \cdot M_{ridge}(x_i, y_i) + w_3 \cdot M_{orient}(x_i, y_i, \theta_i) + w_4 \cdot M_{momentum}(s_{i-1}, s_i)$$

Where:
*   **$M_{color}$, $M_{ridge}$, $M_{orient}$**: The normalized $[0, 1]$ observational costs defined in Section 2.2.
*   **$M_{momentum}$**: $1 - \cos(\theta_i - \theta_{i-1})$, the kinematic penalty for angular deviation from the previous state. This internal regularizer ensures curve smoothness and provides the inertia required to bridge intersecting lines and gaps.
*   $w_1, w_2, w_3, w_4$ are non-negative tunable weights ($\sum w_k = 1$) dictating the algorithm's reliance on color, structural ridgeness, tangent alignment, and momentum.

### 2.4 Optimization Objective
Curve extraction is formulated as finding the optimal path $P^*$ that minimizes the total accumulated energy functional:

$$P^* = \arg\min_{P} \sum_{i=1}^{n} C(s_{i-1}, s_i)$$

Subject to local continuity constraints. This transforms heuristic pixel-following into a formal minimum-cost path optimization problem.

### 2.5 State Space
To handle line intersections and crossing curves properly, the extraction does not operate purely on 2D coordinates. The state space is augmented to 3D:
*   **State Variable**: $s = (x, y, \theta) \in \mathbb{Z}^2 \times [0, 2\pi)$, where $\theta$ is the arrival angle.
*   **Transition Rules**: A transition from $s_{i-1}$ to $s_i$ is only valid if:
    1.  The spatial distance $|| (x_i, y_i) - (x_{i-1}, y_{i-1}) || \le \sqrt{2}$ (e.g., 8-connected Moore neighborhood).
    2.  The angular change $|\theta_i - \theta_{i-1}| \le \theta_{max}$ (preventing impossible sharp turns or reversals).

### 2.6 Termination Criteria
The path expansion terminates deterministically under any of the following conditions:
1.  **Boundary Reached**: $(x_i, y_i)$ reaches the defined boundaries of the active region of interest (ROI) or the edge of the log.
2.  **Maximum Gap Threshold**: The accumulated cost over a consecutive sequence of pixels exceeds a threshold $\tau_{gap}$. This occurs when the algorithm traverses pure white space or severe noise for too long without re-acquiring the target curve.
3.  **Local Minimum Trap**: The algorithm forms a closed loop or oscillates (detected via visited state history), indicating a failure to progress.

---

## 3. Literature Review: Well Log Digitization
In the domain of scientific raster analysis and curve extraction, algorithms generally fall into three categories:
1. **Morphological Thinning / Skeletonization:** Reduces thresholded binary images to 1-pixel wide lines. *Limitation:* Highly sensitive to noise and thresholding artifacts. Fails completely at intersections (creates arbitrary branching topologies).
2. **Active Contours (Snakes):** Fits a parametric spline to image gradients. *Limitation:* Frequently gets trapped in local minima (e.g., snapping to an adjacent grid line instead of the curve) and struggles with sharp lithological spikes.
3. **Graph-based Path Search (Dynamic Programming / Dijkstra / A*):** Formulates tracking as a minimum-cost path problem over a spatial graph. *Advantage:* Naturally handles gaps, intersections, and noise by integrating local image evidence with global geometric constraints. This is the state-of-the-art for semi-automated tracking of filamentous structures (medical imaging, seismic tracking, and log tracing).

**Conclusion:** We will adopt a **Graph-based Path Search (Directional A*)** driven by a mathematically defined continuous cost-surface.

---

## 4. Tahap 1 — Image Preprocessing
Before tracking, the raw raster must be conditioned to reduce noise while preserving high-frequency curve structures (lithological spikes).

### Candidates Evaluated:
*   **Gaussian Blur:** Over-smoothes, causing thin lines to wash out. (Rejected)
*   **Median Filter:** Excellent for salt-and-pepper noise, but can break continuous thin lines into dotted segments. (Rejected)
*   **CLAHE:** Enhances local contrast, but frequently amplifies background paper texture and grid lines into prominent artifacts. (Rejected for primary tracking)
*   **Bilateral Filter:** Non-linear, edge-preserving, and noise-reducing. It averages pixels based on both spatial proximity and radiometric (color) similarity.

### Selected Approach: Bilateral Filtering (or Guided Image Filtering)
**Why:** It smooths the yellowed/noisy paper background while keeping the sharp gradients of the ink traces perfectly intact. 

---

## 5. Tahap 2 — Color Representation
The algorithm must distinguish between multiple colored curves, dark grid lines, and faded backgrounds.

### Candidates Evaluated:
*   **RGB:** Channels are highly correlated. Euclidean distance in RGB space does not match human perceptual color difference. Faded red ink and dark gray grids are mathematically difficult to separate. (Rejected)
*   **HSV/HSL:** Good channel separation, but hue becomes unstable and meaningless at low saturations (e.g., when the curve becomes dark/faded). (Rejected)
*   **CIELAB (L*a*b*):** A perceptually uniform color space. L* isolates luminosity (light/dark), while a* and b* represent chromaticity independent of lighting. 

### Selected Approach: CIELAB (L*a*b*) Distance
**Why:** The Euclidean distance in CIELAB space ($\Delta E$) represents true perceptual color difference. A target color (e.g., red ink) can be robustly identified even if it fades to a lighter red, by projecting the pixels into CIELAB space and calculating $\Delta E$ to the reference color.

---

## 6. Tahap 3 — Curve Segmentation (Cost Map Generation)
We do not want a binary segmentation (1 for curve, 0 for background), because binary decisions destroy sub-pixel information and create irreversible failure states. Instead, we generate a continuous **Cost Map**.

### Cost Map Formulation:
The cost of a pixel $C(x,y)$ is derived from two components:
1.  **Color Cost ($C_{color}$):** Based on the CIELAB $\Delta E$ distance to the user-selected trace color.
2.  **Structural Cost ($C_{ridge}$):** Using **Hessian-based Ridge Detection (Frangi Filter)**. By computing the eigenvalues of the Hessian matrix at each pixel, we can mathematically determine if a pixel belongs to a "tubular" or line-like structure, ignoring blob-like noise or flat backgrounds.

### Selected Approach: Soft Cost Map (Color + Hessian Ridge)
**Why:** This creates a continuous topological "valley" along the curve. The tracking algorithm will simply flow down the deepest part of this valley.

---

## 7. Tahap 4 — Curve Tracking
This is the core traversal mechanism.

### Candidates Evaluated:
*   **Row-by-Row Scan:** Fails completely when a curve goes horizontal or reverses depth temporarily (common in highly deviated wells or scanner skew). (Rejected)
*   **Dynamic Programming (DP):** Efficient, but assumes the curve only progresses monotonically in one direction (usually Y). Struggles with sharp horizontal excursions. (Rejected)
*   **Dijkstra's Algorithm:** Optimal, but explores uniformly in all directions, making it computationally heavy for long traces.
*   **Directional A* Search:** Heuristic-driven graph search.

### Selected Approach: Directional A* Search in $(x, y, \theta)$ State Space
**Why:** Standard A* operates in 2D space $(x,y)$. We will elevate the search space to 3D: $(x, y, \theta)$, where $\theta$ is the current heading vector of the curve.
*   **State:** A node is defined by its position and the angle it arrived from.
*   **Transitions:** The algorithm can only move to neighbors that satisfy a maximum turning angle (e.g., no 180-degree U-turns).
*   **Heuristic:** A directed distance towards the overall downward progression of the log.

---

## 8. Tahap 5 — Crossing Handling (Intersections & Overlaps)
When a Red curve and a Blue curve cross, the physical ink mixes, usually appearing black or dark brown at the intersection point. Color segmentation alone fails here.

### Solution via $(x, y, \theta)$ State Space:
Because our A* graph includes the heading angle $\theta$, the cost function incorporates a **Momentum Penalty** (Curvature Cost). 
*   When the algorithm enters an intersection (where color evidence drops), the path of least resistance is to *maintain its current heading*.
*   Turning 90 degrees to follow the crossing curve incurs a massive momentum penalty.
*   Therefore, the algorithm "coasts" straight through intersections seamlessly until it picks up the strong color evidence on the other side.

---

## 9. Tahap 6 — Gap Recovery
Gaps occur due to faded ink, paper tears, or scanner dropouts.

### Solution via Soft Cost Map:
Because we do not use strict binary thresholding, "white paper" simply has a high (but finite) cost.
*   If the curve disappears, the A* algorithm will expand into the high-cost white space.
*   Driven by the momentum constraint, it will push straight forward across the gap.
*   If it finds the curve again on the other side, it bridges the gap perfectly.
*   We cap the maximum accumulated gap cost. If the algorithm wanders in white space too long without finding a curve, it gracefully terminates, marking the end of the trace segment.

---

## 10. Tahap 7 — Uncertainty Estimation
Uncertainty must be mathematically derived from the tracking process itself.

### Solution: Inverse Path Cost
The confidence $U(p)$ at any point $p$ along the digitized trace is directly proportional to the local node cost in the A* graph.
*   **High Confidence (1.0):** The path moves through pixels with low $\Delta E$ (perfect color match) and high Frangi ridgeness.
*   **Low Confidence (0.1 - 0.4):** The path is moving through a gap (high color cost) or an intersection (relying purely on momentum).
This allows the UI to render the digitized line with color-coded confidence gradients, instantly directing the petrophysicist to areas requiring manual QA.

---

## 11. Tahap 8 — Computational Complexity & Scalability

### Complexity Analysis
1.  **Preprocessing (Bilateral + CIELAB):** $O(N)$ where $N$ is the number of pixels in the local ROI tile. 
2.  **Hessian/Ridge Detection:** $O(N \log N)$ for convolution steps.
3.  **A* Graph Search:** $O(|E| + |V| \log |V|)$. Since we restrict search to a local neighborhood (corridor) and use a directed heuristic, the effective $|V|$ is extremely small compared to the whole image.

### Scalability & Implementation Architecture
*   **Tile-Based Friendly:** The algorithm operates entirely on local evidence. We do not need the entire raster in RAM. We request small tiles (e.g., 512x512) from the `VirtualRaster` as the A* algorithm progresses downwards.
*   **Web-Worker Architecture:** 
    *   Main Thread: Handles UI and renders the trace.
    *   Worker Thread: Runs the CIELAB conversion, Hessian filtering, and A* search asynchronously, passing digitized points back to the main thread via message passing.
*   **Memory Profile:** Excellent. Only the active tile's cost map is kept in memory.

---

## 12. Summary & Next Steps
This design shifts the paradigm from a brittle **"heuristic pixel-chaser"** to a robust **"optimal pathfinder over a mathematical cost surface."**

1.  It is fundamentally immune to the crossing-curve problem.
2.  It gracefully handles gaps via momentum.
3.  It produces native uncertainty metrics.
4.  It treats color perceptually correctly.

**Recommendation:** Freeze the ADD and proceed to implement a proof-of-concept of the **Directional A* Cost Map Tracer** in an isolated Web Worker.
