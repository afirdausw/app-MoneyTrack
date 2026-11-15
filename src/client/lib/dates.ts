/** `YYYY-MM` bulan berjalan (zona waktu perangkat). */
export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return currentMonthKey(new Date(year, month - 1 + delta, 1));
}

/** Rentang ISO [awal bulan, awal bulan berikutnya) untuk filter API. */
export function monthRangeIso(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return {
    from: new Date(year, month - 1, 1).toISOString(),
    to: new Date(year, month, 1).toISOString(),
  };
}

const monthFormatter = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return monthFormatter.format(new Date(year, month - 1, 1));
}

/** `YYYY-MM-DD` lokal untuk `<input type="date">`. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Gabungkan tanggal dari input dengan jam: pakai jam asal bila ada (edit), jam sekarang bila
 * tanggalnya hari ini, selain itu pukul 12:00 agar tidak bergeser hari karena zona waktu.
 */
export function dateInputToIso(value: string, keepTimeFrom?: Date): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const base = keepTimeFrom ?? (value === toDateInput(new Date()) ? new Date() : null);
  const date = base
    ? new Date(year, month - 1, day, base.getHours(), base.getMinutes(), base.getSeconds())
    : new Date(year, month - 1, day, 12, 0, 0);
  return date.toISOString();
}

const dayFormatter = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
export function formatDayHeading(iso: string): string {
  const date = new Date(iso);
  const today = toDateInput(new Date());
  const yesterday = toDateInput(new Date(Date.now() - 86_400_000));
  const key = toDateInput(date);
  if (key === today) return 'Hari ini';
  if (key === yesterday) return 'Kemarin';
  return dayFormatter.format(date);
}
