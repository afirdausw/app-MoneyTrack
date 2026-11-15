import { describe, expect, it } from 'vitest';
import { canManageMember } from '@shared/utils/permissions';
import { netBalances, pairwiseSettlements, splitEqually } from '@shared/utils/split';
import { createSplitSchema } from '@shared/validation/collab';

describe('splitEqually', () => {
  it('distributes the rounding remainder so shares always add up to the total', () => {
    const shares = splitEqually(100_000, [1, 2, 3]);
    expect(shares.map((s) => s.owedMinor)).toEqual([33_334, 33_333, 33_333]);
    expect(shares.reduce((a, s) => a + s.owedMinor, 0)).toBe(100_000);
    expect(splitEqually(10, [])).toEqual([]);
  });
});

describe('pairwiseSettlements', () => {
  it('nets debts in both directions per pair', () => {
    const result = pairwiseSettlements([
      { debtorId: 2, creditorId: 1, amountMinor: 100_000 }, // Budi berutang ke Andi
      { debtorId: 1, creditorId: 2, amountMinor: 25_000 }, // Andi berutang ke Budi
      { debtorId: 3, creditorId: 1, amountMinor: 40_000 },
      { debtorId: 3, creditorId: 3, amountMinor: 999 }, // porsi sendiri diabaikan
    ]);
    expect(result).toEqual([
      { fromUserId: 2, toUserId: 1, amountMinor: 75_000 },
      { fromUserId: 3, toUserId: 1, amountMinor: 40_000 },
    ]);
  });

  it('drops pairs that cancel out exactly', () => {
    expect(
      pairwiseSettlements([
        { debtorId: 1, creditorId: 2, amountMinor: 5_000 },
        { debtorId: 2, creditorId: 1, amountMinor: 5_000 },
      ])
    ).toEqual([]);
  });

  it('computes net position per member', () => {
    const balances = netBalances([
      { debtorId: 2, creditorId: 1, amountMinor: 100 },
      { debtorId: 3, creditorId: 1, amountMinor: 50 },
    ]);
    expect(Object.fromEntries(balances)).toEqual({ 1: 150, 2: -100, 3: -50 });
  });
});

describe('createSplitSchema', () => {
  const base = { title: 'Makan bareng', totalMinor: 90_000, paidByUserId: 1 };

  it('requires custom shares to sum to the total', () => {
    expect(
      createSplitSchema.safeParse({
        ...base,
        mode: 'custom',
        participants: [
          { userId: 1, owedMinor: 30_000 },
          { userId: 2, owedMinor: 50_000 },
        ],
      }).success
    ).toBe(false);
    expect(
      createSplitSchema.safeParse({
        ...base,
        mode: 'custom',
        participants: [
          { userId: 1, owedMinor: 40_000 },
          { userId: 2, owedMinor: 50_000 },
        ],
      }).success
    ).toBe(true);
  });

  it('rejects duplicate participants and payer-only splits', () => {
    expect(
      createSplitSchema.safeParse({ ...base, mode: 'equal', participants: [{ userId: 2 }, { userId: 2 }] }).success
    ).toBe(false);
    expect(createSplitSchema.safeParse({ ...base, mode: 'equal', participants: [{ userId: 1 }] }).success).toBe(false);
  });
});

describe('canManageMember', () => {
  it('lets owners manage everyone but owners, admins only members/viewers', () => {
    expect(canManageMember('owner', 'admin', 'member')).toBe(true);
    expect(canManageMember('owner', 'member', 'admin')).toBe(true);
    expect(canManageMember('owner', 'owner')).toBe(false);
    expect(canManageMember('admin', 'member', 'viewer')).toBe(true);
    expect(canManageMember('admin', 'member', 'admin')).toBe(false);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('member', 'viewer')).toBe(false);
  });
});
