import { describe, expect, it } from 'vitest';
import { niceScale } from '@client/components/TrendChart';

describe('niceScale', () => {
  it('uses round steps so every tick label is a clean number', () => {
    expect(niceScale(20_270_400)).toEqual({ top: 25_000_000, ticks: [0, 5e6, 10e6, 15e6, 20e6, 25e6] });
    expect(niceScale(8_750_000)).toEqual({ top: 10_000_000, ticks: [0, 2e6, 4e6, 6e6, 8e6, 10e6] });
    expect(niceScale(350)).toEqual({ top: 400, ticks: [0, 100, 200, 300, 400] });
  });

  it('handles empty data', () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] });
  });
});
