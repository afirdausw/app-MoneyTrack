import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney as formatMoneyRaw } from '@shared/utils/currency';
import { areAmountsHidden, formatMoney, setAmountsHidden } from '@client/lib/privacy';

describe('mode privasi nominal', () => {
  afterEach(() => setAmountsHidden(false));

  it('menampilkan nominal apa adanya saat mode privasi mati', () => {
    expect(areAmountsHidden()).toBe(false);
    expect(formatMoney(1_250_000_00, 'IDR')).toBe(formatMoneyRaw(1_250_000_00, 'IDR'));
  });

  it('mengganti angka dengan titik tapi mempertahankan simbol mata uang', () => {
    setAmountsHidden(true);
    for (const [minor, currency] of [
      [1_250_000_00, 'IDR'],
      [-4_999, 'USD'],
      [0, 'EUR'],
    ] as const) {
      const masked = formatMoney(minor, currency);
      expect(masked).toContain('•••••');
      expect(masked).not.toMatch(/\d/);
    }
    expect(formatMoney(1_250_000_00, 'IDR')).toMatch(/^Rp/);
  });
});
