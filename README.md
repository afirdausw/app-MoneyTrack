# 💰 MoneyTrack

Aplikasi pencatat keuangan **multi-workspace** dalam satu akun: keuangan **pribadi**, **bersama** (pasangan/keluarga/komunitas), dan **bisnis** (freelancer/UMKM). Dibangun sebagai aplikasi **Fullstack TypeScript** yang bisa di-install di HP sebagai **PWA**.

> Seluruh teks antarmuka, pesan error API, dan dokumentasi memakai **Bahasa Indonesia**.

---

## Daftar Isi
- [Fitur](#-fitur)
- [Teknologi](#-teknologi)
- [Prasyarat](#-prasyarat)
- [Instalasi & Menjalankan di Lokal](#-instalasi--menjalankan-di-lokal)
- [Variabel Lingkungan](#-variabel-lingkungan)
- [Daftar Perintah](#-daftar-perintah)
- [Struktur Project](#-struktur-project)
- [Konsep Penting](#-konsep-penting)
- [Testing](#-testing)
- [Build Produksi](#-build-produksi)
- [Dokumentasi Lanjutan](#-dokumentasi-lanjutan)
- [Roadmap](#-roadmap)

---

## ✨ Fitur

### Inti
- **Login Google** (OAuth) dengan sesi cookie `HttpOnly`.
- **Multi-workspace**: `personal`, `shared`, dan `business`, masing-masing dengan kategori bawaan sesuai mode.
- **Anggota & peran** (`owner`, `admin`, `member`, `viewer`) dengan undangan lewat link sekali pakai.
- **Dompet lintas workspace** dengan mata uang masing-masing (IDR, USD, dll.) dan pengaturan visibilitas.
- **Transaksi** pemasukan, pengeluaran, dan transfer antardompet. Saldo selalu sinkron karena diubah secara atomik.
- **Kurs manual** untuk transaksi beda mata uang, dihitung dengan aritmetika integer (tanpa galat float).
- **Quick Input**: ketik `makan siang 25rb gopay` dan form langsung terisi.
- **Foto struk privat**: dikompres otomatis di browser (WebP), hanya bisa dibuka oleh anggota workspace.

### Perencanaan
- **Budget per kategori** bulanan dengan progress bar dan peringatan ≥ 80%.
- **Target tabungan** dengan riwayat setoran dan estimasi setoran per bulan.
- **Tagihan rutin** dengan pengingat jatuh tempo dan konfirmasi bayar sekali klik.

### Kolaborasi (mode `shared`)
- **Kas bersama** dan ringkasan kontribusi anggota.
- **Split bill** (bagi rata atau nominal custom) dan **settlement** "siapa transfer ke siapa".
- **Audit log** semua perubahan oleh tiap anggota.

### Bisnis (mode `business`)
- **Klien & project** beserta profit per project (omzet − biaya).
- **Invoice / piutang** dengan nomor otomatis dan status `draft` → `sent` → `partial` → `paid` / `overdue`.

### Laporan & Pengalaman Pengguna
- **Dashboard** dan **grafik tren** pemasukan/pengeluaran per bulan.
- **Laporan periode** per kategori, dompet, dan project, serta ekspor ke **CSV**, **XLSX**, dan **PDF** (cetak).
- **Pencarian transaksi**.
- **Dark mode**, **mode privasi** (sembunyikan nominal), serta kustomisasi ikon/warna workspace dan dompet.
- **PWA**: bisa di-install, app shell tetap terbuka saat offline, dan shortcut "Catat Transaksi".

---

## 🧰 Teknologi

| Lapisan | Teknologi |
|---|---|
| **Frontend** | [React 19](https://react.dev), [Vite](https://vite.dev), [Tailwind CSS v4](https://tailwindcss.com), [React Hook Form](https://react-hook-form.com), [lucide-react](https://lucide.dev), [Air Datepicker](https://air-datepicker.com), font Inter (self-hosted) |
| **Backend** | [Node.js](https://nodejs.org), [Hono](https://hono.dev) (`@hono/node-server`) |
| **Database** | MySQL / MariaDB 10.1+ melalui [Drizzle ORM](https://orm.drizzle.team) + `mysql2` |
| **Bersama** | TypeScript, [Zod](https://zod.dev) (validasi yang sama di client & server) |
| **Tooling** | [Vitest](https://vitest.dev), `tsx`, `concurrently`, `drizzle-kit`, `esbuild` |

Semua kode ada dalam satu repo (bukan monorepo multi-paket). Dalam produksi, **satu proses Node** menyajikan API sekaligus file frontend hasil build.

---

## 📋 Prasyarat

- **Node.js 20.6+** (disarankan versi LTS terbaru) dan `npm`
- **MySQL 5.7+ / MariaDB 10.1+**. Di Windows paling mudah lewat [Laragon](https://laragon.org) atau XAMPP.
- **Git**
- *(Opsional)* Akun [Google Cloud Console](https://console.cloud.google.com) untuk membuat OAuth Client ID login Google.

---

## 🚀 Instalasi & Menjalankan di Lokal

### 1. Clone & install dependensi
```bash
git clone https://github.com/afirdausw/app-MoneyTrack.git
cd app-MoneyTrack
npm install
```

### 2. Siapkan file `.env`
```bash
cp .env.example .env
```
Lalu sesuaikan isinya (lihat [Variabel Lingkungan](#-variabel-lingkungan)).

### 3. Buat database & jalankan migrasi
Buat database kosong bernama `money_tracking` (sesuai `DATABASE_URL`), misalnya lewat HeidiSQL/phpMyAdmin di Laragon:
```sql
CREATE DATABASE money_tracking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
Kemudian buat seluruh tabel:
```bash
npm run db:migrate
```

### 4. Atur login Google
1. Di Google Cloud Console, buka **APIs & Services → Credentials → Create Credentials → OAuth client ID** dan pilih tipe *Web application*.
2. Tambahkan **Authorized redirect URI**:
   ```
   http://localhost:5173/api/auth/google/callback
   ```
3. Salin Client ID & Client Secret ke `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di `.env`.

### 5. Jalankan mode development
```bash
npm run dev
```
- Aplikasi web: **http://localhost:5173**
- API: http://localhost:3001 (diproksikan oleh Vite lewat `/api`)

Perubahan kode client akan di-reload otomatis oleh Vite, dan server API akan restart sendiri lewat `node --watch`.

---

## 🔐 Variabel Lingkungan

| Variabel | Contoh | Keterangan |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production`, atau `test` |
| `PORT` | `3001` | Port server API |
| `APP_URL` | `http://localhost:5173` | URL publik aplikasi, dipakai untuk redirect & link undangan |
| `DATABASE_URL` | `mysql://root:@127.0.0.1:3306/money_tracking` | Koneksi MySQL/MariaDB |
| `SESSION_SECRET` | *(string acak)* | **Wajib** acak ≥ 32 karakter di produksi |
| `GOOGLE_CLIENT_ID` | | Dari Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | | Dari Google Cloud Console (**rahasia**) |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5173/api/auth/google/callback` | Harus sama persis dengan yang didaftarkan di Google |
| `UPLOAD_DIR` | `./uploads/receipts` | Folder foto struk (di luar `public/`) |
| `MAX_RECEIPT_SIZE_MB` | `5` | Batas ukuran upload struk |
| `TRUST_PROXY` | `false` | `true` hanya bila berada di belakang reverse proxy tepercaya |

> ⚠️ Jangan pernah meng-commit file `.env`. File ini sudah ada di `.gitignore`, dan hanya `.env.example` yang masuk repo.

Membuat `SESSION_SECRET` acak:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 📜 Daftar Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan API (:3001) + Vite (:5173) bersamaan |
| `npm run dev:api` / `npm run dev:web` | Menjalankan salah satunya saja |
| `npm run typecheck` | Cek tipe TypeScript untuk client lalu server |
| `npm test` | Menjalankan seluruh test Vitest |
| `npm run build` | Typecheck + build frontend (`dist/client`) + bundle server (`dist/server/index.js`) |
| `npm start` | Menjalankan hasil build produksi |
| `npm run db:generate` | Membuat file migrasi baru setelah skema diubah |
| `npm run db:migrate` | Menerapkan migrasi ke database |
| `npm run db:studio` | Membuka Drizzle Studio untuk melihat isi database |

---

## 🗂️ Struktur Project

```
app-MoneyTrack/
├── docs/                    # Dokumentasi arsitektur, DB, UX, API, roadmap, deploy
├── drizzle/                 # File migrasi SQL (dibuat drizzle-kit, jangan diedit manual)
├── public/                  # Aset statis: manifest PWA, ikon, service worker (sw.js)
├── src/
│   ├── shared/              # Kode murni lintas client & server
│   │   ├── types/           #   Tipe domain
│   │   ├── utils/           #   Mata uang, kurs, izin role, jadwal, split, invoice, quick parser
│   │   └── validation/      #   Skema Zod (dipakai form & API)
│   ├── server/              # Backend Hono
│   │   ├── app.ts           #   createApp(): middleware + pendaftaran route
│   │   ├── index.ts         #   Bootstrap server
│   │   ├── config/          #   Validasi env
│   │   ├── db/              #   Pool mysql2 + skema Drizzle
│   │   ├── middleware/      #   Auth, role workspace, keamanan
│   │   ├── routes/          #   Endpoint HTTP (+ test API)
│   │   ├── services/        #   Logika bisnis & akses database
│   │   └── lib/             #   Helper respons, keamanan, storage, XLSX
│   └── client/              # Frontend React
│       ├── App.tsx          #   Sesi, undangan, dialog workspace
│       ├── AppShell.tsx     #   Layout & navigasi halaman
│       ├── pages/           #   Dashboard, Transaksi, Dompet, Budget, Laporan, dll.
│       ├── components/      #   Komponen UI (Modal, Select, DatePicker, dll.)
│       └── lib/             #   Pemanggil API, tema, PWA, format
├── CLAUDE.md                # Panduan konvensi kode
└── package.json
```

Alias import: `@shared/*`, `@client/*`, `@server/*`. Client sengaja tidak punya alias `@server`, jadi kode server tidak bisa ter-import ke browser.

---

## 🧠 Konsep Penting

- **Uang disimpan sebagai integer minor unit** (`BIGINT`), misalnya Rp25.000 → `25000` dan $10.50 → `1050`. Float tidak pernah dipakai. Kurs disimpan sebagai string desimal dan dikonversi dengan `BigInt`.
- **Saldo dompet atomik.** Saldo hanya diubah oleh `transaction-service`, di dalam DB transaction yang sama dengan pencatatan transaksinya, dengan row lock dan retry otomatis saat deadlock.
- **Format respons API seragam**:
  ```json
  { "ok": true, "data": { ... } }
  { "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
  ```
- **Hak akses per workspace.** Semua endpoint data berada di `/api/workspaces/:wsId/...` dan dicek role-nya. Aturan role ditulis sekali di `@shared/utils/permissions` dan dipakai server maupun UI.
- **Keamanan:**
  - Header CSP, proteksi CSRF berbasis `Origin`, rate limit, dan batas ukuran body.
  - Token sesi & undangan hanya disimpan sebagai hash SHA-256.
  - File struk dicek magic bytes-nya dan dilindungi dari path traversal.
- **Zona waktu.** Koneksi DB memakai UTC. Tanggal jatuh tempo memakai kunci `YYYY-MM-DD` supaya tidak bergeser hari.
- **Kompatibel shared hosting:** skema mendukung MariaDB 10.1+.

Detail lengkap ada di [`CLAUDE.md`](CLAUDE.md) dan folder [`docs/`](docs).

---

## 🧪 Testing

```bash
npm test
```

- **Unit test** untuk utilitas di `src/shared` dan client (parser, mata uang, split, grafik, service worker).
- **Test API** dijalankan *in-memory* lewat `createApp().request(...)` tanpa membuka port.
- Test yang membutuhkan database otomatis **dilewati** bila `DATABASE_URL` tidak diisi. Bila diisi, test membuat user `*@example.test` sendiri lalu menghapusnya setelah selesai.

Menjalankan satu file saja:
```bash
npx vitest run src/shared/utils/quick-parser.test.ts
```

Sebelum meng-commit perubahan, pastikan `npm run typecheck` dan `npm test` lolos.

---

## 📦 Build Produksi

```bash
npm run build
npm start
```

Hasil build:
- `dist/client/`: file frontend statis (termasuk service worker PWA)
- `dist/server/index.js`: server Node yang menyajikan API **dan** `dist/client`

Di produksi, set `NODE_ENV=production`, `SESSION_SECRET` acak, `APP_URL` dan `GOOGLE_REDIRECT_URI` sesuai domain, lalu daftarkan redirect URI tersebut di Google Cloud Console. Panduan deploy ke shared hosting (Node.js Runtime Manager) ada di [`docs/06-deployment-shared-hosting.md`](docs/06-deployment-shared-hosting.md).

---

## 📚 Dokumentasi Lanjutan

| Dokumen | Isi |
|---|---|
| [01 — Arsitektur](docs/01-architecture.md) | Gambaran sistem & alur data |
| [02 — Desain Database](docs/02-database-design.md) | Tabel, relasi, dan aturan kompatibilitas MariaDB |
| [03 — Produk & UX](docs/03-product-and-ux-design.md) | Mode workspace, matriks role, alur UI |
| [04 — Spesifikasi API](docs/04-api-specification.md) | Daftar endpoint beserta payload |
| [05 — Roadmap](docs/05-roadmap.md) | Status tiap fase pengembangan |
| [06 — Deploy Shared Hosting](docs/06-deployment-shared-hosting.md) | Langkah deploy ke hosting |

---

## 🗺️ Roadmap

- [x] Fase 0: Fondasi & skema database
- [x] Fase 1: Autentikasi & multi-workspace
- [x] Fase 2: Dompet, transaksi & struk
- [x] Fase 3: Budget, target & tagihan rutin
- [x] Fase 4: Kas bersama, split bill & audit log
- [x] Fase 5: Klien, project & invoice
- [x] Fase 6: PWA & hardening keamanan
- [x] Laporan, ekspor, grafik & pencarian
- [ ] Deploy ke shared hosting
- [ ] Kurs otomatis
- [ ] Impor mutasi bank

---

Dibuat oleh **Afif Firdaus Wipayana**.
