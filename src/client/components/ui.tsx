import { type ChangeEvent, type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { getInputClassName } from '@client/components/FormField';
import type { CurrencyCode } from '@shared/types/domain';
import { type BudgetStatus } from '@shared/utils/budget';
import { CURRENCY_META } from '@shared/utils/currency';
import { caretAfterFormat, formatAmountTyping, formatNumberTyping, numberSeparators } from '@shared/utils/money';

const BAR_TONE: Record<BudgetStatus | 'goal', string> = {
  none: 'bg-slate-300',
  ok: 'bg-teal-600',
  warning: 'bg-amber-500',
  over: 'bg-rose-600',
  goal: 'bg-emerald-600',
};

export function ProgressBar({ percent, tone, label }: { percent: number; tone: keyof typeof BAR_TONE; label: string }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div className={`h-full rounded-full transition-[width] duration-500 ${BAR_TONE[tone]}`} style={{ width: `${width}%` }} />
    </div>
  );
}

/**
 * Format ulang nilai input saat diketik (pemisah ribuan) lalu teruskan event ke `onChange` asli.
 * Nilai DOM diganti sebelum handler dipanggil, jadi state React maupun react-hook-form menerima
 * teks yang sudah berformat; posisi kursor dipertahankan setelah digit yang sama.
 */
function withLiveFormat(
  format: (raw: string) => string,
  decimal: string,
  onChange: InputHTMLAttributes<HTMLInputElement>['onChange']
) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    const el = event.target;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const formatted = format(raw);
    if (formatted !== raw) {
      el.value = formatted;
      const pos = caretAfterFormat(raw, caret, formatted, decimal);
      // Jalankan setelah React selesai render agar kursor tidak di-reset.
      requestAnimationFrame(() => {
        if (document.activeElement === el) el.setSelectionRange(pos, pos);
      });
    }
    onChange?.(event);
  };
}

interface AmountInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  currency: CurrencyCode;
  hasError?: boolean;
  large?: boolean;
  /** Izinkan nilai negatif (mis. saldo awal kartu kredit). */
  allowNegative?: boolean;
}

/**
 * Input nominal dengan simbol mata uang di kiri dan pemisah ribuan otomatis saat mengetik
 * ("1000000" → "1.000.000"). Nilainya teks berformat; urai dengan `parseAmountInput`.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { currency, hasError = false, large = false, allowNegative = false, className = '', onChange, ...props },
  ref
) {
  const { decimal } = numberSeparators(currency);
  const decimals = CURRENCY_META[currency].decimals;
  return (
    <div className="relative">
      <span
        className={`pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-semibold text-slate-400 ${
          large ? 'text-base' : 'text-sm'
        }`}
      >
        {CURRENCY_META[currency].symbol}
      </span>
      <input
        ref={ref}
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        placeholder={decimals > 0 ? `0${decimal}00` : '0'}
        {...props}
        onChange={withLiveFormat((raw) => formatAmountTyping(raw, currency, allowNegative), decimal, onChange)}
        className={getInputClassName(
          hasError,
          `${large ? 'py-3 pl-12 text-xl font-semibold tracking-tight' : 'pl-11'} tabular-nums ${className}`
        )}
      />
    </div>
  );
});

interface RateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Mata uang tujuan kurs (mata uang Workspace) — menentukan pemisah ribuan/desimal. */
  currency: CurrencyCode;
  hasError?: boolean;
}

/** Input kurs (maks. 6 desimal) dengan pemisah ribuan saat mengetik, mis. "16.250". Urai dengan `toPlainNumber`. */
export const RateInput = forwardRef<HTMLInputElement, RateInputProps>(function RateInput(
  { currency, hasError = false, className = '', onChange, ...props },
  ref
) {
  const separators = numberSeparators(currency);
  return (
    <input
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      {...props}
      onChange={withLiveFormat(
        (raw) => formatNumberTyping(raw, { ...separators, maxDecimals: 6 }),
        separators.decimal,
        onChange
      )}
      className={getInputClassName(hasError, `tabular-nums ${className}`)}
    />
  );
});

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-12 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

type ButtonProps = { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; form?: string };

export function PrimaryButton({ children, onClick, disabled, type = 'button', form }: ButtonProps) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, type = 'button' }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function PageToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">{children}</div>;
}
