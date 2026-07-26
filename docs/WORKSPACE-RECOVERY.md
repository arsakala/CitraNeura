# Checkpoint P-06: Workspace Session & Recovery Foundation

Dokumen audit ini membuktikan keberhasilan implementasi **Workspace Session & Recovery Foundation (v1.0)** pada CitraNeura Application Platform. Mekanisme pemulihan sesi ini dirancang secara terintegrasi dengan Command Framework, sistem persistence, dan State Invariant Validator untuk memastikan ketahanan aplikasi terhadap gangguan tak terduga (seperti *crash*, penyegaran peramban, atau pemadaman listrik) tanpa mengorbankan integritas data ilmiah log sumur.

---

## 1. Session Lifecycle Diagram

Diagram di bawah menggambarkan alur hidup (*lifecycle*) sesi Workspace secara deterministik. Sistem memastikan hanya snapshot pemulihan (*recovery snapshot*) yang lolos uji invariant penuh yang diizinkan untuk dipulihkan kembali ke Workspace aktif:

```text
       Workspace Open (Inisialisasi)
                     │
                     ▼
             [Apakah Snapshot
             Sesi Tersedia?]
                     │
         ┌───────────┴───────────┐
      [ YES ]                 [ NO ]
         │                       │
         ▼                       ▼
   Ambil Snapshot          Mulai Sesi Baru
   dari localforage        (Untitled Well)
         │                       │
         ▼                       │
  [Cek Versi Skema &             │
  Uji Invariant?]                │
         │                       │
   ┌─────┴─────┐                 │
[ PASS ]    [ FAIL ]             │
   │           │                 │
   ▼           ▼                 │
Pulihkan     Tolak Snapshot      │
Sesi Aktif   & Mulai Bersih      │
   │           │                 │
   ├───────────┘                 │
   │                             │
   ▼                             │
┌────────────────────────┐       │
│      Active Session    │◄──────┘
└──────────┬─────────────┘
           │
  (Transaksi Berhasil /
   Command Executed)
           │
           ▼
  [Validasi Invariant]
           │
     ┌─────┴─────┐
  [ PASS ]    [ FAIL ]
     │           │
     ▼           ▼
Simpan Snapshot  Abaikan Snapshot
Ke localforage   (Tolak State)
     │
     ▼
Penyegaran / Crash
(Browser Refresh)
```

Setiap perubahan pada Workspace yang valid dan lolos State Invariant Validator akan langsung diduplikasi ke dalam *Recovery Snapshot* secara asinkron dengan fitur *debounce* (1 detik) untuk menghindari pemblokiran operasi I/O yang berat.

---

## 2. Session Persistence Matrix

Matriks di bawah menetapkan komponen apa saja yang disimpan dalam sesi aktif dan dipulihkan kembali, lengkap dengan parameter pengujian dan keputusan arsitektural:

| Component | Included in Recovery | Validation Before Restore | Notes / Architectural Justification |
| :--- | :--- | :--- | :--- |
| **Project State** | **YES** | **YES** | Menyimpan seluruh metadata sumur, kurva, koordinat lintasan (*tracks*), titik kalibrasi kedalaman, dan interval geologi. Wajib melewati `validateProjectInvariants` untuk mencegah pemuatan data rusak. |
| **Auto Trace Parameters** | **YES** | **YES** | Menyimpan seluruh parameter asisten pelacak garis pintar (*color tolerance, sigma, gap tolerance, weight ratios*). Memulihkan kenyamanan kerja pengguna secara instan tanpa mengulang kalibrasi warna. |
| **Active Curve** | **YES** | **YES** | Menyimpan ID kurva aktif (`activeCurveId`). Mengarahkan kembali fokus pengguna ke kurva terakhir yang sedang dikerjakan. |
| **Raster Reference** | **YES** | **YES** | Menyimpan base64 data URL backdrop gambar log sumur di dalam `project.raster`. Wajib dipulihkan agar grafik latar belakang tampil konsisten tanpa meminta berkas gambar diunggah ulang. |
| **Undo/Redo Stack** | **NO** | **N/A** | **Keputusan Eksplisit:** Riwayat Undo/Redo berisi *instance* perintah berorientasi objek (`Command`) yang mereferensikan closure React secara dinamis. Serialisasi langsung ke JSON akan memicu hilangnya konteks referensi memori (*memory bindings*). Stack disetel kembali kosong (*empty*) saat pemulihan demi stabilitas memori aplikasi yang prima. |
| **Viewport State** | **NO** | **N/A** | **Keputusan Eksplisit:** Parameter tampilan layar (`zoomScale`, `panOffset`) bersifat sementara (*transient*) dan tergantung pada ukuran layar atau peramban fisik. Memulihkan koordinat pixel usang pada ukuran jendela baru berisiko menyebabkan efek disorientasi visual (*off-screen rendering*), sehingga viewport dikembalikan ke nilai default yang berpusat pada gambar. |

---

## 3. Recovery Verification Report

Pengujian pemulihan dilakukan secara intensif dengan memicu skenario interupsi dan kegagalan snapshot berikut untuk memastikan ketangguhan sistem:

| Skenario | Hasil yang Diharapkan | Hasil yang Diamati | PASS/FAIL | Reaksi & Mekanisme Pertahanan Sistem |
| :--- | :--- | :--- | :---: | :--- |
| **Browser Refresh** | Sesi dipulihkan secara otomatis tanpa kehilangan data. | Sesi kembali persis seperti sebelum di-*refresh*. | **PASS** | Membaca `citra_session_recovery_snapshot` saat peramban dimuat ulang, berhasil merestorasi proyek, kalibrasi, kurva aktif, dan parameter penelusuran. |
| **Application Crash** | Sistem kembali ke kondisi valid menggunakan snapshot terakhir. | Berhasil memulihkan ke kondisi aman sesaat sebelum crash. | **PASS** | Auto-save merekam keadaan valid setiap kali ada transaksi sukses. Saat aplikasi dijalankan ulang, status kembali normal pada titik snapshot terakhir. |
| **Corrupted Recovery Snapshot** | Menolak snapshot rusak dan memulai sesi bersih secara aman. | Kesalahan pembacaan ditangkap, snapshot dibersihkan, lalu sumur baru yang kosong dimuat. | **PASS** | Blok `try-catch` menangkap kesalahan desentralisasi data, mencegah pemblokiran sistem, serta mengembalikan aplikasi ke kondisi sumur default. |
| **Schema Version Mismatch** | Menolak snapshot dari versi lama yang tidak kompatibel. | Snapshot ditolak langsung karena versi tidak cocok (`1.1.0` vs `1.0.0`). | **PASS** | Pengecekan `snapshot.version !== '1.0.0'` segera memicu penolakan awal sebelum modifikasi state Workspace dilakukan. |
| **Invariant Violation During Recovery** | Menolak snapshot yang mengandung data yang tidak valid secara ilmiah. | Validasi gagal, snapshot dihapus dari penyimpanan lokal, dan sumur baru dimuat. | **PASS** | Menjalankan `validateProjectInvariants` pada data snapshot. Jika ada error (misal jangkar non-monoton), pemulihan dibatalkan demi integritas ilmiah data log sumur. |

### Log Audit Mekanisme Pemulihan Sesi

```text
[06:05:00] [SYSTEM] Memulai Skenario Verifikasi Ketahanan Sesi (Checkpoint P-06).
[06:05:03] [ACTION] Pengguna mengubah batas horizontal Track-1 (Transaksi Berhasil).
                    - Hasil: Pemicu autosave asinkron (1s debounce).
                    - Log: Recovery Snapshot berhasil disimpan ke localforage. Status: PASS.
[06:05:08] [ACTION] Pengguna melakukan Penyegaran Peramban (Browser Refresh).
                    - Hasil: Menginisialisasi digitizer-workspace.
                    - Log: "Sesi aktif berhasil dipulihkan secara otomatis." (Project State & Parameter berhasil dipulihkan). Status: PASS.
[06:05:15] [ACTION] Percobaan memulihkan dari snapshot yang sengaja dirusak (Korupsi Data).
                    - Hasil: Proses pemulihan menangkap error parsing/struktur.
                    - Log: "[Session Recovery] Restoration error: SyntaxError: Unexpected token..."
                           Sistem mengabaikan snapshot korup dan memulai sumur kosong ("Untitled Well") secara aman. Status: PASS.
```

---

## 4. Kesimpulan Pengujian (Checkpoint P-06: PASS)

Sistem **Workspace Session & Recovery Foundation** telah terbukti berfungsi secara sempurna dan aman, memberikan jembatan pertahanan yang kuat antara **Platform Foundation** dan fitur operasional operatif selanjutnya. Seluruh data ilmiah kini terlindungi dari interupsi fisik tanpa mengorbankan kepatuhan terhadap kaidah State Invariants.
