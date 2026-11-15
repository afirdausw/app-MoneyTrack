/**
 * Perhitungan split bill murni (tanpa I/O) — dipakai server untuk menyimpan porsi dan
 * menghitung saran settlement, serta client untuk pratinjau.
 */

/**
 * Bagi rata `totalMinor` ke `userIds`. Sisa pembulatan dibagikan 1 minor unit per orang
 * mulai dari urutan pertama, sehingga jumlah porsi selalu tepat sama dengan total.
 */
export function splitEqually(totalMinor: number, userIds: number[]): Array<{ userId: number; owedMinor: number }> {
  if (userIds.length === 0) return [];
  const base = Math.floor(totalMinor / userIds.length);
  const remainder = totalMinor - base * userIds.length;
  return userIds.map((userId, index) => ({ userId, owedMinor: base + (index < remainder ? 1 : 0) }));
}

export interface OpenShare {
  /** Yang berutang (peserta). */
  debtorId: number;
  /** Yang menalangi (pembayar split). */
  creditorId: number;
  /** Sisa utang yang belum dilunasi. */
  amountMinor: number;
}

export interface PairSettlement {
  fromUserId: number;
  toUserId: number;
  amountMinor: number;
}

/**
 * Saran settlement netto per pasangan anggota: utang A→B dan B→A saling mengurangi,
 * lalu hanya arah dengan sisa positif yang ditampilkan ("A transfer X ke B").
 * Diurutkan dari nominal terbesar.
 */
export function pairwiseSettlements(shares: OpenShare[]): PairSettlement[] {
  const net = new Map<string, number>();
  for (const share of shares) {
    if (share.amountMinor <= 0 || share.debtorId === share.creditorId) continue;
    const low = Math.min(share.debtorId, share.creditorId);
    const high = Math.max(share.debtorId, share.creditorId);
    const key = `${low}:${high}`;
    // Positif = `low` berutang ke `high`.
    const signed = share.debtorId === low ? share.amountMinor : -share.amountMinor;
    net.set(key, (net.get(key) ?? 0) + signed);
  }

  const result: PairSettlement[] = [];
  for (const [key, amount] of net) {
    if (amount === 0) continue;
    const [low, high] = key.split(':').map(Number) as [number, number];
    result.push(
      amount > 0
        ? { fromUserId: low, toUserId: high, amountMinor: amount }
        : { fromUserId: high, toUserId: low, amountMinor: -amount }
    );
  }
  return result.sort((a, b) => b.amountMinor - a.amountMinor);
}

/** Posisi bersih tiap anggota: positif = akan menerima, negatif = harus membayar. */
export function netBalances(shares: OpenShare[]): Map<number, number> {
  const balances = new Map<number, number>();
  for (const share of shares) {
    if (share.amountMinor <= 0 || share.debtorId === share.creditorId) continue;
    balances.set(share.creditorId, (balances.get(share.creditorId) ?? 0) + share.amountMinor);
    balances.set(share.debtorId, (balances.get(share.debtorId) ?? 0) - share.amountMinor);
  }
  return balances;
}
