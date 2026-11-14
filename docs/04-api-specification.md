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

## 3. Rancangan Endpoint MVP (Tahap Implementasi Berikutnya)

### A. Autentikasi & Sesi
*Sudah aktif pada daftar di atas (mode minimal Google OAuth + session cookie `HttpOnly`).*

### B. Workspace, Anggota & Undangan
| Method | Path | Deskripsi |
| --- | --- | --- |
| `GET` | `/api/workspaces` | Daftar Workspace yang diikuti user aktif. |
| `POST` | `/api/workspaces` | Membuat Workspace baru (`personal` \| `shared` \| `business`). |
| `PATCH` | `/api/workspaces/:wsId` | Memperbarui nama atau `primaryCurrency` Workspace (`owner`/`admin`). |
| `POST` | `/api/workspaces/:wsId/invites` | Membuat link/undangan email dengan role tertentu. |
| `POST` | `/api/invites/:token/accept` | Menerima undangan dan bergabung ke Workspace. |
| `PATCH` | `/api/workspaces/:wsId/members/:userId` | Mengubah role anggota atau mengeluarkan anggota. |
| `GET` | `/api/workspaces/:wsId/audit-logs` | Melihat riwayat aktivitas perubahan data Workspace. |

### C. Dompet (Wallets) & Tautan Lintas Ruang
| Method | Path | Deskripsi |
| --- | --- | --- |
| `GET` | `/api/wallets` | Daftar seluruh dompet milik user aktif. |
| `POST` | `/api/wallets` | Membuat dompet baru dan langsung menautkannya ke Workspace aktif. |
| `GET` | `/api/workspaces/:wsId/wallets` | Daftar dompet yang tertaut ke Workspace beserta `visibilityMode`. |
| `POST` | `/api/workspaces/:wsId/wallets/link` | Menautkan dompet existing ke Workspace (`workspace_only` \| `full_transparent`). |
| `PATCH` | `/api/workspaces/:wsId/wallets/:walletId` | Mengubah `visibilityMode` atau melepas tautan dompet. |

### D. Transaksi, Struk & Kategori
| Method | Path | Deskripsi |
| --- | --- | --- |
| `GET` | `/api/workspaces/:wsId/categories` | Daftar kategori masuk/keluar Workspace. |
| `POST` | `/api/workspaces/:wsId/categories` | Menambah kategori kustom. |
| `GET` | `/api/workspaces/:wsId/transactions` | Daftar mutasi (menghormati aturan `visibilityMode` dompet tertaut), filter tanggal/kategori/dompet. |
| `POST` | `/api/workspaces/:wsId/transactions` | Mencatat `income`, `expense`, atau `transfer` dan memperbarui saldo dompet dalam transaksi DB atomik. |
| `PATCH` | `/api/workspaces/:wsId/transactions/:txId` | Mengubah transaksi + menyesuaikan selisih saldo dompet + menulis `audit_logs`. |
| `DELETE` | `/api/workspaces/:wsId/transactions/:txId` | Menghapus transaksi + membalikkan saldo dompet + menulis `audit_logs`. |
| `POST` | `/api/workspaces/:wsId/transactions/:txId/receipt` | Upload foto struk terkompresi ke `UPLOAD_DIR`. |
| `GET` | `/api/workspaces/:wsId/receipts/:receiptId` | Mengunduh/menampilkan foto struk setelah cek keanggotaan Workspace. |

### E. Budget, Goals & Tagihan Rutin
| Method | Path | Deskripsi |
| --- | --- | --- |
| `GET` / `PUT` | `/api/workspaces/:wsId/budgets` | Mengatur dan memantau batas pengeluaran bulanan per kategori. |
| `GET` / `POST` / `PATCH` | `/api/workspaces/:wsId/goals` | Mengelola target tabungan dan menambah setoran progres tabungan. |
| `GET` / `POST` | `/api/workspaces/:wsId/recurring` | Daftar tagihan rutin & jadwal pengingat jatuh tempo. |
| `POST` | `/api/workspaces/:wsId/recurring/:id/confirm` | Konfirmasi **1-klik Bayar** (mencatat transaksi dan memajukan `nextDueDate`). |

### F. Split Bill (Shared) & Project/Invoice (Business)
| Method | Path | Deskripsi |
| --- | --- | --- |
| `GET` / `POST` | `/api/workspaces/:wsId/splits` | Mencatat pengeluaran patungan dan melihat ringkasan *settlement* antar anggota. |
| `POST` | `/api/workspaces/:wsId/splits/:splitId/settle` | Menandai porsi utang anggota telah dilunasi. |
| `GET` / `POST` | `/api/workspaces/:wsId/clients` | Mengelola daftar klien pada Workspace Bisnis. |
| `GET` / `POST` | `/api/workspaces/:wsId/projects` | Mengelola proyek dan melihat ringkasan omzet, biaya, serta profit bersih per proyek. |
| `GET` / `POST` / `PATCH` | `/api/workspaces/:wsId/invoices` | Mengelola status tagihan klien (`draft` -> `sent` -> `partial`/`paid`). |
