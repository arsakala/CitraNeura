# Fase 0: Architecture & API Design (VirtualRaster)

## 1. High-level Architecture

Dependensi dirancang satu arah (unidirectional). `VirtualRaster` menjadi *Single Source of Truth* untuk data gambar, sementara `Workspace` dan `CanvasRenderer` hanya bertugas menampilkan dan menangani interaksi.

```text
[File / Blob]
      │
      ▼
┌───────────────────────────────────────────┐
│ VirtualRaster (Core API)                  │
│     │                                     │
│     ├── TileManager (Orchestrator)        │
│     ├── LRUCache (Memory Management)      │
│     └── WorkerPool (Web Workers)          │
│            │                              │
│            ├── TileDecoder                │
│            └── Slicer & BitmapBuilder     │
└───────────────────────────────────────────┘
      │
      ▼ (Provides ImageBitmap & Metadata)
┌───────────────────────────────────────────┐
│ CanvasRenderer (Presentation Layer)       │
│     │                                     │
│     ├── Viewport Transform Matrix         │
│     └── Tile Drawer                       │
└───────────────────────────────────────────┘
      │
      ▼ (Handles Events & State)
┌───────────────────────────────────────────┐
│ Workspace (Application Logic)             │
│     │                                     │
│     ├── Pan / Zoom Controller             │
│     ├── Calibration                       │
│     ├── Digitizer                         │
│     └── Overlay / Annotations             │
└───────────────────────────────────────────┘
```

## 2. Public API & Internal API

### VirtualRaster (Public API)
```typescript
interface ViewportState {
  zoom: number;
  visibleBounds: { x: number, y: number, width: number, height: number };
  scrollVelocity: { x: number, y: number };
  direction: 'up' | 'down' | 'left' | 'right' | 'none';
}

interface VirtualRaster {
  // Initialization & Lifecycle
  load(source: RasterSource): Promise<void>;
  dispose(): void;
  pause(): void;
  resume(): void;
  reset(): void;

  // Data Fetching
  // Mengembalikan objek Tile yang mendeskripsikan state saat ini. Renderer tidak perlu query tambahan.
  getTile(level: number, index: number): Tile;
  
  // Memberitahu engine area viewport dengan metrik lengkap untuk prefetch berbasis velocity
  updateViewport(viewport: ViewportState): void;

  // Memory & State
  clearCache(): void;
  getMetadata(): RasterMetadata;

  // Instrumentation
  getDebugStats(): RasterDebugStats;
}
```

### Internal API (Worker, Scheduler & Cache)
```typescript
interface RequestScheduler {
  // Prioritas eksekusi job: VISIBLE -> INTERACTION -> PREFETCH -> BACKGROUND
  schedule(job: DecodeJob, priority: JobPriority): void;
  cancel(jobId: string): void; // Membatalkan job jika tile di-skip/tidak relevan lagi
}

interface TileWorkerPool {
  // Mengelola beberapa worker (default: navigator.hardwareConcurrency - 1, maks 4-8)
  dispatch(job: DecodeJob): Promise<ImageBitmap>;
  cancel(jobId: string): void;
}

interface TileCache {
  // Memisahkan Tile Metadata dari Bitmap. Metadata tetap hidup meski bitmap di-evict.
  getMetadata(id: string): Tile;
  getBitmap(id: string): ImageBitmap | null;
  evictOldest(): void; // Wajib memanggil bitmap.close() saat evict!
}
```

## 3. Coordinate System

Transformasi hanya dilakukan **satu kali** saat proses rendering (menggunakan `ctx.setTransform` atau `Matrix`). Tidak ada modifikasi koordinat pada level data.

1.  **Raster Pixel (Original Coordinate):**
    Koordinat asli gambar (misal `0,0` hingga `2039, 46493`). `VirtualRaster` dan data titik digitasi disimpan secara permanen di koordinat ini.
2.  **World Coordinate:**
    Ruang virtual 2D tempat raster diletakkan. Pada kasus kita, 1 unit World = 1 unit Raster Pixel. (Koordinat ini mempermudah jika ke depan ada multiple layer raster).
3.  **Viewport Coordinate (Screen Coordinate):**
    Koordinat piksel pada elemen `<canvas>` di browser. Transformasi dari World ke Viewport ditangani oleh satu matriks (Scale + Translate) yang dikendalikan oleh Pan/Zoom Controller.

**Alur Transformasi Render:**
`Original Pixel` -> `[Matrix: Pan X, Pan Y, Zoom X, Zoom Y]` -> `Screen Pixel`

## 4. Tile Specification

*   **Ukuran Tile:** Fixed. Lebar = lebar asli raster (karena sumur log relatif sempit, misal 2048px). Tinggi = `1024px` atau `2048px` (menjaga agar ukuran 1 tile tidak melebihi ~10MB uncompressed memori).
*   **Indexing:** Linear 1D (Index = `Math.floor(y / tileHeight)`). Ke depan untuk pyramid (2D/3D), menggunakan format quadtree `(level, x, y)`.
*   **Cache Policy:** LRU (Least Recently Used). Tile yang baru diakses diletakkan di depan.
*   **Preload Policy (Adaptive):**
    *   Hitung rentang index tile yang terlihat di viewport.
    *   Jika scroll ke bawah: Prefetch `+2` tile di bawah, `+1` tile di atas.
    *   Jika scroll ke atas: Prefetch `+2` tile di atas, `+1` tile di bawah.
*   **Eviction Policy:** Jika ukuran cache melebihi batas maksimal, tile dari ekor LRU (paling lama tidak diminta oleh `getTile` atau `updateViewport`) akan dihancurkan. Pada proses ini, **sistem diwajibkan secara eksplisit memanggil `bitmap.close()`** untuk membebaskan memory GPU seketika sebelum Garbage Collector berjalan. Metadata tile tetap dapat dipertahankan.

## 5. Thread Responsibility

### Main Thread (UI & WebGL/Canvas2D)
*   **DOM & Events:** Menerima input scroll, drag, click.
*   **Rendering:** Membersihkan canvas, menerapkan Transform Matrix, memanggil `getTile` dan `ctx.drawImage` secara sinkron pada `requestAnimationFrame`.
*   **Business Logic:** Mengelola state koordinat digitasi, overlay, dan kalibrasi. Mengkonversi koordinat dari Screen ke Raster Pixel sebelum disimpan ke state.
*   **TIDAK ADA** proses manipulasi bitmap atau alokasi memori gambar skala besar di sini.

### Web Worker (Data & Decoding)
*   **File I/O:** Membaca chunk dari objek `File` menggunakan `FileReader` atau `createImageBitmap` dengan flag `rect` (jika browser mendukung parameter rect tanpa decode full).
*   **Decoding:** Mengekstrak rentang piksel yang diminta menjadi `ImageBitmap`.
*   **Transfer:** Mengirim `ImageBitmap` kembali ke Main Thread dengan mekanisme zero-copy (`Transferable Objects`).

## 6. Memory Budget (Target Terukur)

*   **Maksimum Tile Aktif (di Layar):** ~2 hingga 4 tile (tergantung tingkat zoom).
*   **Ukuran Cache Maksimal:** 12 tile (Misal: 1 tile resolusi 2048x1024 RGBA = ~8.3 MB. 12 tile = ~100 MB RAM). Sangat aman untuk browser modern.
*   **Target FPS:** stabil 60 FPS saat panning dan zooming (karena Main Thread hanya merender referensi bitmap yang sudah ada).
*   **Target Waktu Decode (Per Tile):** < 50ms di Worker.
*   **Target Latency Pan/Zoom:** Instan (< 16ms), jika tile belum siap, layar akan menampilkan background/loading placeholder (atau tile resolusi rendah jika multi-resolusi aktif) tanpa nge-block Main Thread.

## 8. Finalized API & Architecture Constraints (Design Freeze)

### 8.1 RasterSource Interface
Untuk memastikan `VirtualRaster` tidak bergantung pada detail spesifik format file dan backend penyimpanan (File lokal, IndexedDB, HTTP Range Request, Cloud Storage), akses data diabstraksi mutlak melalui interface `RasterSource`.
`RasterSource` **tidak boleh mengetahui** tentang cache, viewport, renderer, worker, atau mekanisme LRU.

```typescript
interface RasterSource {
  open(fileOrUrl: any): Promise<void>;
  getMetadata(): RasterMetadata;
  getTile(level: number, tileIndex: number): Promise<ImageBitmap>;
  dispose(): void;
}
```

### 8.2 Tile Object Specification
Struktur data objek `Tile` dibakukan secara eksplisit agar kontrak antara Cache dan Renderer selalu konsisten:

```typescript
interface Tile {
  level: number;
  index: number;
  pixelBounds: { x: number, y: number, width: number, height: number };
  bitmap: ImageBitmap | null;
  state: TileState;
  lastAccess: number; // untuk keperluan LRU cache
  memorySize: number; // perkiraan memori dalam bytes
}
```

### 8.3 Tile State Machine
Siklus hidup (lifecycle) dari sebuah Tile diatur ketat dengan state machine berikut, guna meminimalisir *race condition* saat scroll/zoom dengan cepat:
`UNLOADED` ➔ `LOADING` ➔ `READY` ➔ `VISIBLE` ➔ `CACHED` ➔ `EVICTED`

### 8.4 Renderer Contract & Independence
`CanvasRenderer` (atau WebGLRenderer) diwajibkan untuk **tidak** mengetahui:
- Cara sebuah tile didecode atau dihasilkan.
- Jenis backend (TIFF, PNG, JPEG, file lokal, IndexedDB, atau remote/cloud).
Renderer murni bertugas mengatur display:
1. Menentukan area terlihat (`viewport`).
2. Meminta tile yang dibutuhkan ke `VirtualRaster` melalui `getTile(level, index)` yang kini mereturn objek `Tile` secara utuh.
3. `VirtualRaster` mengembalikan `Tile` beserta semua statusnya.
4. Renderer menggambar `Tile.bitmap` jika sudah `READY`, atau menggambar placeholder jika masih `LOADING` atau `ERROR`.

### 8.5 Error Handling Behavior
Respons sistem pada skenario error didefinisikan sebagai berikut:
* **File rusak:** `RasterSource` melempar exception saat `open()`. UI menampilkan error dialog.
* **Tile gagal decode:** State tile menjadi `ERROR`, digambar sebagai placeholder visual (misal: kotak merah atau grid checkerboard).
* **Worker crash:** Engine melakukan spawn ulang worker secara transparan, job yang gagal di-retry satu kali.
* **Cache penuh:** Sistem langsung menjalankan `eviction policy` (membuang tile terlama berdasarkan LRU) sebelum alokasi baru.
* **Kehabisan Memori (OOM Browser):** Engine akan proaktif memonitor total ukuran byte tile. Batas atas (misal 150MB) dipertahankan mutlak.
* **File sumber terhapus / akses hilang:** `VirtualRaster` melempar error, UI memberitahu pengguna untuk melakukan relink file.
* **Relink file yang salah:** Sistem mencocokkan `checksum` / metadata file (size, dimension). Jika mismatch, relink ditolak.

### 8.6 Performance Target (Objective Benchmarks)
Metrik performa yang harus diukur secara objektif selama fase implementasi:
* Responsivitas *Zoom & Pan*: Minimal 55–60 FPS di Main Thread untuk raster ukuran 500 MB.
* Rata-rata waktu decode per tile di worker: `< 50 ms`.
* Tile pertama muncul sejak file di-load: `< 200 ms`.
* RAM footprint maksimum (hanya untuk cache bitmap tile): sesuai budget, misal maksimum `100 MB`.

### 8.8 Instrumentation (Debug Overlay)
Selain data tile aktif, instrumentasi debug diwajibkan untuk menampilkan metrik lengkap berikut guna analisis performa jangka panjang:
* Cache hit ratio dan Cache miss ratio.
* Decode queue length (jumlah antrean job decode).
* Worker utilization (persentase beban worker) dan Cancelled jobs.
* Average render latency (latensi eksekusi `drawImage`).
* Average frame time (untuk melacak fluktuasi FPS saat panning).
* Memory budget vs Actual consumption (batas 150MB vs Penggunaan riil).
 
### 8.9 Test Strategy (Datasets)
Implementasi `VirtualRaster` akan divalidasi terhadap dataset berikut untuk menjamin kehandalan:
* TIFF berukuran kecil.
* TIFF > 500 MB.
* PNG dengan aspek rasio ekstrem (contoh: tinggi > 100.000 pixel).
* JPEG resolusi tinggi.
* File gambar rusak (corrupted bits) untuk mengetes isolasi error.
