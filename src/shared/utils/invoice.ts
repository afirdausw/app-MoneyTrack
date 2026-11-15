import { daysBetween } from '@shared/utils/schedule';

/** Status yang disimpan di DB. `overdue` tidak disimpan — dihitung saat dibaca dari jatuh tempo. */
export type StoredInvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid';
export type InvoiceStatusView = StoredInvoiceStatus | 'overdue';

/** Status tersimpan setelah total pembayaran berubah (dari transaksi pemasukan yang ditautkan). */
export function statusAfterPayment(
  current: StoredInvoiceStatus,
  paidMinor: number,
  amountMinor: number
): StoredInvoiceStatus {
  if (paidMinor >= amountMinor) return 'paid';
  if (paidMinor > 0) return 'partial';
  // Pembayaran dihapus seluruhnya: kembali ke "terkirim" (draft tetap draft).
  return current === 'draft' ? 'draft' : 'sent';
}

/** Status untuk ditampilkan: invoice terkirim yang lewat jatuh tempo & belum lunas menjadi `overdue`. */
export function effectiveInvoiceStatus(
  invoice: { status: StoredInvoiceStatus; paidMinor: number; amountMinor: number; dueDate: string | null },
  todayKey: string
): InvoiceStatusView {
  if (invoice.paidMinor >= invoice.amountMinor) return 'paid';
  if (invoice.status !== 'draft' && invoice.dueDate && daysBetween(todayKey, invoice.dueDate) < 0) return 'overdue';
  return invoice.status === 'paid' ? 'partial' : invoice.status;
}

/** Nomor invoice berikutnya berformat `INV-YYYYMM-NNN` berdasarkan nomor yang sudah ada di bulan tsb. */
export function nextInvoiceNumber(monthKey: string, existing: string[]): string {
  const prefix = `INV-${monthKey.replace('-', '')}-`;
  const used = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isSafeInteger(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}
