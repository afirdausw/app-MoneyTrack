import { describe, expect, it } from 'vitest';
import { convertAmountText } from '@client/lib/amountText';

describe('convertAmountText', () => {
  it('keeps the same numeric value when switching currency', () => {
    expect(convertAmountText('25.000', 'IDR', 'USD')).toBe('25,000.00');
    expect(convertAmountText('12.50', 'USD', 'IDR')).toBe('13');
    expect(convertAmountText('1.234,50', 'EUR', 'USD')).toBe('1,234.50');
  });

  it('leaves empty, unparsable or same-currency text untouched', () => {
    expect(convertAmountText('', 'IDR', 'USD')).toBe('');
    expect(convertAmountText('abc', 'IDR', 'USD')).toBe('abc');
    expect(convertAmountText('25.000', 'IDR', 'IDR')).toBe('25.000');
  });
});
