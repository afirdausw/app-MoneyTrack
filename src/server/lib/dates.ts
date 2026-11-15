/** Rentang [awal, awal bulan berikutnya) dalam zona waktu server untuk `YYYY-MM`. */
export function monthRange(monthKey: string): { from: Date; to: Date } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return { from: new Date(year, month - 1, 1), to: new Date(year, month, 1) };
}
