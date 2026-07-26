# Algorithm Contract & Versioning Specification

**Project:** CitraNeura Petrophysical Digitizer  
**Subject:** Governance and Versioning for the Auto Trace Algorithm  
**Status:** Design Phase (Pre-Implementation)  

This document defines the formal contract for the Auto Trace algorithm. To ensure the scientific validity and reproducibility of digitized well logs, the underlying extraction algorithm must be mathematically stable. Changes to the algorithm must be strictly versioned and validated. This contract separates the fundamental mathematical formulation (immutable without version bump) from engineering optimizations (mutable).

---

## 1. Immutable Components (Core Scientific Identity)
The following components constitute the mathematical identity of the Auto Trace algorithm. Any alteration to these definitions **requires a major version increment** (e.g., from v1 to v2) because it fundamentally changes how the algorithm interprets the physical evidence in the raster.

*   **Problem Formulation**: The definition of the extraction as a minimum-cost path optimization problem over an $(x, y, \theta)$ state space.
*   **Observation Semantics**: The reliance on specific physical phenomena for evidence:
    *   CIELAB $\Delta E$ for radiometric distance.
    *   Hessian-based eigenvalues (Frangi measure) for topological ridgeness.
    *   Hessian eigenvectors for local orientation.
*   **Unified Cost Function Equation**: The linear combination of normalized observation costs and kinematic momentum: $C = w_1 M_{color} + w_2 M_{ridge} + w_3 M_{orient} + w_4 M_{momentum}$.
*   **Optimization Objective**: The goal to minimize the total accumulated energy functional $\sum C(s_{i-1}, s_i)$.

If a developer decides to replace the CIELAB distance with RGB thresholding, or replaces the A* search with an active contour (Snake) model, the algorithm is no longer "Auto Trace v1".

---

## 2. Mutable Components (Engineering Implementation)
The following components dictate *how* the mathematical formulation is executed in software. These may be modified, optimized, or rewritten to improve speed, memory usage, or UI responsiveness **without requiring a major version increment**.

*   **Internal Data Structures**: Priority queues for A*, memory layouts for Hessian matrices, graph node representations.
*   **Heuristics in A***: The function $h(s)$ used to guide the A* search, provided it remains admissible (does not overestimate the true cost) and guarantees the optimal path.
*   **Execution Architecture**: Migration from synchronous execution to Web Workers, WebAssembly (WASM), or WebGPU.
*   **Memory Management**: Tile sizes requested from the `VirtualRaster`, caching strategies, and garbage collection optimizations.
*   **Image Filtering Implementations**: The specific numerical library or shader used to compute the Bilateral Filter or Hessian matrix, provided the mathematical output remains equivalent.

---

## 3. Rules for Parameter Tuning and Defaults
The unified cost function exposes several free parameters ($E_{max}, \sigma, w_1 \dots w_4, \theta_{max}, \tau_{gap}$). 

*   **UI Adjustments**: Users may adjust these parameters at runtime. This does not constitute an algorithmic change. The chosen parameters must simply be recorded in the final digitized dataset metadata.
*   **Changing System Defaults**: A developer may propose changing the default values of these parameters for newly initialized traces. 
    *   **Requirement**: The proposed defaults *must* be proven superior by running the Scientific Validation Framework (RMSE benchmark) across the established Real-World Validation Dataset. 
    *   **Documentation**: The benchmark results proving a net increase in completion rate or a net decrease in RMSE must be documented in a pull request. Arbitrary "tweaks" based on a single visually appealing test case are strictly forbidden.

---

## 4. Compatibility Criteria (v1 vs. v2)
To determine if an update breaks compatibility:

*   **v1 (Current Specification)**: Any algorithm that optimizes the continuous CIELAB+Hessian cost surface over an $(x, y, \theta)$ graph. Two different v1 implementations given the exact same raster, seed point, and parameter set *must* produce topologically identical centerlines (minor sub-pixel floating-point variations are acceptable).
*   **v2 (Future Architectures)**: Any algorithm that introduces a fundamentally different mechanism for curve extraction. Examples of v2 architectures include:
    *   Replacing the analytical Hessian/Color models with a trained Machine Learning model (e.g., CNN or U-Net).
    *   Changing the underlying objective from a 1D path search to a 2D region-growing or semantic segmentation model.

---

## 5. Mandatory Validation Requirements
No code modifying the Auto Trace algorithm (mutable or immutable) may be merged or deployed without satisfying the following:

1.  **Zero-Regression on Mathematical Identity**: The Scientific Validation Framework must be run.
2.  **Visual Proof of Concept**: The developer must demonstrate that the algorithm successfully navigates a crossing curve and bridges a standard gap without catastrophic failure.
3.  **Performance Envelope**: The tracing speed must remain interactive. A single trace covering a 5000-pixel vertical depth should execute in under 3.0 seconds on a standard client machine. If a mutable optimization degrades performance below this threshold, it must be rejected even if mathematically correct.

By adhering to this contract, the CitraNeura digitizer ensures that its automated extraction remains scientifically defensible, transparent, and immune to uncalibrated technical drift.
