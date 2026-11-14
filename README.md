# MoneyTrack — Multi-Mode Finance (TypeScript)

Kerangka project aplikasi **Money Tracking Multi-Mode** (Pribadi, Pasangan/Komunitas, Freelancer/UMKM) menggunakan Fullstack TypeScript.

## Stack Teknologi
- **Frontend:** React + Vite + TypeScript + Tailwind CSS (Mobile-First Responsive + PWA)
- **Backend:** Hono + TypeScript (Node.js)
- **Database & ORM:** MySQL / MariaDB + Drizzle ORM (`mysql2`)
- **Validasi & Testing:** Zod + Vitest

## Struktur Folder
- `src/shared/` — Tipe domain (`domain.ts`), helper mata uang (`currency.ts`), dan `parseQuickInput` yang dipakai bersama oleh Frontend & Backend.
- `src/server/` — API Hono (`app.ts`, `index.ts`), konfigurasi env (`config/env.ts`), dan skema Drizzle MySQL (`db/schema/`).
- `src/client/` — Antarmuka React PWA (`App.tsx`, `components/`).
- `public/` — Aset PWA (`manifest.webmanifest`, `icon.svg`).

## Cara Menjalankan di Lokal (Laragon / Windows)
1. Salin `.env.example` menjadi `.env`, lalu sesuaikan `DATABASE_URL` MySQL kamu:
   ```env
   DATABASE_URL=mysql://root:@127.0.0.1:3306/money_tracking
   ```
2. Pastikan database `db_money_tracking` sudah dibuat di MySQL/MariaDB Laragon, lalu jalankan migrasi tabel:
   ```bash
   npm run db:migrate
   ```
3. Jalankan mode development (API + Frontend sekaligus):
   ```bash
   npm run dev
   ```
   - Frontend Vite: `http://localhost:5173`
   - API Hono: `http://localhost:3001`

## Perintah Penting
- `npm run typecheck` — Memeriksa seluruh tipe TypeScript (Client & Server).
- `npm test` — Menjalankan unit & API test dengan Vitest.
- `npm run build` — Typecheck + build Frontend (`dist/client`) + bundle Backend (`dist/server/index.js`).
- `npm start` — Menjalankan hasil build produksi dalam 1 proses Node.js (`http://localhost:3001`).

## Catatan Deploy ke Shared Hosting (Runtime Manager)
1. Jalankan `npm run build` (bisa di laptop jika RAM hosting terbatas, lalu upload `dist/`, `package.json`, `package-lock.json`, dan jalankan `npm install --omit=dev`, atau jalankan build langsung di server).
2. Di Runtime Manager panel hosting, install **Node.js**, isi environment variables (`.env`), dan arahkan entry file aplikasi ke `dist/server/index.js`.
