import type { CurrencyCode } from '@shared/types/domain';
import { CURRENCY_META } from '@shared/utils/currency';

/** Batas nominal agar tetap aman di `Number` JS dan BIGINT MySQL (±9 kuadriliun minor unit). */
export const MAX_AMOUNT_MINOR = 9_000_000_000_000_000;

/**
 * Mengurai teks nominal ketikan user menjadi minor unit.
 * - IDR (0 desimal): "25.000", "25000", "Rp 25.000" → 25000
 * - USD dkk (2 desimal): "12.50", "12,50", "1,234.50", "1.234,50" → 1250 / 123450
 * Mengembalikan null bila bukan angka valid.
 */
export function parseAmountInput(text: string, currency: CurrencyCode): number | null {
  const decimals = CURRENCY_META[currency].decimals;
  const cleaned = text.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned) || cleaned.lastIndexOf('-') > 0) return null;

  let normalized: string;
  if (decimals === 0) {
    // Rupiah tidak punya desimal: titik/koma dianggap pemisah ribuan.
    normalized = cleaned.replace(/[.,]/g, '');
  } else {
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    const decimalIndex = Math.max(lastDot, lastComma);
    const fractionLength = decimalIndex >= 0 ? cleaned.length - decimalIndex - 1 : 0;
    // Pemisah terakhir dianggap desimal hanya bila diikuti 1–2 digit ("12.5", "12,50").
    if (decimalIndex >= 0 && fractionLength > 0 && fractionLength <= decimals) {
      const whole = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
      normalized = `${whole}.${cleaned.slice(decimalIndex + 1)}`;
    } else {
      normalized = cleaned.replace(/[.,]/g, '');
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const minor = Math.round(value * 10 ** decimals);
  return Math.abs(minor) <= MAX_AMOUNT_MINOR ? minor : null;
}

/** Format minor unit menjadi angka tanpa simbol untuk diisikan kembali ke input ("25.000" / "12.50"). */
export function formatAmountInput(amountMinor: number, currency: CurrencyCode): string {
  const { decimals, locale } = CURRENCY_META[currency];
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(amountMinor / 10 ** decimals);
}

export interface NumberSeparators {
  group: string;
  decimal: string;
}

const separatorCache = new Map<CurrencyCode, NumberSeparators>();

/** Pemisah ribuan & desimal sesuai locale mata uang (IDR: "." dan ","; USD: "," dan "."). */
export function numberSeparators(currency: CurrencyCode): NumberSeparators {
  const cached = separatorCache.get(currency);
  if (cached) return cached;
  const parts = new Intl.NumberFormat(CURRENCY_META[currency].locale).formatToParts(1234567.5);
  const result = {
    group: parts.find((p) => p.type === 'group')?.value ?? '.',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? ',',
  };
  separatorCache.set(currency, result);
  return result;
}

export interface TypingOptions extends NumberSeparators {
  maxDecimals: number;
  allowNegative?: boolean;
}

/**
 * Format angka SAAT diketik: buang karakter selain angka, sisipkan pemisah ribuan, dan batasi
 * jumlah desimal. Contoh IDR: "1000000" → "1.000.000"; USD: "1234.5" → "1,234.5".
 * Untuk mata uang tanpa desimal, bagian setelah tanda desimal diabaikan ("25.000,00" → "25.000").
 */
export function formatNumberTyping(raw: string, options: TypingOptions): string {
  const { group, decimal, maxDecimals, allowNegative = false } = options;
  const negative = allowNegative && raw.trimStart().startsWith('-');
  let whole = '';
  let fraction = '';
  let seenDecimal = false;

  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (!seenDecimal) whole += ch;
      else if (fraction.length < maxDecimals) fraction += ch;
    } else if (ch === decimal && !seenDecimal) {
      seenDecimal = true;
    }
  }

  whole = whole.replace(/^0+(?=\d)/, '');
  const showDecimal = seenDecimal && maxDecimals > 0;
  if (showDecimal && whole === '') whole = '0';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? '-' : ''}${grouped}${showDecimal ? `${decimal}${fraction}` : ''}`;
}

export function formatAmountTyping(raw: string, currency: CurrencyCode, allowNegative = false): string {
  return formatNumberTyping(raw, {
    ...numberSeparators(currency),
    maxDecimals: CURRENCY_META[currency].decimals,
    allowNegative,
  });
}

/**
 * Posisi kursor setelah teks diformat ulang: kursor tetap berada setelah jumlah digit yang sama
 * (dan setelah tanda desimal bila sebelumnya juga di belakangnya), jadi tidak meloncat ke akhir.
 */
export function caretAfterFormat(raw: string, caret: number, formatted: string, decimal: string): number {
  const before = raw.slice(0, caret);
  const digits = (before.match(/\d/g) ?? []).length;
  const decimalBefore = before.includes(decimal);
  let count = 0;
  for (let i = 0; i <= formatted.length; i++) {
    const passedDecimal = !decimalBefore || formatted.slice(0, i).includes(decimal);
    if (count >= digits && passedDecimal) return i;
    const ch = formatted[i];
    if (ch !== undefined && ch >= '0' && ch <= '9') count++;
  }
  return formatted.length;
}

/** Teks angka berformat locale → angka polos bertitik desimal ("16.250,5" IDR → "16250.5"). */
export function toPlainNumber(text: string, currency: CurrencyCode): string {
  const { group, decimal } = numberSeparators(currency);
  return text.split(group).join('').replace(decimal, '.').trim();
}

/** Angka polos ("16250.5") → teks berformat locale ("16.250,5") untuk mengisi ulang input. */
export function fromPlainNumber(plain: string, currency: CurrencyCode, maxDecimals: number): string {
  const { decimal } = numberSeparators(currency);
  return formatNumberTyping(plain.replace('.', decimal), { ...numberSeparators(currency), maxDecimals });
}

const RATE_SCALE = 1_000_000n;

/** Kurs desimal (maks. 6 angka di belakang koma) → integer berskala 1e6. */
function rateToMicro(rate: string): bigint {
  const [whole = '0', fraction = ''] = rate.trim().split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

/** Kurs dalam format kolom DECIMAL(18,6), tanpa melewati `Number` agar presisi tidak hilang ("16250" → "16250.000000"). */
export function normalizeRate(rate: string): string {
  const [whole = '0', fraction = ''] = rate.trim().split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(6, '0').slice(0, 6)}`;
}

/** Validasi kurs: angka positif, maks. 6 desimal. */
export function isValidRate(rate: string): boolean {
  return /^\d{1,12}(\.\d{1,6})?$/.test(rate.trim()) && rateToMicro(rate) > 0n;
}

/**
 * Konversi minor unit antar mata uang memakai integer (BigInt) agar bebas error floating point.
 * `rate` = berapa 1 unit `from` dalam `to` (contoh USD→IDR "16250").
 * Pembulatan half-up ke minor unit mata uang tujuan.
 */
export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: string
): number {
  if (from === to) return amountMinor;
  const fromScale = 10n ** BigInt(CURRENCY_META[from].decimals);
  const toScale = 10n ** BigInt(CURRENCY_META[to].decimals);
  const numerator = BigInt(amountMinor) * rateToMicro(rate) * toScale;
  const denominator = fromScale * RATE_SCALE;
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return Number(negative ? -rounded : rounded);
}
