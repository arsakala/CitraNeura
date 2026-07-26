# Parameter Specification & Calibration

**Project:** CitraNeura Petrophysical Digitizer  
**Subject:** Free Parameters for the Unified Cost Function (Auto Trace)  
**Status:** Design Phase (Pre-Implementation)  

This document serves as a companion to the Auto Trace Architecture Design Document (ADD). It formally defines all free parameters and weights present in the observation models, state space transitions, and unified cost function. Rigorous parameter specification ensures the algorithmic behavior is mathematically bounded and physically meaningful across diverse well log datasets.

---

## 1. Observation Parameters

### 1.1 Color Tolerance Threshold ($E_{max}$)
*   **Definition**: The maximum perceptual color distance (CIELAB $\Delta E$) at which a pixel reaches a normalized color cost of $1.0$. It bounds the radiometric observation model.
*   **Allowed Range**: $[10.0, 100.0]$
*   **Default Value**: $40.0$
*   **Effect on Behavior**: A low $E_{max}$ makes the tracker extremely strict, easily breaking on faded ink. A high $E_{max}$ makes the tracker permissive, potentially bleeding into dark grid lines or intersecting curves.
*   **Sensitivity**: Moderate. Small changes ($\pm 5$) shift the confidence gradient slightly but rarely cause catastrophic failure.
*   **Calibration Method**: Adaptive. Initially seeded by the variance of the pixels immediately surrounding the user's starting click.
*   **Validation Strategy**: Evaluate against logs with faded ink (requiring high tolerance) versus logs with dense black grids overlapping blue curves (requiring strict tolerance).

### 1.2 Structural Scale / Line Width ($\sigma$)
*   **Definition**: The standard deviation of the Gaussian kernel used to compute the local Hessian matrix for Frangi ridgeness and orientation. It corresponds to the physical thickness of the curve being traced.
*   **Allowed Range**: $[0.5, 5.0]$ pixels
*   **Default Value**: $1.5$ (optimal for $\sim 2-3$ pixel line widths at standard 300 DPI)
*   **Effect on Behavior**: If $\sigma$ is too small, the Hessian filter responds to background noise and paper grain. If $\sigma$ is too large, it blurs the curve into adjacent grid lines and fails to localize the exact centerline.
*   **Sensitivity**: High. An incorrect $\sigma$ completely invalidates $M_{ridge}$ and $M_{orient}$.
*   **Calibration Method**: Data-driven scaling based on the raster's physical DPI (e.g., $\sigma \propto \text{DPI}/150$). Alternatively, multi-scale integration (taking the maximum response across $\sigma \in \{1.0, 2.0, 3.0\}$).
*   **Validation Strategy**: Test across the "Low-Resolution (75 DPI)" and "Reference Quality (600 DPI)" datasets to verify scale independence.

---

## 2. Kinematic & State Space Parameters

### 2.1 Maximum Turning Angle ($\theta_{max}$)
*   **Definition**: The maximum permitted absolute difference in heading angle between consecutive states in the A* graph ($|\theta_i - \theta_{i-1}| \le \theta_{max}$).
*   **Allowed Range**: $[0, \pi/2]$ radians ($0^\circ$ to $90^\circ$).
*   **Default Value**: $\pi/4$ ($45^\circ$).
*   **Effect on Behavior**: Acts as a hard topological constraint. It prevents the algorithm from making physically impossible U-turns or snapping orthogonally onto a horizontal depth grid line.
*   **Sensitivity**: Low. As long as it accommodates the sharpest valid geological spikes (which rarely exceed $45^\circ$ between adjacent pixels), it acts safely as a pruning mechanism to speed up A*.
*   **Calibration Method**: Fixed structural constant.
*   **Validation Strategy**: Verify against logs containing sharp lithological transitions (e.g., abrupt shale-to-sandstone boundaries) to ensure peaks are not clipped.

### 2.2 Maximum Gap Tolerance ($\tau_{gap}$)
*   **Definition**: The threshold for accumulated traversal cost ($\sum C(s_{i-1}, s_i)$) over regions where local observations provide no evidence (i.e., cost $\approx 1.0$). 
*   **Allowed Range**: $[10.0, 500.0]$
*   **Default Value**: $100.0$ (roughly corresponding to coasting blindly for 100 pixels).
*   **Effect on Behavior**: Controls how aggressively the algorithm attempts to bridge missing data, tears, or text annotations. Too high, and it will invent arbitrary paths through white space. Too low, and it will terminate prematurely at minor ink dropouts.
*   **Sensitivity**: Moderate. Dictates termination behavior.
*   **Calibration Method**: Manual. Exposed to the user as a "Gap Bridging Aggressiveness" slider.
*   **Validation Strategy**: Test against legacy paper logs containing physical tears, pencil annotations crossing the curve, and fading.

---

## 3. Unified Cost Weights

The cost function is $C = w_1 M_{color} + w_2 M_{ridge} + w_3 M_{orient} + w_4 M_{momentum}$, subject to $\sum w_k = 1.0$.

### 3.1 Color Weight ($w_1$)
*   **Definition**: Importance of radiometric similarity to the target curve.
*   **Allowed Range**: $[0.0, 1.0]$
*   **Default Value**: $0.40$
*   **Effect & Sensitivity**: Primary driver for keeping the trace on the correct curve when multiple curves run parallel. High sensitivity during curve crossings.
*   **Calibration**: Empirically tuned.

### 3.2 Ridgeness Weight ($w_2$)
*   **Definition**: Importance of morphological tubular structure.
*   **Allowed Range**: $[0.0, 1.0]$
*   **Default Value**: $0.25$
*   **Effect & Sensitivity**: Prevents the tracer from wandering into color-matched noise patches or stains that lack line structure.

### 3.3 Orientation Alignment Weight ($w_3$)
*   **Definition**: Importance of agreeing with the local physical tangent of the ink.
*   **Allowed Range**: $[0.0, 1.0]$
*   **Default Value**: $0.15$
*   **Effect & Sensitivity**: Essential for intersection handling. When approaching an intersection, this weight strongly discourages the tracker from turning onto the crossing curve, as doing so would violate the local tangent orientation of the *current* curve path.

### 3.4 Kinematic Momentum Weight ($w_4$)
*   **Definition**: Importance of maintaining the previous traversal heading (inertia).
*   **Allowed Range**: $[0.0, 1.0]$
*   **Default Value**: $0.20$
*   **Effect & Sensitivity**: High sensitivity for gap bridging. In areas of pure white space ($M_{color} \approx 1, M_{ridge} \approx 1$), momentum is the *only* factor differentiating paths. It forces the A* search to project a straight line across the void until evidence is reacquired.
*   **Calibration**: Tuned in tandem with $w_3$ to ensure smooth behavior through high-noise regions.

---

## 4. Calibration & Validation Strategy

The unified algorithm minimizes arbitrary trial-and-error by isolating parameters to physical phenomena:
1.  **Color ($E_{max}$)** handles *fading*.
2.  **Scale ($\sigma$)** handles *DPI and line thickness*.
3.  **Weights ($w_k$)** handle *topological logic* (intersections and gaps).

**Next Step for Proof-of-Concept**: The initial implementation should expose these parameters via a debug control panel. The Scientific Validation Framework (developed in the previous iteration) will then be used to objectively measure the RMSE and completion rate across the 6 real-world log cases, allowing us to perform a data-driven grid search to lock in the optimal default weights.
