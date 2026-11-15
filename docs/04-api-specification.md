# 04. Rancangan Spesifikasi API

Seluruh endpoint API berada di bawah prefix `/api/*` yang dilayani oleh server **Hono** ([app.ts](../src/server/app.ts)) dengan validasi payload **Zod**.

## 1. Standar Format Respons

**Respons Sukses (`2xx`)**
```json
{
  "ok": true,
  "data": {}
}
```

**Respons Error (`4xx` / `5xx`)**
```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Penjelasan error yang dapat ditampilkan ke pengguna"
  }
}
```

## 2. Endpoint yang Sudah Aktif

| Method | Path | Deskripsi |
| --- | --- | --- |
| `GET` | `/api/health` | Mengecek status API dan koneksi pool MySQL (`connected` \| `not_configured` \| `error`). |
| `POST` | `/api/utils/parse-quick-input` | Mengurai teks transaksi cepat menjadi objek `QuickParseResult` (`type`, `amount`, `currency`, `description`, `walletHint`). |
| `GET` | `/api/auth/providers` | Mengecek kesiapan Google OAuth dan `redirectUri` yang aktif. |
| `GET` | `/api/auth/google` | Redirect ke halaman OAuth Google dengan `state` cookie anti-CSRF. |
| `GET` | `/api/auth/google/callback` | Callback Google OAuth untuk login/daftar otomatis + provisioning Workspace Pribadi awal. |
| `POST` | `/api/auth/logout` | Menghapus sesi aktif di database dan cookie. |
| `GET` | `/api/auth/me` | Mengambil profil pengguna aktif beserta daftar Workspace-nya. |
| `GET` | `/api/workspaces` | Daftar Workspace yang diikuti user aktif (urut waktu bergabung). |
| `POST` | `/api/workspaces` | Membuat Workspace (`name`, `type`, `primaryCurrency`, opsional `icon`/`color`); user jadi `owner` + kategori default sesuai mode. `201`. |
| `GET` | `/api/workspaces/:wsId` | Detail Workspace + `role`, `memberCount`, `categoryCount` (min. `viewer`). |
| `PATCH` | `/api/workspaces/:wsId` | Ubah `name`, `primaryCurrency`, `icon`, dan/atau `color` (min. `admin`; `null` mengembalikan ikon/warna ke bawaan mode). `409 CURRENCY_LOCKED` bila mata uang diganti setelah ada transaksi. |
| `DELETE` | `/api/workspaces/:wsId` | Hapus Workspace beserta data turunannya (khusus `owner`). `409 LAST_WORKSPACE` bila itu Workspace terakhir user. |

| `GET` | `/api/workspaces/:wsId/members` | Daftar anggota beserta role (min. `viewer`). |
| `GET` | `/api/workspaces/:wsId/invites` | Undangan yang belum dipakai & belum kedaluwarsa (min. `admin`). Token tidak pernah ditampilkan ulang. |
| `POST` | `/api/workspaces/:wsId/invites` | Membuat link undangan sekali pakai (`role`, `email?`, `expiresInDays` 1/7/30). Respons `201` berisi `inviteUrl` (satu-satunya kesempatan melihat token). Role `admin` hanya bisa diberikan `owner`. |
| `DELETE` | `/api/workspaces/:wsId/invites/:inviteId` | Membatalkan undangan yang belum dipakai (min. `admin`). |
| `GET` | `/api/invites/:token` | **Publik.** Preview undangan (nama Workspace, mode, role, pengundang, `status`: `pending`/`expired`/`used`). |
| `POST` | `/api/invites/:token/accept` | Menerima undangan (login wajib). Bila user sudah anggota, mengembalikan Workspace dengan `alreadyMember: true` tanpa memakai undangan. Error: `INVITE_NOT_FOUND` 404, `INVITE_EXPIRED`/`INVITE_USED` 410, `INVITE_EMAIL_MISMATCH` 403. |

| `GET` | `/api/wallets` | Dompet milik user aktif beserta Workspace tempat dompet ditautkan. |
| `PATCH` / `DELETE` | `/api/wallets/:walletId` | Ubah nama/jenis/`icon`/`color` (`null` = bawaan jenis), atau hapus dompet (khusus pemilik; hapus ditolak `409 WALLET_IN_USE` bila sudah ada transaksi). |
| `GET` | `/api/workspaces/:wsId/wallets` | Dompet yang tertaut ke Workspace + saldo, `visibilityMode`, pemilik (min. `viewer`). |
| `POST` | `/api/workspaces/:wsId/wallets` | Membuat dompet milik user + langsung menautkan (`name`, `kind`, `currency`, `openingBalanceMinor`, `visibilityMode`, opsional `icon`/`color`; min. `admin`). |
| `POST` | `/api/workspaces/:wsId/wallets/link` | Menautkan dompet milik sendiri yang sudah ada (min. `admin`). `409 WALLET_ALREADY_LINKED`. |
| `PATCH` | `/api/workspaces/:wsId/wallets/:walletId` | Ubah `visibilityMode` — **hanya pemilik dompet** (menentukan apakah riwayatnya terbuka ke Workspace lain). |
| `DELETE` | `/api/workspaces/:wsId/wallets/:walletId` | Lepas tautan (pemilik dompet atau admin). `409 WALLET_IN_USE` bila sudah ada transaksi dompet itu di Workspace ini. |
| `GET` | `/api/workspaces/:wsId/categories` | Kategori masuk/keluar Workspace (min. `viewer`). |
| `POST` / `PATCH` / `DELETE` | `/api/workspaces/:wsId/categories[/:categoryId]` | Kelola kategori kustom (`name`, `type` saat buat, `color`, `icon`; min. `admin`). Nama unik per jenis (`409 CATEGORY_EXISTS`). Hapus: transaksi lama jadi tanpa kategori, budget kategori ikut terhapus. |
| `GET` | `/api/workspaces/:wsId/budgets?month=YYYY-MM` | Batas & pemakaian per kategori pengeluaran (dari `convertedAmountMinor`), total, dan pengeluaran di luar budget. |
| `PUT` | `/api/workspaces/:wsId/budgets` | Atur batas `{ month, categoryId, limitMinor }` (upsert; `limitMinor: null` menghapus; min. `admin`). |
| `POST` | `/api/workspaces/:wsId/budgets/copy` | Salin batas `{ fromMonth, toMonth }` tanpa menimpa yang sudah ada. |
| `GET` / `POST` | `/api/workspaces/:wsId/goals` | Daftar target (+ `monthlyNeededMinor` dari tenggat) / buat target (`name`, `targetMinor`, `initialMinor`, `deadline`). |
| `PATCH` / `DELETE` | `/api/workspaces/:wsId/goals/:goalId` | Ubah / hapus target (min. `admin`). |
| `GET` / `POST` | `/api/workspaces/:wsId/goals/:goalId/contributions` | Riwayat setoran / setor (+) atau tarik (−) `amountMinor` secara atomik (`409 GOAL_NEGATIVE` bila saldo target jadi negatif). Riwayat disimpan di `audit_logs` (`entity_type = goal_contribution`). |
| `GET` / `POST` | `/api/workspaces/:wsId/recurring` | Daftar tagihan rutin (+ `dueStatus`: `overdue`/`due_today`/`due_soon`/`upcoming`, `daysUntilDue`) / buat tagihan (min. `admin`). Mata uang mengikuti dompet. |
| `PATCH` / `DELETE` | `/api/workspaces/:wsId/recurring/:billId` | Ubah (termasuk `isActive`) / hapus tagihan; transaksi pembayaran lama tetap ada. |
| `POST` | `/api/workspaces/:wsId/recurring/:billId/skip` | Lewati satu periode tanpa transaksi (min. `admin`). |
| `GET` | `/api/workspaces/:wsId/overview?month=YYYY-MM` | Total saldo (mata uang utama), pemasukan & pengeluaran bulan itu, 5 transaksi terakhir, `dueBills` (tagihan aktif terlambat/≤ 7 hari) dan `budgetAlerts` (budget ≥ 80%). |
| `GET` | `/api/workspaces/:wsId/transactions` | Daftar mutasi; filter `from`, `to` (ISO), `type`, `walletId`, `categoryId`; paginasi `limit` + `before` (cursor `nextCursor`). Ikut menampilkan transaksi Workspace lain pada dompet `full_transparent` (`sourceWorkspaceName`, `canEdit: false`). |
| `GET` | `/api/workspaces/:wsId/transactions/:txId` | Detail + daftar struk (struk hanya untuk transaksi milik Workspace ini). |
| `POST` | `/api/workspaces/:wsId/transactions` | Catat `income`/`expense`/`transfer` (min. `member`). Saldo dompet diperbarui dalam DB transaction yang sama + `audit_logs`. **Bayar 1-Klik:** kirim `recurringBillId` → tagihan dikunci dan `next_due_date` dimajukan satu periode di transaksi DB yang sama (`RECURRING_NOT_FOUND`, `RECURRING_INACTIVE`, `RECURRING_TYPE_MISMATCH`). |
| `PATCH` | `/api/workspaces/:wsId/transactions/:txId` | Ubah transaksi: efek lama dibalik, efek baru diterapkan (admin semua, member hanya miliknya). |
| `DELETE` | `/api/workspaces/:wsId/transactions/:txId` | Hapus + balik saldo + hapus file struk. |
| `POST` | `/api/workspaces/:wsId/transactions/:txId/receipts` | Upload struk (`multipart/form-data`, field `file`, JPG/PNG/WebP, maks. `MAX_RECEIPT_SIZE_MB`, maks. 5 per transaksi). Jenis file dicek dari isi (magic bytes). |
| `GET` / `DELETE` | `/api/workspaces/:wsId/receipts/:receiptId` | Tampilkan struk (min. `viewer`, `Cache-Control: private, no-store`) / hapus struk. |

**Transaksi & mata uang:** `amountMinor` selalu dalam mata uang dompet. Bila berbeda dari mata uang utama Workspace, `exchangeRate` wajib (string desimal, maks. 6 angka di belakang koma; `400 EXCHANGE_RATE_REQUIRED`) dan `convertedAmountMinor` dihitung dengan aritmetika integer (BigInt). Transfer antar mata uang berbeda belum didukung (`TRANSFER_CURRENCY_MISMATCH`). Kode error lain: `WALLET_NOT_LINKED`, `TARGET_WALLET_NOT_LINKED`, `CATEGORY_INVALID`, `TRANSACTION_NOT_FOUND`, `FORBIDDEN`, `FILE_TOO_LARGE` 413, `UNSUPPORTED_FILE` 415, `RECEIPT_LIMIT` 409.

| `PATCH` | `/api/workspaces/:wsId/members/:userId` | Ubah role anggota (`admin`/`member`/`viewer`). Owner atas siapa pun kecuali owner; admin hanya atas member/viewer dan tidak bisa memberi role admin. Tidak bisa mengubah diri sendiri (`CANNOT_CHANGE_SELF`). |
| `DELETE` | `/api/workspaces/:wsId/members/:userId` | Keluarkan anggota (aturan sama), atau keluar sendiri bila `:userId` = diri sendiri (owner tidak bisa: `OWNER_CANNOT_LEAVE`). Dompet anggota yang belum dipakai dilepas; yang sudah dipakai diturunkan ke `workspace_only`. |
| `GET` | `/api/workspaces/:wsId/shared-cash?month=YYYY-MM` | Kas bersama: kontribusi per anggota (pemasukan/pengeluaran yang dicatat, total talangan bulan itu, posisi split bersih) + saran settlement netto per pasangan (`canSettle`). |
| `GET` / `POST` | `/api/workspaces/:wsId/splits` | Daftar split bill / catat split (`title`, `totalMinor`, `paidByUserId`, `mode: equal\|custom`, `participants`; min. `member`). Bagi rata membagikan sisa pembulatan 1 minor unit per orang; mode custom harus berjumlah tepat = total. Porsi pembayar otomatis lunas. |
| `DELETE` | `/api/workspaces/:wsId/splits/:splitId` | Hapus split (pembayar atau admin). |
| `POST` | `/api/workspaces/:wsId/splits/settle` | Tandai lunas semua porsi terbuka antara `{ fromUserId, toUserId }` (dua arah) setelah transfer netto. Hanya penerima uang (`toUserId`) atau admin. `409 NOTHING_TO_SETTLE` bila tidak ada utang bersih ke arah itu. |
| `GET` | `/api/workspaces/:wsId/audit-logs` | Riwayat aktivitas (min. `viewer`) dengan kalimat ringkas (`summary`); filter `entityType` (`transaction`, `split`, `member`, `wallet`, `goal_contribution`, `workspace`), paginasi `limit` + `before`. |

**Audit log** dicatat untuk: transaksi (buat/ubah/hapus), setoran target, split bill (buat/hapus/lunas), anggota (bergabung/ubah role/dikeluarkan/keluar), dompet (tautkan/lepas/ubah visibilitas), dan pengaturan Workspace.

| `GET` / `POST` | `/api/workspaces/:wsId/clients` | Daftar klien (+ jumlah project, nilai ditagih/terbayar/piutang, profit) / tambah klien (min. `admin`). |
| `PATCH` / `DELETE` | `/api/workspaces/:wsId/clients/:clientId` | Ubah / hapus klien (project & invoice tetap ada tanpa klien). |
| `GET` / `POST` | `/api/workspaces/:wsId/projects` | Daftar project (+ omzet, biaya, profit dari transaksi tertaut, `budgetMinor`) / tambah project (`name`, `clientId`, `status`, `budgetMinor`). |
| `PATCH` / `DELETE` | `/api/workspaces/:wsId/projects/:projectId` | Ubah / hapus project (transaksi dilepas dari project, tidak dihapus). |
| `GET` / `POST` | `/api/workspaces/:wsId/invoices` | Daftar invoice (+ `status` tampilan termasuk `overdue`, `paidMinor`, `paymentCount`) / buat invoice (`number` opsional → otomatis `INV-YYYYMM-NNN`, `title`, `amountMinor`, `clientId`, `projectId`, `issuedAt`, `dueDate`, `status: draft\|sent`). `409 INVOICE_NUMBER_TAKEN` bila nomor dipakai. |
| `PATCH` / `DELETE` | `/api/workspaces/:wsId/invoices/:invoiceId` | Ubah (status lunas/sebagian dihitung ulang) / hapus invoice (transaksi pembayaran dilepas, tidak dihapus). |

**Mode bisnis — transaksi:** `POST/PATCH /transactions` menerima `projectId` (pemasukan/pengeluaran) dan `invoiceId` (khusus pemasukan; project ikut dari invoice bila kosong). `paid_minor` & status invoice dihitung ulang dari total `convertedAmountMinor` pemasukan yang tertaut, di DB transaction yang sama dengan create/update/delete transaksi. Error: `PROJECT_NOT_FOUND`, `INVOICE_NOT_FOUND`. Status `overdue` tidak disimpan — dihitung saat dibaca (terkirim, belum lunas, lewat jatuh tempo).

| `GET` | `/api/workspaces/:wsId/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | Ringkasan periode (maks. 1 tahun): pemasukan, pengeluaran, selisih, per kategori, per dompet, per project. |
| `GET` | `/api/workspaces/:wsId/reports/trend?end=YYYY-MM&months=6` | Pemasukan & pengeluaran per bulan (2–24 bulan, bulan kosong tetap ada). |
| `GET` | `/api/workspaces/:wsId/reports/export?from&to&format=xlsx\|csv` | Unduh transaksi periode. XLSX berisi sheet *Transaksi* + *Ringkasan Kategori* (pengeluaran bernilai negatif, nominal asli + terkonversi); CSV UTF-8 ber-BOM. `Cache-Control: private, no-store`. |

**Pencarian transaksi:** `GET /transactions` juga menerima `q` (keterangan/catatan, tidak peka huruf besar/kecil, `%`/`_` dicari apa adanya), `categoryId`, `minAmount`/`maxAmount` (minor unit mata uang Workspace, dibandingkan dengan nominal terkonversi). Tanpa `from`/`to` = semua periode.

**Undangan:** token acak 48 hex; DB hanya menyimpan hash SHA-256-nya (`workspace_invites.token`). Link berbentuk `${APP_URL}/invite/<token>`; klaim undangan dilakukan atomik (`accepted_at IS NULL`) agar satu link tidak bisa dipakai dua orang.

**Otorisasi Workspace (`requireWorkspaceRole`):** route dengan `:wsId` mengembalikan `400 VALIDATION_ERROR` untuk ID tidak valid, `404 WORKSPACE_NOT_FOUND` bila user bukan anggota (keberadaan Workspace orang lain tidak dibocorkan), dan `403 FORBIDDEN` bila role kurang.

## 3. Rencana Berikutnya

Seluruh endpoint MVP (Fase 1–5) sudah aktif di bagian 2. Rencana berikutnya ada di [05-roadmap.md](./05-roadmap.md) (Fase 6 & backlog).

## 4. Keamanan Lintas Endpoint

- **Header:** CSP ketat (`default-src 'self'`, gambar dari `*.googleusercontent.com`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (kamera hanya untuk origin sendiri), HSTS bila `APP_URL` https.
- **CSRF:** cookie `SameSite=Lax` + penolakan request pengubah data (`POST/PUT/PATCH/DELETE`) yang `Origin`/`Sec-Fetch-Site`-nya situs lain → `403 CSRF_REJECTED`.
- **Rate limit** (per IP, memori proses; IP dari `X-Forwarded-For` hanya bila `TRUST_PROXY=true`): umum 600/menit, login Google 30/10 menit, undangan 60/10 menit, upload struk 60/10 menit → `429 RATE_LIMITED` + `Retry-After`.
- **Body:** JSON maks. 256 KB (`413 PAYLOAD_TOO_LARGE`); upload struk memakai batas `MAX_RECEIPT_SIZE_MB`.
- **Error:** rute API tak dikenal → `404 NOT_FOUND` JSON; error tak terduga → `500 INTERNAL_ERROR` tanpa detail internal (detail dicatat di log server).
- **Produksi:** server menolak start bila `SESSION_SECRET` bawaan/kurang dari 32 karakter.

## Kustomisasi Tampilan
- `icon` harus salah satu kunci di `APPEARANCE_ICONS` (`@shared/utils/appearance`, nama ikon lucide kebab-case, mis. `wallet`, `home`, `coffee`); selain itu `400 VALIDATION_ERROR`.
- `color` harus hex `#RRGGBB`. UI menawarkan palet `APPEARANCE_COLORS`, tapi server menerima hex apa pun.
- `WorkspaceSummary` dan `WorkspaceWallet`/`MyWallet` menyertakan `icon` & `color` (`null` = bawaan: Workspace per mode, dompet per jenis — dipetakan di client `@client/lib/appearance`).
- Mode privasi (sembunyikan nominal) murni di client, disimpan per perangkat (`localStorage`), tanpa endpoint.
