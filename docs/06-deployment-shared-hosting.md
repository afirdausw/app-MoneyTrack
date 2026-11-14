# 06. Panduan Build & Deploy Shared Hosting

Aplikasi dirancang agar berjalan sebagai **1 proses Node.js tunggal** (`dist/server/index.js`) yang sekaligus melayani API `/api/*` dan hasil build React statis (`dist/client/`).

## 1. Persiapan Sebelum Upload
1. Pastikan seluruh pengecekan lokal lulus:
   ```powershell
   npm test
   npm run build
   ```
2. Hasil build berada di folder:
   - `dist/client/` (HTML, CSS, JS, dan font `Inter` yang sudah terbundel)
   - `dist/server/index.js` (server API Hono terkompilasi)

> **Tips Shared Hosting:** Jika RAM shared hosting terbatas saat menjalankan `vite build`, lakukan `npm run build` di laptop terlebih dahulu, lalu unggah folder `dist/`, `drizzle/`, `package.json`, dan `package-lock.json` ke server.

## 2. Konfigurasi Database & Migrasi di Server
1. Buat database MySQL/MariaDB baru dan user database lewat panel hosting.
2. Jalankan migrasi tabel ke database produksi menggunakan `DATABASE_URL` server:
   ```bash
   npm run db:migrate
   ```
   *(Atau impor file SQL di folder `drizzle/` bila panel tidak memberi akses terminal untuk migrasi awal.)*

## 3. Konfigurasi `.env` Produksi
Buat file `.env` di direktori aplikasi pada server:
```env
NODE_ENV=production
PORT=3001
APP_URL=https://domain-kamu.com
DATABASE_URL=mysql://user_db:password_db@127.0.0.1:3306/nama_db
SESSION_SECRET=isi_string_acak_panjang_minimal_32_karakter
GOOGLE_CLIENT_ID=isi_jika_pakai_google_oauth
GOOGLE_CLIENT_SECRET=isi_jika_pakai_google_oauth
GOOGLE_REDIRECT_URI=https://domain-kamu.com/api/auth/google/callback
UPLOAD_DIR=./uploads/receipts
MAX_RECEIPT_SIZE_MB=5
```
*Catatan: `PORT` biasanya disesuaikan atau diisi otomatis oleh panel Runtime Manager / reverse proxy hosting kamu.*

## 4. Menjalankan di Runtime Manager Panel Hosting
1. Buka menu **Runtime Manager** di panel hosting, lalu install **Node.js** (disarankan v20+ / v22+ / v24+).
2. Di direktori project pada server, install dependency produksi saja agar hemat ruang disk:
   ```bash
   npm install --omit=dev
   ```
3. Atur aplikasi Node.js pada Runtime Manager dengan:
   - **Startup / Entry File:** `dist/server/index.js`
   - **Application Root:** folder project tempat `package.json` dan `dist/` berada
4. Pastikan folder `uploads/receipts` memiliki izin tulis (*writable*) oleh proses Node.js, dan **tidak** diletakkan di dalam `public_html` atau folder statis publik.

## 5. Verifikasi Setelah Deploy
- Buka `https://domain-kamu.com/api/health` dan pastikan respons JSON menunjukkan:
  ```json
  {
    "ok": true,
    "data": {
      "status": "ok",
      "database": "connected"
    }
  }
  ```
- Buka `https://domain-kamu.com/` untuk memastikan halaman React termuat dengan font `Inter` dan ikon PWA.
