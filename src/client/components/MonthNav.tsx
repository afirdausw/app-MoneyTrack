import { ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonthKey, formatMonth, shiftMonth } from '@client/lib/dates';

interface MonthNavProps {
  month: string;
  onChange: (month: string) => void;
  /** Izinkan memilih bulan setelah bulan berjalan (mis. menyiapkan budget bulan depan). */
  allowFuture?: boolean;
}

export function MonthNav({ month, onChange, allowFuture = false }: MonthNavProps) {
  const atLimit = !allowFuture && month >= currentMonthKey();
  return (
    <div className="flex items-center justify-between gap-1 sm:justify-start">
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label="Bulan sebelumnya"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-36 text-center text-sm font-semibold text-slate-900">{formatMonth(month)}</span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={atLimit}
        aria-label="Bulan berikutnya"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
