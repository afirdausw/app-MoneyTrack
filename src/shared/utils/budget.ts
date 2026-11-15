export type BudgetStatus = 'none' | 'ok' | 'warning' | 'over';

/** Ambang peringatan budget (persentase pemakaian). */
export const BUDGET_WARNING_PERCENT = 80;

export function budgetStatus(spentMinor: number, limitMinor: number | null): BudgetStatus {
  if (limitMinor === null || limitMinor <= 0) return 'none';
  if (spentMinor > limitMinor) return 'over';
  if (spentMinor * 100 >= limitMinor * BUDGET_WARNING_PERCENT) return 'warning';
  return 'ok';
}

/** Persentase pemakaian dibulatkan ke bawah (bisa > 100). */
export function budgetPercent(spentMinor: number, limitMinor: number | null): number {
  if (!limitMinor || limitMinor <= 0) return 0;
  return Math.floor((spentMinor * 100) / limitMinor);
}
