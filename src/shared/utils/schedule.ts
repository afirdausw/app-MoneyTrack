/**
 * Utilitas tanggal berbasis "date key" `YYYY-MM-DD` (tanpa jam & zona waktu) untuk jatuh tempo,
 * agar perhitungan tagihan rutin tidak bergeser hari karena perbedaan zona waktu server/klien.
 */

export const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function parse(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** true bila `key` berformat benar dan tanggalnya ada di kalender (menolak 2026-02-30). */
export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_PATTERN.test(key)) return false;
  const [y, m, d] = parse(key);
  return d <= daysInMonth(y, m);
}

/** Date key dari tanggal lokal perangkat/server. */
export function toDateKey(date: Date): string {
  return format(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Date key → Date pukul 12:00 waktu lokal (aman disimpan di DATETIME tanpa bergeser hari). */
export function dateKeyToDate(key: string): Date {
  const [y, m, d] = parse(key);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Majukan tanggal satu periode. Bulanan/tahunan memotong ke akhir bulan bila perlu
 * (31 Jan → 28/29 Feb, 29 Feb → 28 Feb tahun berikutnya).
 */
export function advanceDateKey(key: string, frequency: RecurringFrequency): string {
  const [y, m, d] = parse(key);
  if (frequency === 'weekly') {
    const next = new Date(Date.UTC(y, m - 1, d + 7));
    return format(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  if (frequency === 'monthly') {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return format(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  }
  return format(y + 1, m, Math.min(d, daysInMonth(y + 1, m)));
}

/** Selisih hari `to - from` (negatif bila `to` sebelum `from`). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parse(from);
  const [ty, tm, td] = parse(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export type DueStatus = 'overdue' | 'due_today' | 'due_soon' | 'upcoming';

/** Batas "segera jatuh tempo" untuk kartu pengingat dashboard. */
export const DUE_SOON_DAYS = 7;

export function dueStatus(nextDueKey: string, todayKey: string): DueStatus {
  const diff = daysBetween(todayKey, nextDueKey);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'due_today';
  if (diff <= DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

/** Jumlah bulan kalender tersisa sampai tenggat (minimal 1 bila tenggat belum lewat). */
export function monthsUntil(todayKey: string, deadlineKey: string): number {
  const [ty, tm] = parse(todayKey);
  const [dy, dm] = parse(deadlineKey);
  return Math.max(1, (dy - ty) * 12 + (dm - tm) + 1);
}
