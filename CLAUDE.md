# CLAUDE.md

Panduan untuk Claude Code saat bekerja di repositori ini.

## Ringkasan
MoneyTrack — aplikasi money tracking multi-workspace (`personal`, `shared`, `business`) dalam satu repo Fullstack TypeScript (bukan monorepo multi-paket). Dokumentasi lengkap ada di `docs/` (arsitektur, desain DB, UX, API, roadmap, deploy). Bahasa dokumentasi, pesan error API, dan teks UI: **Bahasa Indonesia**.

## Perintah
- `npm run dev` — API Hono (`node --watch --import tsx`, :3001) + Vite (:5173, proxy `/api` → :3001).
- `npm run typecheck` — typecheck client (`tsconfig.client.json`) lalu server (`tsconfig.server.json`).
- `npm test` — Vitest (`src/**/*.test.ts`). Satu file: `npx vitest run src/shared/utils/quick-parser.test.ts`.
- `npm run build` / `npm start` — build produksi; satu proses Node menyajikan API + `dist/client`.
- `npm run db:generate` (setelah ubah skema) → `npm run db:migrate`. Migrasi di `drizzle/`, jangan diedit manual.

Selalu jalankan `npm run typecheck` dan `npm test` sebelum menyatakan pekerjaan selesai.

## Arsitektur
- `src/shared/` — kode murni lintas client & server: tipe domain, helper mata uang, quick-input parser, skema Zod. Tidak boleh import modul Node maupun API browser.
- `src/server/` — Hono. `app.ts` (`createApp`) mendaftarkan route; `index.ts` bootstrap server. `config/env.ts` validasi env via Zod; `db/` pool mysql2 + skema Drizzle (`db/schema/*.ts`, diekspor lewat `index.ts`); `routes/`, `services/`, `middleware/` (`requireAuth`), `lib/` (`http.ts`, `security.ts`).
- `src/client/` — React 19 + Tailwind v4, komponen di `components/`, pemanggil API di `lib/api.ts`. Form memakai React Hook Form + `zodResolver` dengan skema dari `@shared/validation`.
- Alias path: `@shared/*`, `@client/*`, `@server/*`. Client **tidak** punya alias `@server` (sengaja — client tidak boleh import kode server).

## Konvensi
- Respons API selalu lewat `jsonOk(c, data)` / `jsonError(c, status, CODE, pesan)` dari `@server/lib/http` → `{ ok: true, data }` atau `{ ok: false, error: { code, message } }`.
- Validasi payload dengan Zod `safeParse`; error pertama dikembalikan sebagai `VALIDATION_ERROR` 400.
- Nominal uang disimpan sebagai integer *minor unit* (`BIGINT`) — jangan pakai float. Gunakan helper di `@shared/utils/currency` dan `@shared/utils/money` (`parseAmountInput`, `convertMinor` berbasis BigInt, kurs sebagai string).
- Saldo dompet (`wallets.balance_minor`) hanya diubah di `transaction-service` lewat `applyBalance`, di dalam `db.transaction` yang sama dengan insert/update/delete transaksi. Jangan ubah saldo di tempat lain. Panggil `lockWallets(tx, …)` (FOR UPDATE, urut id) sebelum menulis — tanpa itu penulisan paralel deadlock (FK INSERT ambil shared lock, UPDATE saldo minta exclusive) — dan bungkus dengan `withDeadlockRetry`.
- Tanggal jatuh tempo/tenggat memakai date key `YYYY-MM-DD` (`@shared/utils/schedule`): disimpan sebagai DATETIME pukul 12:00 lokal (`dateKeyToDate`) dan dibaca dengan `toDateKey`, agar tidak bergeser hari.
- Zona waktu: koneksi DB memakai `time_zone = '+00:00'` karena Drizzle memperlakukan DATETIME/TIMESTAMP sebagai UTC (lihat `db/index.ts` & `db/timezone.test.ts`). Jangan bandingkan tanggal dengan `NOW()` di SQL tanpa memperhitungkan ini.
- Mode bisnis: route `routes/business.ts` + `services/business-service.ts`. `paid_minor`/status invoice hanya diubah lewat `recomputeInvoices(tx, …)` di transaksi DB yang sama dengan perubahan transaksi; `overdue` dihitung saat dibaca.
- Keamanan: middleware di `middleware/security.ts` (header, `originGuard`, `rateLimit`, `jsonBodyLimit`) dipasang di `createApp`. Rate limit nonaktif saat `NODE_ENV=test`; aktifkan per test dengan `createApp({ rateLimit: true })`.
- PWA: `public/sw.js` (diuji di `src/client/lib/sw.test.ts` dengan lingkungan SW tiruan), didaftarkan hanya di build produksi. Jangan cache `/api`. Pane browser Claude tidak mendukung service worker — verifikasi lewat test atau browser biasa.
- Laporan: `routes/reports.ts` + `services/report-service.ts`; XLSX ditulis tanpa dependensi oleh `lib/xlsx.ts` (inline string, aman dari formula injection). Collation DB bisa `utf8mb4_bin` (case-sensitive) — pakai `lower()` untuk pencarian teks.
- Grafik: warna seri dari panduan dataviz (pemasukan teal `#0d9488`, pengeluaran oranye `#eb6834`; pasangan hijau–merah gagal uji CVD).
- Audit: tulis lewat `recordAudit(db | tx, …)` (`services/audit-service.ts`) di dalam DB transaction yang sama dengan perubahan. Tambahkan kalimatnya di `summarizeAudit` bila menambah jenis entitas baru.
- Route kolaborasi (anggota, split bill, kas bersama, audit log) ada di `routes/collab.ts`; perhitungan split murni di `@shared/utils/split`.
- Route perencanaan (kategori, budget, target, tagihan rutin) ada di `routes/planning.ts` + `services/planning-service.ts`; kelola = `canManagePlanning` (admin+), baca = viewer+.
- Route keuangan ada di `routes/finance.ts`, dipasang lewat `workspaceRoutes.route('/:wsId', financeRoutes)` (auth sudah dijalankan parent). File struk lewat `@server/lib/storage` (path relatif di DB, cek path traversal, sniff magic bytes).
- Endpoint yang menyentuh data workspace dipasang di bawah `/api/workspaces/:wsId/...` dengan `requireAuth` + `requireWorkspaceRole(minRole)` (`@server/middleware/workspace`), lalu ambil `c.get('workspace')`. Aturan role ada di `@shared/utils/permissions` (dipakai server & UI) sesuai matriks di `docs/03-product-and-ux-design.md`.
- Session: cookie `HttpOnly`, token di-hash SHA-256 di tabel `sessions`. Token undangan juga hanya disimpan sebagai hash (`hashInviteToken`).
- Client tanpa router: `App.tsx` menangani sesi, undangan, dan dialog workspace; `AppShell.tsx` menangani navigasi halaman (`pages/`) lewat state `view`. Path URL hanya dipakai untuk `/invite/<token>`; server produksi mengembalikan `index.html` untuk path non-API.
- Modal memakai `components/Modal.tsx` (`open` + `onExited` agar animasi tutup jalan). Form memakai RHF `mode: 'onSubmit'` + `reValidateMode: 'onChange'`, dan `Select` dari `FormField.tsx`.
- `Select` (`components/Select.tsx`) adalah dropdown kustom (pencarian bila > 6 opsi, keyboard, daftar via portal) tapi API-nya tetap `<select>`: children `<option>`, `register()` RHF, `value`/`onChange`. Di baliknya ada `<select>` asli tersembunyi; jangan pakai `<select>` mentah.
- Kustomisasi tampilan: kunci ikon & palet di `@shared/utils/appearance` (validasi `@shared/validation/appearance`); pemetaan ke komponen lucide + bawaan per mode/jenis di `@client/lib/appearance`; picker `components/AppearancePicker.tsx`. `icon`/`color` Workspace & dompet nullable (`NULL` = bawaan). Menambah ikon = tambah kunci di kedua tempat.
- Dark mode: `@client/lib/theme` memasang kelas `dark` di `<html>`; `index.css` menukar variabel palet Tailwind (tanpa `dark:` per kelas). Pakai warna palet Tailwind (bukan hex) agar ikut tema; overlay gelap pakai `bg-black/…`. Warna baru di luar palet yang ditukar → tambahkan di blok `:root.dark`.
- Nominal yang ditampilkan di UI pakai `formatMoney` dari `@client/lib/privacy` (hormati mode privasi); gema nominal yang sedang diketik user pakai versi `@shared/utils/currency`.
- Struk disimpan di `UPLOAD_DIR` (di luar `public/`), hanya disajikan via endpoint berautentikasi.
- Skema harus kompatibel MariaDB 10.1+ (target shared hosting) — lihat `docs/02-database-design.md`.
- Test API dijalankan in-memory via `createApp().request(...)`, tanpa membuka port. Test yang butuh DB memakai `skipIf(!env.DATABASE_URL)`, membuat user `*@example.test` sendiri, dan menghapusnya di `afterAll`.
- `.claude/launch.json` berisi dua konfigurasi preview terpisah (`moneytrack-api` :3001, `moneytrack-web` :5173) karena preview tool menyuntikkan `PORT` sesuai port konfigurasi.
- Dev server API memakai `node --watch --import tsx` (bukan `tsx watch`, yang macet tanpa pesan di bawah `concurrently` di Windows).

## Status
Fase 0–5 selesai (fondasi, auth, multi-workspace & undangan, dompet lintas ruang, transaksi + saldo atomik, kurs, Quick Input, struk privat, kategori, budget, target, tagihan rutin, kas bersama, split bill, audit log, kelola anggota, klien/project/invoice). Fase 6 (PWA + hardening) dan backlog laporan/ekspor/grafik/pencarian juga selesai; deploy ditunda. Sisa backlog: kurs otomatis, impor mutasi bank. Perbarui checklist roadmap dan `docs/04-api-specification.md` saat menambah fitur/endpoint.
