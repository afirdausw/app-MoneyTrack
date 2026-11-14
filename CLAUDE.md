# CLAUDE.md

Panduan untuk Claude Code saat bekerja di repositori ini.

## Ringkasan
MoneyTrack — aplikasi money tracking multi-workspace (`personal`, `shared`, `business`) dalam satu repo Fullstack TypeScript (bukan monorepo multi-paket). Dokumentasi lengkap ada di `docs/` (arsitektur, desain DB, UX, API, roadmap, deploy). Bahasa dokumentasi, pesan error API, dan teks UI: **Bahasa Indonesia**.

## Perintah
- `npm run dev` — API Hono (tsx watch, :3001) + Vite (:5173, proxy `/api` → :3001).
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
- Nominal uang disimpan sebagai integer *minor unit* (`BIGINT`) — jangan pakai float. Gunakan helper di `@shared/utils/currency`.
- Endpoint yang menyentuh data workspace wajib cek keanggotaan `workspace_members` + role (`owner`/`admin`/`member`/`viewer`).
- Session: cookie `HttpOnly`, token di-hash SHA-256 di tabel `sessions`.
- Struk disimpan di `UPLOAD_DIR` (di luar `public/`), hanya disajikan via endpoint berautentikasi.
- Skema harus kompatibel MariaDB 10.1+ (target shared hosting) — lihat `docs/02-database-design.md`.
- Test API dijalankan in-memory via `createApp().request(...)`, tanpa membuka port.

## Status
Fase 0 dan Fase 1A selesai (fondasi, skema 19 tabel, Google OAuth, session). Langkah berikutnya mengikuti `docs/05-roadmap.md` (Fase 1B: `requireWorkspaceRole`, CRUD workspace, undangan). Perbarui checklist roadmap dan `docs/04-api-specification.md` saat menambah fitur/endpoint.
