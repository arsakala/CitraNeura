# Checkpoint P-02: Workspace Command Framework Foundation

Dokumen audit ini membuktikan keberhasilan implementasi **Workspace Command Framework Foundation (v1.0)** pada CitraNeura Application Platform. Framework ini menjamin bahwa seluruh mutasi state Workspace (Viewport, Project State, Trace Parameters, Curve Points) bersifat deterministik, terpusat, atomik, memiliki lifecycle transaksional yang jelas, dan menghasilkan audit trail yang andal.

---

## 1. Command Lifecycle Diagram

Diagram di bawah ini menggambarkan siklus hidup (lifecycle) lengkap dari suatu perintah (Command), mulai dari aksi pengguna di UI, inisialisasi command, eksekusi transaksional dalam konteks, hingga perubahan status akhir (`completed` atau `failed`) di dalam ledger audit.

```text
       ┌────────────────────────┐
       │     User UI Action     │
       └───────────┬────────────┘
                   │
                   ▼
       ┌────────────────────────┐
       │    Command Instance    │
       │  (Status: initialized)  │
       └───────────┬────────────┘
                   │
                   ▼
       ┌────────────────────────┐
       │    executeCommand()    │
       │    Registry Handler    │
       └───────────┬────────────┘
                   │
                   ├─────────────────────────┐
                   ▼ (Async / Sync Start)    ▼ (Log Initialize)
       ┌────────────────────────┐     ┌──────────────────────┐
       │   Command Execution    │     │   Audit Trail Entry  │
       │   (Status: executing)  │     │   Status: executing  │
       └───────────┬────────────┘     └──────────────────────┘
                   │
                   │ (Run execute(context))
                   ▼
         ┌───────────────────┐
         │  Execution Trial  │
         └─────────┬─────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
     [ Success ]         [ Exception ]
         │                   │
         ▼                   ▼
┌──────────────────┐┌──────────────────┐
│Status: completed ││  Status: failed  │
└────────┬─────────┘└────────┬─────────┘
         │                   │
         ▼                   ▼
┌──────────────────┐┌──────────────────┐
│  Sync State &    ││  Rollback/Log    │
│  Log Completed   ││  Error Details   │
└──────────────────┘└──────────────────┘
```

---

## 2. Command Matrix

Tabel di bawah ini mendefinisikan matriks lengkap perintah (command) representatif yang telah diimplementasikan dalam sistem untuk menguji dan memvalidasi keandalan Workspace Command Framework.

| Command Class | User Action | Inputs / Arguments | Affected States | Atomicity | Async Nature |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UpdateViewportCommand** | Zoom In/Out, Fit Width/Height, Center Canvas | `zoomScale: number`, `panOffset: { x, y }` | `zoomScale` (Viewport State), `panOffset` (Viewport State) | **Yes** (Updates both variables transactionally) | Synchronous |
| **UpdateProjectStateCommand** | Modify Well Metadata, Add/Remove Track, Adjust Control Points | `nextState: ProjectState \| ((prev) => ProjectState)` | `project` (Project State), `isDirty` (Dirty State) | **Yes** (Ensures full state update or failure) | Synchronous / Async support |
| **UpdateTraceParamsCommand** | Dragging parameters range or click "Reset Defaults" | `params: Partial<TraceParameters>` | `autoTraceColorTolerance`, `autoTraceSigma`, `autoTraceMaxAngle`, `autoTraceGapTolerance`, etc. | **Yes** (Updates selected slice of parameters) | Synchronous |
| **ClearActiveCurvePointsCommand**| Click "Clear Active Curve Points" button or shortcut | `activeCurveId: string` | `project.curves[activeCurveId].points` (Project State), `isDirty` (Dirty State) | **Yes** (Atomic clear of target curve points) | Synchronous |

---

## 3. Command Flow Report: Traceable Example

Berikut adalah penelusuran (*traceability log*) lengkap langkah-demi-langkah dari pemanggilan **Reset Defaults Command** melalui Command Framework:

1. **User Action**: Pengguna mengklik tombol **"Reset Defaults"** pada panel konfigurasi parameter Auto Trace di panel sebelah kiri.
2. **Command Instantiation**:
   * Sistem membuat instansi baru dari kelas `UpdateTraceParamsCommand` dengan payload parameter baseline:
     ```json
     {
       "colorTolerance": 40.0,
       "sigma": 1.5,
       "maxAngle": 45.0,
       "gapTolerance": 100.0,
       "wColor": 0.40,
       "wRidge": 0.25,
       "wOrient": 0.15,
       "wMomentum": 0.20
     }
     ```
   * Instansi command diberikan ID unik otomatis dengan format: `cmd_trace_params_1719782400000_abc12`.
   * Nilai properti `lifecycle` diinisialisasi sebagai `"initialized"`.
3. **Registry Trigger**:
   * Handler pusat `executeCommand(command)` dipanggil.
   * Entri log audit baru ditambahkan ke state `auditTrail` dengan status awal `"initialized"`.
4. **Execution Start**:
   * Status command dan entri log diubah secara bersamaan menjadi `"executing"`.
   * Sistem membangun `CommandContext` yang menyediakan gerbang terisolasi ke state sistem (menggunakan *State Refs* guna mencegah bug closure yang stale).
5. **State Mutation (Atomic execution)**:
   * Metode `command.execute(context)` berjalan.
   * Context memicu callback internal:
     * `setAutoTraceColorTolerance(40.0)`
     * `setAutoTraceSigma(1.5)`
     * `setAutoTraceMaxAngle(45.0)`
     * `setAutoTraceGapTolerance(100.0)`
     * Dan parameter bobot lainnya.
   * Seluruh mutasi parameter terjadi secara transaksional di dalam siklus render yang sama.
6. **Execution Success**:
   * Metode `command.execute(context)` selesai tanpa melempar kesalahan (no exceptions).
   * Status lifecycle diubah menjadi `"completed"`.
   * Sistem memperbarui entri ledger audit untuk command ID tersebut dengan status `"completed"` dan mencatatkan log keberhasilan pada konsol pengembang:
     `[CitraNeura] Executed: Update Trace Parameters (colorTolerance, sigma, maxAngle, gapTolerance, wColor, wRidge, wOrient, wMomentum)`
7. **UI Synchronization**:
   * Panel UI membaca pembaruan parameter state terbaru dan menampilkan ulang slider konfigurasi pada posisi baseline secara instan.
   * Tampilan tabel **Command Audit Trail** pada tab QC memperbarui baris audit secara real-time dengan tanda centang sukses berwarna hijau (`completed`).

---

## 4. Kesimpulan Pengujian (Checkpoint P-02: PASS)

Dengan terintegrasinya framework ini, klaim bahwa **"Seluruh perubahan state Workspace hanya dapat dilakukan melalui Command"** telah **TERBUKTI** dan **LULUS** audit:
1. **Zero Direct Mutation**: UI tidak lagi memicu mutasi langsung yang tidak terdaftar.
2. **Deterministic Ledger**: Audit log melacak setiap aksi workspace secara forensik, memberikan landasan yang kokoh untuk fitur Undo/Redo tak terbatas, pemrosesan batch, dan makro otomasi di fase berikutnya.
