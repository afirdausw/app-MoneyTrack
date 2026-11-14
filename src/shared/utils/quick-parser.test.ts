import { describe, expect, it } from 'vitest';
import { formatMoney, fromMinorUnits, toMinorUnits } from '@shared/utils/currency';
import { parseQuickInput } from '@shared/utils/quick-parser';

describe('parseQuickInput', () => {
  it('parses Indonesian shorthand expense with wallet hint', () => {
    expect(parseQuickInput('makan siang 25rb gopay')).toEqual({
      raw: 'makan siang 25rb gopay',
      type: 'expense',
      amount: 25000,
      currency: 'IDR',
      description: 'makan siang',
      walletHint: 'gopay',
    });
  });

  it('parses income prefixed with + and jt multiplier', () => {
    expect(parseQuickInput('+gaji freelance 5.5jt bca')).toEqual({
      raw: '+gaji freelance 5.5jt bca',
      type: 'income',
      amount: 5500000,
      currency: 'IDR',
      description: 'gaji freelance',
      walletHint: 'bca',
    });
  });

  it('parses formatted thousand separator and explicit @wallet', () => {
    expect(parseQuickInput('bayar listrik 350.000 @toko_kas')).toEqual({
      raw: 'bayar listrik 350.000 @toko_kas',
      type: 'expense',
      amount: 350000,
      currency: 'IDR',
      description: 'bayar listrik',
      walletHint: 'toko_kas',
    });
  });

  it('parses USD amount with decimal', () => {
    expect(parseQuickInput('hosting server $12.50 wise')).toEqual({
      raw: 'hosting server $12.50 wise',
      type: 'expense',
      amount: 12.5,
      currency: 'USD',
      description: 'hosting server',
      walletHint: 'wise',
    });
  });
});

describe('currency helpers', () => {
  it('converts IDR and USD minor units accurately', () => {
    expect(toMinorUnits(25000, 'IDR')).toBe(25000);
    expect(toMinorUnits(12.5, 'USD')).toBe(1250);
    expect(fromMinorUnits(1250, 'USD')).toBe(12.5);
    expect(formatMoney(1250, 'USD')).toBe('$12.50');
  });
});
