# Scientific Acceptance Criteria (SAC)

**Project:** CitraNeura Petrophysical Digitizer  
**Subject:** Pass/Fail Specifications for the Auto Trace Algorithm Validation  
**Status:** Design Phase (Pre-Implementation) - **FROZEN (v1.0 Specification)**

This document defines the quantitative Scientific Acceptance Criteria (SAC) that govern the evaluation of the Auto Trace algorithm. Every implementation, update, or parameter tuning of the algorithm must be tested against these criteria using the Scientific Validation Framework.

---

## 1. Measured Metrics & Standard Measurement Procedures

### 1.1 Root Mean Square Error (RMSE)
*   **Definition:** The standard deviation of the residuals (digitization errors) between the extracted pixel coordinates and the established ground-truth LAS coordinates after cross-correlation depth alignment.
*   **Procedure:** Extract points along the curve. Align with ground truth using dynamic time warping or cross-correlation to eliminate physical scan offsets. Compute the RMSE in the scientific domain (e.g., API for Gamma Ray, g/cc for Density).

### 1.2 Completion Rate (CR)
*   **Definition:** The percentage of the target curve successfully traced by the algorithm before terminating due to the maximum gap threshold.
*   **Procedure:** Divide the length of the valid digitized segment (in depth units) by the total known depth interval of the curve in the region of interest.

### 1.3 Crossing Success Rate (CSR)
*   **Definition:** The algorithm's ability to maintain the correct trajectory when the target curve intersects with another curve or dense grid line.
*   **Procedure:** Identify $N$ known curve crossings in the validation dataset. A crossing is successfully navigated if the digitized path exits the intersection on the correct physical trajectory without deviating onto the intersecting line. $\text{CSR} = (\text{Successful Crossings} / N) \times 100$.

### 1.4 Gap Recovery Rate (GRR)
*   **Definition:** The ability to bridge physical dropouts, faded ink, or text annotations that interrupt the curve.
*   **Procedure:** Identify $M$ known gaps in the validation dataset (where ink density drops below human visual threshold). A gap is successfully recovered if the algorithm reconnects to the correct curve on the other side without terminating. $\text{GRR} = (\text{Recovered Gaps} / M) \times 100$.

### 1.5 False Merge Rate (FMR)
*   **Definition:** The frequency at which the algorithm incorrectly snaps to a parallel or adjacent curve of a similar color/structure.
*   **Procedure:** Track the number of times the digitized path deviates from the ground truth by more than $3\sigma$ (where $\sigma$ is the line width) and stays on the incorrect trajectory for more than 10 pixels.

### 1.6 Computational Performance
*   **Runtime:** The time taken to execute a trace over a standard 5000-pixel vertical depth block.
*   **Memory Usage:** The peak RAM allocated by the Web Worker/process during the extraction of a single tile/block.
*   **Procedure:** Measured using standard browser performance profiling tools on a baseline client hardware configuration.

### 1.7 Confidence Quality
*   **Definition:** The correlation between the algorithm's reported uncertainty (Inverse Path Cost) and the actual spatial error.
*   **Procedure:** Group digitized points into confidence bins (e.g., 0.8-1.0, 0.5-0.8, <0.5). Calculate the mean spatial error for each bin. The mean error must monotonically increase as the reported confidence decreases.

---

## 2. Acceptance Thresholds

For an Auto Trace implementation or parameter set to be considered scientifically valid, it must meet or exceed the following thresholds on the standard Real-World Validation Dataset:

| Metric | Acceptance Threshold | Condition |
| :--- | :--- | :--- |
| **RMSE** | $\le 1.5\%$ of curve's physical scale | e.g., $\le 2.25$ API for a $0-150$ API GR curve. |
| **Completion Rate (CR)** | $\ge 95\%$ | Across contiguous log sections without major physical tears. |
| **Crossing Success Rate (CSR)**| $\ge 90\%$ | Must successfully coast through standard intersections. |
| **Gap Recovery Rate (GRR)** | $\ge 85\%$ | For gaps $\le \tau_{gap}$ pixels in length. |
| **False Merge Rate (FMR)** | $\le 1$ per 10,000 pixels | Snapping to wrong curves must be extremely rare. |
| **Runtime** | $\le 3.0$ seconds | Per 5000 vertical pixels traced. |
| **Memory Usage** | $\le 150$ MB peak | Ensuring stability in browser environments. |
| **Confidence Quality**| Monotonic | Low confidence MUST correlate with high actual error. |

---

## 3. Go/No-Go Decision Rules

When evaluating a proposed change (whether algorithmic optimization, code refactoring, or default parameter adjustment), the following strict decision matrix applies:

1.  **Strict Failure (No-Go):** If the proposed change causes *any* metric to fall below its Acceptance Threshold, the change is rejected.
2.  **Regression Failure (No-Go):** If the proposed change decreases the Completion Rate, CSR, or GRR, or increases the RMSE or FMR compared to the currently deployed v1.0 baseline, the change is rejected, *even if it remains above the acceptance thresholds*. Scientific accuracy cannot be traded for speed.
3.  **Performance Trade-off (Go):** A change that significantly improves Runtime or Memory Usage while keeping all scientific metrics exactly mathematically identical (or statistically indistinguishable) to the baseline is accepted.
4.  **Scientific Improvement (Go):** A change that reduces RMSE or increases completion/recovery rates, while keeping runtime $\le 3.0$ seconds and memory $\le 150$ MB, is accepted and becomes the new baseline.

---

## 4. Specification Freeze (Auto Trace v1.0 Specification)

With the establishment of the Architecture Design Document (ADD), the Parameter Specification, the Algorithm Contract, and these Scientific Acceptance Criteria, the design phase of Auto Trace is officially **FROZEN**. 

These four documents collectively form the **Auto Trace v1.0 Specification**. 

The project now officially transitions from the *Algorithm Design Phase* to the *Engineering Execution Phase*. Any deviation from these documents during implementation is considered an architectural violation. The immediate next step is the software implementation of the Directional A* Proof-of-Concept in strict compliance with this v1.0 specification.
