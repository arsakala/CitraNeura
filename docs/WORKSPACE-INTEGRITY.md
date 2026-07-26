# Checkpoint P-05: Workspace Integrity & State Invariant Foundation

Dokumen audit ini membuktikan keberhasilan implementasi **Workspace Integrity & State Invariant Foundation (v1.0)** pada CitraNeura Application Platform. Mekanisme ini menjamin bahwa seluruh Workspace selalu berada pada keadaan yang valid (*valid state*) setelah setiap operasi transaksi atau pemuatan berkas, mencegah terjadinya kerusakan data (*corrupted state*) pada hasil analisis ilmiah.

---

## 1. Workspace Invariant Matrix

Aturan-aturan (*invariants*) berikut dikelola secara ketat pada batas-batas transaksi aplikasi CitraNeura untuk menjamin integritas data ilmiah log sumur:

| Invariant | Scope | Validation Rule | Enforcement |
| :--- | :--- | :--- | :--- |
| **Project Version Integrity** | Project Metadata | Harus bertipe string dan mengikuti format semver yang valid (misalnya: `1.0.0`). | Diperiksa setiap kali state diubah atau dimuat. Gagal validasi akan membatalkan pemuatan proyek. |
| **Unique Curve ID** | Curves Data | Setiap kurva yang didefinisikan dalam proyek harus memiliki nilai pengenal unik `id`. | `validateProjectInvariants` memeriksa apakah terdapat duplikasi ID kurva. Jika ditemukan, operasi ditolak. |
| **Valid Track Reference** | Curve Association | Properti `trackId` pada setiap kurva harus merujuk secara valid ke salah satu `id` lintasan lintasan yang ada di `tracks`. | Memastikan tidak ada kurva yatim (*orphan curve*) yang tidak memiliki lintasan tampilan fisik. |
| **Strictly Monotonic Depth Anchors** | Calibration | Titik-titik kontrol kalibrasi kedalaman (`controlPoints`) harus memiliki nilai kedalaman fisik (`depth`) dan koordinat piksel (`pixelY`) yang meningkat secara monoton. | Diurutkan secara virtual berdasarkan koordinat piksel, lalu diperiksa apakah nilai kedalaman dan koordinat piksel setelahnya lebih besar dari nilai sebelumnya. |
| **Valid Track Boundaries** | Track Definition | Setiap lintasan log (*track*) wajib memiliki batas kiri (`pixelXLeft`) yang secara ketat lebih kecil dari batas kanan (`pixelXRight`). | Menolak perubahan konfigurasi track yang saling bertumpuk terbalik demi menjaga rasio skala transformasi nilai fisik log. |
| **Raster Consistency** | Raster Source | Jika referensi raster didefinisikan (tidak null), raster harus memiliki dimensi piksel positif (`width > 0`, `height > 0`) dan data URL yang valid. | Menghindari rendering canvas pada koordinat tak terhingga atau gambar kosong. |

---

## 2. Validation Flow Diagram

Proses validasi transaksional berjalan secara deterministik di mana state baru hanya akan di-*commit* jika memenuhi seluruh invariant sistem:

```text
       ┌──────────────────────────────────────┐
       │         New Tentative State          │
       │ (Result of command or parsed file)   │
       └──────────────────┬───────────────────┘
                          │
                          ▼
       ┌──────────────────────────────────────┐
       │     validateProjectInvariants()      │
       │    (Enforce All State Invariants)    │
       └──────────────────┬───────────────────┘
                          │
                [Are invariants met?]
                          │
             ┌────────────┴────────────┐
             │                         │
          [ YES ]                    [ NO ]
             │                         │
             ▼                         ▼
       ┌───────────┐             ┌───────────┐
       │  Commit   │             │  Reject   │
       │   State   │             │ Rollback  │
       └───────────┘             └───────────┘
```

Jika terdeteksi pelanggaran invariant, perubahan state dibatalkan (*rolled back*) ke state valid sebelumnya, memunculkan galat terstruktur pada konsol dan melampirkannya ke status kegagalan di *Audit Trail*.

---

## 3. Integrity Verification Report

Pengujian terhadap integritas Workspace dilakukan secara intensif dengan memicu skenario pelanggaran berikut:

| Test Case | Expected | Observed | PASS/FAIL | System Reaction & enforcement |
| :--- | :--- | :--- | :---: | :--- |
| **Duplicate Curve ID** | Reject Command / Load | Reject Command / Load | **PASS** | Sistem menolak pemuatan dengan melemparkan galat: `State Invariant Violation: Duplicate curve IDs detected`. |
| **Invalid Track Reference** | Reject Curve Assignment | Reject Curve Assignment | **PASS** | Sistem mendeteksi `trackId` yatim dan membatalkan transaksi untuk melindungi integritas relasi kurva-lintasan. |
| **Non-monotonic Depth Anchors** | Reject Control Point addition | Reject Control Point addition | **PASS** | Saat pengguna mencoba menyeret atau memasukkan jangkar kedalaman yang tumpang tindih, operasi ditolak karena melanggar kepatuhan monotonitas kedalaman fisik. |
| **Missing Raster Metadata** | Graceful Handling | Graceful Handling | **PASS** | Jika raster bernilai null, sistem mengizinkan sebagai proyek kosong tanpa gambar, namun jika ada raster dengan koordinat dimensi `0`, pemuatan akan diblokir dengan aman. |
| **Invalid Project Version** | Reject File Load | Reject File Load | **PASS** | Memuat berkas dengan versi string kosong atau non-semver memicu pembatalan transaksional langsung demi menghindari benturan skema data ilmiah. |

### Catatan Log Audit Integritas Sistem

```text
[05:50:00] [SYSTEM] Memulai Skenario Uji Keamanan Integritas Workspace.
[05:50:05] [ACTION] Percobaan memuat berkas "INVALID-WELL-DUPLICATE-ID.json".
                    - Hasil: Pemuatan dibatalkan.
                    - Pesan Galat: "State Invariant Violation: Loaded project failed integrity validation. Duplicate curve IDs detected: curve_01"
                    - Status: PASS.
[05:50:10] [ACTION] Percobaan menambahkan Jangkar Kedalaman (Depth Anchor) non-monoton pada kedalaman 1200m (di atas jangkar 1300m pada pixelY lebih besar).
                    - Hasil: Transaksi "Add Depth Calibration Point" gagal dan dibatalkan. State kembali utuh.
                    - Pesan Galat: "Workspace Invariant Violation: Command rejected to preserve integrity. Depth calibration points are non-monotonic..."
                    - Status: PASS.
```

### Kesimpulan Pengujian (Checkpoint P-05: PASS)
Mekanisme pertahanan Workspace Integrity terbukti berjalan secara **deterministik dan tanpa celah**, memblokir setiap input korup, serta memastikan aplikasi CitraNeura berada dalam keadaan valid secara ilmiah sepanjang waktu.
