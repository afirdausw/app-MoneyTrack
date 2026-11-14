# Dokumentasi Project MoneyTrack

Dokumentasi lengkap arsitektur, desain database, desain produk/UI, kontrak API, roadmap pengembangan, serta panduan deployment untuk aplikasi **MoneyTrack — Multi-Mode Finance**.

## Daftar Dokumen

| Dokumen | Deskripsi |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | Arsitektur fullstack TypeScript, struktur folder, alur dev vs produksi, serta pendekatan keamanan. |
| [02-database-design.md](./02-database-design.md) | ERD 19 tabel MySQL/MariaDB, konsep *Shared Wallet* lintas ruang, *Multi-Currency*, dan catatan kompatibilitas MariaDB 10.1+. |
| [03-product-and-ux-design.md](./03-product-and-ux-design.md) | Detail fitur per mode (`Personal`, `Shared`, `Business`), matriks hak akses role, alur UX, serta panduan visual UI (PWA & font `Inter`). |
| [04-api-specification.md](./04-api-specification.md) | Standar format respons JSON dan daftar endpoint API yang sudah aktif maupun rencana endpoint MVP. |
| [05-roadmap.md](./05-roadmap.md) | Peta jalan pengembangan bertahap dari Fase 0 (Fondasi) hingga rilis MVP dan backlog lanjutan. |
| [06-deployment-shared-hosting.md](./06-deployment-shared-hosting.md) | Langkah build dan deploy aplikasi satu-proses Node.js ke shared hosting (Runtime Manager). |

## Ringkasan Visi Aplikasi
**MoneyTrack** memungkinkan satu pengguna mengelola seluruh kebutuhan keuangannya dalam satu akun melalui konsep **Multi-Workspace**:
1. **Personal (Pribadi):** Arus kas harian, *Quick Input*, budgeting per kategori, target menabung (*Goals*), dan pengingat tagihan rutin 1-klik.
2. **Shared (Pasangan / Komunitas):** Kas bersama, *Split Bill & Settlement* utang-piutang antar anggota, hak akses bertingkat (`owner`, `admin`, `member`, `viewer`), dan *Audit Log*.
3. **Business (Freelancer / UMKM):** Pencatatan arus kas bisnis, laba rugi per *Project / Klien*, dan pelacakan status *Invoice / Piutang*.
