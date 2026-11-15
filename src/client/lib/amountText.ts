import type { CurrencyCode } from '@shared/types/domain';
import { fromMinorUnits, toMinorUnits } from '@shared/utils/currency';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';

/**
 * Ubah teks nominal ke format mata uang lain dengan nilai angka yang sama
 * ("25.000" IDR → "25,000.00" USD). Dipanggil dari handler saat user MENGGANTI dompet/mata uang —
 * tanpa ini "25.000" (IDR) terbaca "25.00" (USD) karena titik adalah pemisah desimal di USD.
 * Sengaja bukan efek React, agar pengisian ulang form saat edit tidak ikut dikonversi.
 */
export function convertAmountText(text: string, from: CurrencyCode, to: CurrencyCode): string {
  if (from === to || !text.trim()) return text;
  const minor = parseAmountInput(text, from);
  if (minor === null) return text;
  return formatAmountInput(toMinorUnits(fromMinorUnits(minor, from), to), to);
}
