import { describe, expect, it } from 'vitest';
import {
  caretAfterFormat,
  convertMinor,
  formatAmountTyping,
  fromPlainNumber,
  isValidRate,
  normalizeRate,
  parseAmountInput,
  toPlainNumber,
} from '@shared/utils/money';
import { transactionInputSchema } from '@shared/validation/finance';

describe('parseAmountInput', () => {
  it('treats separators in IDR as thousands', () => {
    expect(parseAmountInput('25.000', 'IDR')).toBe(25000);
    expect(parseAmountInput('Rp 1.250.000', 'IDR')).toBe(1250000);
    expect(parseAmountInput('25000', 'IDR')).toBe(25000);
  });

  it('reads the last separator as decimal for 2-decimal currencies', () => {
    expect(parseAmountInput('12.50', 'USD')).toBe(1250);
    expect(parseAmountInput('12,5', 'USD')).toBe(1250);
    expect(parseAmountInput('1,234.50', 'USD')).toBe(123450);
    expect(parseAmountInput('1.234,50', 'EUR')).toBe(123450);
    expect(parseAmountInput('1,234', 'USD')).toBe(123400);
  });

  it('rejects non-numbers', () => {
    expect(parseAmountInput('', 'IDR')).toBeNull();
    expect(parseAmountInput('abc', 'USD')).toBeNull();
    expect(parseAmountInput('1-2', 'IDR')).toBeNull();
  });
});

describe('formatAmountTyping (format saat mengetik)', () => {
  it('adds thousand separators for rupiah and ignores stray characters', () => {
    expect(formatAmountTyping('1000000', 'IDR')).toBe('1.000.000');
    expect(formatAmountTyping('Rp 25.0000', 'IDR')).toBe('250.000');
    expect(formatAmountTyping('0005000', 'IDR')).toBe('5.000');
    expect(formatAmountTyping('', 'IDR')).toBe('');
    // Rupiah tanpa desimal: bagian setelah koma dibuang (mis. hasil tempel "25.000,00").
    expect(formatAmountTyping('25.000,00', 'IDR')).toBe('25.000');
    expect(parseAmountInput(formatAmountTyping('25.000,00', 'IDR'), 'IDR')).toBe(25000);
  });

  it('keeps up to two decimals for USD/EUR using their locale separators', () => {
    expect(formatAmountTyping('1234.567', 'USD')).toBe('1,234.56');
    expect(formatAmountTyping('1234.', 'USD')).toBe('1,234.');
    expect(formatAmountTyping('.5', 'USD')).toBe('0.5');
    expect(formatAmountTyping('1234,5', 'EUR')).toBe('1.234,5');
    expect(parseAmountInput(formatAmountTyping('1234,5', 'EUR'), 'EUR')).toBe(123450);
  });

  it('allows a leading minus only when requested', () => {
    expect(formatAmountTyping('-250000', 'IDR', true)).toBe('-250.000');
    expect(formatAmountTyping('-250000', 'IDR')).toBe('250.000');
  });

  it('keeps the caret after the same digit when separators are inserted', () => {
    // Mengetik "4" di akhir "123" → "1.234", kursor di akhir.
    expect(caretAfterFormat('1234', 4, '1.234', ',')).toBe(5);
    // Mengetik di tengah: "1.2|34" setelah menyisipkan "5" → raw "1.2534" (kursor 4) → "12.534", kursor setelah "125".
    expect(caretAfterFormat('1.2534', 4, '12.534', ',')).toBe(4);
    expect(caretAfterFormat('1234.5', 6, '1,234.5', '.')).toBe(7);
  });

  it('converts between locale text and plain numbers for exchange rates', () => {
    expect(toPlainNumber('16.250,5', 'IDR')).toBe('16250.5');
    expect(toPlainNumber('1,234.5', 'USD')).toBe('1234.5');
    expect(fromPlainNumber('16250.5', 'IDR', 6)).toBe('16.250,5');
  });
});

describe('convertMinor & rates', () => {
  it('converts between currencies with different decimals using integer math', () => {
    // $12.50 × 16.250 = Rp203.125
    expect(convertMinor(1250, 'USD', 'IDR', '16250')).toBe(203125);
    // Rp100.000 × 0.000061 = $6.10
    expect(convertMinor(100000, 'IDR', 'USD', '0.000061')).toBe(610);
    // pembulatan half-up: $0.01 × 0.5 = 0.005 → 0.01
    expect(convertMinor(1, 'USD', 'EUR', '0.5')).toBe(1);
    expect(convertMinor(5000, 'IDR', 'IDR', '999')).toBe(5000);
  });

  it('validates and normalizes rates without float precision loss', () => {
    expect(isValidRate('16250')).toBe(true);
    expect(isValidRate('0.000061')).toBe(true);
    expect(isValidRate('0')).toBe(false);
    expect(isValidRate('1.1234567')).toBe(false);
    expect(isValidRate('-1')).toBe(false);
    expect(normalizeRate('123456789012.123456')).toBe('123456789012.123456');
    expect(normalizeRate('16250')).toBe('16250.000000');
  });
});

describe('transactionInputSchema', () => {
  const base = { walletId: 1, amountMinor: 1000, title: 'Uji' };

  it('requires a distinct target wallet for transfers and forbids it otherwise', () => {
    expect(transactionInputSchema.safeParse({ ...base, type: 'transfer' }).success).toBe(false);
    expect(
      transactionInputSchema.safeParse({ ...base, type: 'transfer', transferTargetWalletId: 1 }).success
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({ ...base, type: 'transfer', transferTargetWalletId: 2 }).success
    ).toBe(true);
    expect(
      transactionInputSchema.safeParse({ ...base, type: 'expense', transferTargetWalletId: 2 }).success
    ).toBe(false);
  });

  it('rejects zero/negative amounts and blank titles', () => {
    expect(transactionInputSchema.safeParse({ ...base, type: 'expense', amountMinor: 0 }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...base, type: 'expense', title: '   ' }).success).toBe(false);
  });
});
