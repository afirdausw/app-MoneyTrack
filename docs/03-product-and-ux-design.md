# 03. Desain Produk, Alur Fitur & UI/UX

## 1. Perilaku Tiap Mode Workspace

| Aspek | Mode Personal (`personal`) | Mode Shared (`shared`) | Mode Business (`business`) |
| --- | --- | --- | --- |
| **Target Penggunaan** | Keuangan pribadi harian | Pasangan, keluarga, kos, komunitas | Freelancer, jasa, UMKM |
| **Fokus Utama** | Budget, Goals, Tagihan Rutin, Quick Input | Kas Bersama, Split Bill, Audit Log | Omzet, Biaya Project/Klien, Piutang Invoice |
| **Multi-Anggota** | Umumnya 1 user (owner) | Invite link/email + role bertingkat | Owner + admin/akuntan/partner |
| **Visibilitas Dompet** | Default pribadi | Pilih `workspace_only` atau `full_transparent` | Bisa tautkan rekening pribadi dengan `workspace_only` |

## 2. Matriks Hak Akses Role

| Aksi | `owner` | `admin` | `member` | `viewer` |
| --- | :---: | :---: | :---: | :---: |
| Lihat dashboard, mutasi & laporan | Ya | Ya | Ya | Ya |
| Catat transaksi, upload struk & split bill | Ya | Ya | Ya | Tidak |
| Edit / hapus transaksi anggota lain | Ya | Ya | Hanya milik sendiri* | Tidak |
| Kelola budget, goals, tagihan rutin, project/invoice | Ya | Ya | Tidak (baca saja) | Tidak |
| Undang / ubah role anggota & kelola tautan dompet | Ya | Ya | Tidak | Tidak |
| Hapus Workspace | Ya | Tidak | Tidak | Tidak |

*\*Catatan: setiap aksi ubah/hapus pada Workspace bertipe `shared` (dan opsional di mode lain) otomatis menulis catatan ke `audit_logs`.*

## 3. Alur Fitur Kunci MVP

### A. Quick Input Teks Cepat
1. Pengguna mengetik 1 baris di input cepat, misalnya `"makan siang 25rb gopay"` atau `"+dp desain 2jt bca"`.
2. Fungsi `parseQuickInput` ([quick-parser.ts](../src/shared/utils/quick-parser.ts)) mengurai jenis transaksi, nominal, mata uang, deskripsi, dan petunjuk dompet secara langsung (*real-time preview*).
3. Pengguna mengonfirmasi kategori/dompet lalu menyimpan.

### B. Shared Wallet Lintas Workspace
1. Pemilik dompet menautkan dompet yang sama (misal `BCA Utama`) ke Workspace lain.
2. Saat menautkan, pemilik memilih `visibility_mode`:
   - **`workspace_only`:** Saldo total rekening tetap sinkron setiap kali ada transaksi di ruang mana pun, tetapi riwayat transaksi pribadi tidak bocor ke Workspace Bisnis/Shared.
   - **`full_transparent`:** Seluruh transaksi dompet tersebut ikut tampil penuh di Workspace tujuan (cocok untuk rekening kas bersama pasangan/komunitas).

### C. Tagihan Rutin (Konfirmasi 1-Klik)
- Sistem **tidak memotong saldo otomatis di latar belakang** agar tidak terjadi salah nominal (misal tagihan listrik berubah tiap bulan) atau ketergantungan cron job shared hosting.
- Ketika tanggal `next_due_date` mendekati atau melewati hari ini, dashboard menampilkan kartu pengingat dengan tombol **Bayar 1-Klik** yang membuka form pre-filled (nominal & dompet tetap bisa disesuaikan sebelum disimpan), lalu menggeser `next_due_date` ke periode berikutnya.

### D. Upload Foto Struk Privat
- Sebelum di-upload, gambar diperkecil/dikompresi di browser (Canvas/WebP) agar hemat penyimpanan shared hosting.
- Server menyimpan file ke folder di luar `public/` (`UPLOAD_DIR`) dan menyajikannya hanya lewat endpoint terproteksi setelah validasi session dan keanggotaan Workspace.

### E. Split Bill & Settlement
- Anggota mencatat total pengeluaran dan memilih siapa yang membayar (`paid_by_user_id`) serta pembagian beban (`split_participants` — bagi rata atau nominal custom).
- Halaman Settlement menghitung saldo bersih antar pasangan anggota (*net balance*) sehingga menampilkan ringkasan transfer paling ringkas (contoh: *"Budi transfer Rp75.000 ke Andi"*).

## 4. Panduan Visual & Responsivitas UI
- **Mobile-First + PWA:** Dapat di-install ke layar utama ponsel (`manifest.webmanifest`). Pada layar mobile (`< 768px`), navigasi menggunakan **Bottom Bar** dengan tombol **Floating `+`** di tengah untuk catat cepat.
- **Desktop Layout:** Pada layar lebar (`>= 768px`), navigasi berpindah ke **Sidebar kiri** lengkap dengan *Workspace Switcher* dan grid ringkasan 3 kolom.
- **Tipografi:** Menggunakan font **`Inter`** (`@fontsource/inter`, bobot 400–700) yang dibundel lokal untuk keterbacaan angka dan tabel keuangan yang bersih.
- **Palet Warna:** Dasar netral terang (`slate-50`, kartu putih berbingkai `slate-200`), aksen utama `teal-700`, pemasukan `emerald-700`, dan pengeluaran `rose-700`.
- **Interaksi & Validasi Form:**
  - **Autentikasi Minimal:** Masuk & daftar cukup satu klik menggunakan **Google OAuth**; akun baru otomatis dibuatkan Workspace Pribadi awal.
  - **Cursor Konsisten:** Seluruh tombol aktif, link, select, dan elemen klik menggunakan `cursor: pointer` (dan `cursor: not-allowed` saat nonaktif).
  - **Validasi Input Wajib:** Semua form menggunakan `react-hook-form` + `zod` melalui komponen `FormField` agar pesan error tampil rapi langsung di bawah input wajib tanpa tooltip bawaan browser.
