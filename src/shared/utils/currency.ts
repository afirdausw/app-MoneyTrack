import type { CurrencyCode } from '@shared/types/domain';

interface CurrencyMeta {
  symbol: string;
  decimals: number;
  locale: string;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  IDR: { symbol: 'Rp', decimals: 0, locale: 'id-ID' },
  USD: { symbol: '$', decimals: 2, locale: 'en-US' },
  SGD: { symbol: 'S$', decimals: 2, locale: 'en-SG' },
  MYR: { symbol: 'RM', decimals: 2, locale: 'ms-MY' },
  EUR: { symbol: '€', decimals: 2, locale: 'de-DE' },
};

/** Mengonversi nominal utama (misal 12.50 USD atau 25000 IDR) menjadi integer minor unit agar bebas error floating point. */
export function toMinorUnits(amount: number, currency: CurrencyCode): number {
  const factor = 10 ** CURRENCY_META[currency].decimals;
  return Math.round(amount * factor);
}

/** Mengonversi integer minor unit kembali ke nominal utama. */
export function fromMinorUnits(amountMinor: number, currency: CurrencyCode): number {
  const factor = 10 ** CURRENCY_META[currency].decimals;
  return amountMinor / factor;
}

/** Memformat minor unit menjadi teks mata uang yang rapi untuk UI. */
export function formatMoney(amountMinor: number, currency: CurrencyCode): string {
  const meta = CURRENCY_META[currency];
  const major = fromMinorUnits(amountMinor, currency);

  return new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  }).format(major);
}
