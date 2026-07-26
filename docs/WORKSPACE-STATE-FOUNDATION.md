# Workspace State Foundation (Checkpoint P-01)

This document establishes the official architectural audit of the **Workspace State Foundation** for the CitraNeura platform transition. It mathematically and programmatically verifies that all application states are governed under a **Single Ownership Model** centered in the parent Workspace coordinator (`DigitizerWorkspace`), with zero circular dependencies and consistent, complete lifecycle tracks.

---

## 1. Workspace State Diagram

The following structural diagram represents the hierarchy of state ownership inside the CitraNeura application. The top-level `Workspace` (`DigitizerWorkspace`) serves as the central state orchestrator and is the sole direct parent and owner of all subsystem states.

```text
Workspace (DigitizerWorkspace)
│
├── Raster Session State
│   ├── rasterUrl (String)
│   ├── virtualRaster (VirtualRaster instance)
│   └── rasterMetadata (RasterMetadata)
│
├── Viewport State
│   ├── zoomScale (Number)
│   └── panOffset ({ x: Number, y: Number })
│
├── Project State
│   ├── project (ProjectState Object containing curves, tracks, depthTransform, etc.)
│   ├── activeCurveId (String)
│   └── activeTab (Tab navigation state)
│
├── Active Trace State
│   └── Parameter Adjusters (colorTolerance, sigma, maxAngle, gapTolerance, weights)
│
└── Dirty State
    ├── undoStack (Array of historical ProjectStates)
    └── redoStack (Array of historical ProjectStates)
```

---

## 2. State Ownership Matrix

This matrix maps each critical state component to its authoritative owner, specifying mutability boundaries and storage persistence rules.

| State Component | Primary Owner | Mutated By | Mutator Vector | Persisted | Persistence Mechanism / Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Raster Session** | `Workspace` | `Workspace` | User image/TIFF drop action | ✓ | Temporary browser file session / LRU Cache |
| **Viewport** | `Workspace` | `Workspace` | Canvas zoom & drag mouse controllers | ✗ | Reset on workspace disposal / reload |
| **Project** | `Workspace` | `Workspace` | Callback actions & track calibrations | ✓ | Saved action logs & standard local state |
| **Active Trace** | `Workspace` | `Workspace` | Auto Trace Parameter UI Sliders | ✓ | Parameters are packaged with tracing execution |
| **Dirty State** | `Workspace` | `Workspace` | Undo/Redo historical stacks | ✗ | Non-persistent memory buffers (capped at 100) |

### Key Design Assertions:
1. **Single Ownership**: No secondary component or child view (e.g., `FrameProfiler`, `Canvas`, or tab panel) holds or modifies these state roots independently. All downstream components receive state as read-only properties (`props`) and trigger modifications purely through declarative parent callbacks.
2. **Circular Dependency Avoidance**: Downstream rendering nodes never reference or mutate parent states directly. There are no two-way state bindings or concurrent data sync mechanisms. Data flows exclusively downward.

---

## 3. State Lifecycle Report

The diagram below tracks the lifecycle sequence of the workspace states from initialization to cleanup:

```text
Initialization [Create]
       │
       ▼
   Interactive [Update] ◄─── (Local mutations via callbacks or slider events)
       │
       ▼
  Commitment [Save]    ───► (Persists changes to local ProjectState & undo history)
       │
       ▼
   Retrieval [Load]    ───► (Restores prior state from history stack or project ingestion)
       │
       ▼
 Destruction [Dispose]  ───► (Clears Web Worker pools, LRU raster caches, and URL memory references)
```

### Detailed Lifecycle Stages for Each State Component:

#### A. Raster Session State
*   **Create**: Initialized when a user uploads or drops a well log TIFF/image file. A new `VirtualRaster` object is constructed, triggering Web Worker allocation and LRU cache mapping.
*   **Update**: Updated dynamically when new tiles or pixels are processed by the virtual raster pipelines.
*   **Save**: No heavy persistent database write; cached tiles are written to transient indexed pools.
*   **Load**: Read directly by the central canvas viewport mapping when rendering active tiles on-screen.
*   **Dispose**: Terminated during file reloads or workspace teardown. Callbacks invoke `virtualRaster.dispose()`, freeing up GPU/memory resources and shutting down background thread pools.

#### B. Viewport State
*   **Create**: Instantiated with default standard scales (zoom = 1.0, offset = `{x: 0, y: 0}`) on workspace layout assembly.
*   **Update**: Highly dynamic updates fired on scroll events, mouse wheel gestures, or pan drags.
*   **Save**: Excluded from local storage save pathways to prevent view locks between sessions.
*   **Load**: Automatically restored to viewport default coordinates on file reset.
*   **Dispose**: Destroyed upon React component unmounting.

#### C. Project State
*   **Create**: Automatically loaded from template logs, or initialized via project creation metadata.
*   **Update**: Modified when control points are placed, track scales are configured, or lines are digitized.
*   **Save**: Ingested and written directly to local state and history stack via `saveActionState(newState, desc)`.
*   **Load**: Deserialized upon file ingestion or via the `handlesUndo()` / `handlesRedo()` history vectors.
*   **Dispose**: Garbage-collected on app shutdown.

#### D. Dirty State
*   **Create**: Initialized as empty arrays (`undoStack = []`, `redoStack = []`) when the workspace opens.
*   **Update**: State is pushed onto the stack whenever `saveActionState` is called. Stack size is capped at 100 to conserve RAM.
*   **Save**: Volatile history state; exists purely in-memory and is not serialized to external disk.
*   **Load**: Restored via Undo/Redo interactive triggers.
*   **Dispose**: Erased and deallocated on workspace exit or document reset.

---

## 4. Verification Checklist Audit

### ✓ Condition 1: No state has more than one owner
*   **Evidence**: The root component `/components/digitizer-workspace.tsx` maintains exclusive definition of `useState` hooks for `project`, `viewport` (`panOffset`/`zoomScale`), `rasterSession` (`virtualRaster`/`rasterMetadata`), and `dirtyState` (`undoStack`/`redoStack`). Subcomponents receive only read-only attributes and invoke parent actions via strictly-defined lambda functions.

### ✓ Condition 2: No circular ownership
*   **Evidence**: All child rendering modules operate in a functional, unidirectional data stream. No component retains side-channel handles to mutate global or parent parameters. Data flows downwards (Props) and callbacks flow upwards (Events).

### ✓ Condition 3: Complete and consistent state lifecycle
*   **Evidence**: Standard React lifecycle rules apply. Asymptotic cleanup functions are placed inside `useEffect` return blocks to consistently release resources (e.g. revoking temporary blob URLs, terminating Web Worker threads) on disposal, preventing memory leaks or zombie background processes.
