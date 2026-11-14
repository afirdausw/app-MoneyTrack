import { describe, expect, it } from 'vitest';
import { generateRandomToken, hashSessionToken } from '@server/lib/security';

describe('security helpers', () => {
  it('produces deterministic SHA-256 session hashes and unique random tokens', () => {
    const tokenA = generateRandomToken();
    const tokenB = generateRandomToken();
    expect(tokenA).not.toBe(tokenB);
    expect(hashSessionToken(tokenA)).toHaveLength(64);
    expect(hashSessionToken(tokenA)).toBe(hashSessionToken(tokenA));
  });
});
