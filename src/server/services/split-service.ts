import { and, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { splitExpenses, splitParticipants, transactions, users, workspaceMembers } from '@server/db/schema';
import { monthRange } from '@server/lib/dates';
import type { DbClient } from '@server/lib/http';
import { recordAudit } from '@server/services/audit-service';
import { listWorkspaceMembers } from '@server/services/invite-service';
import type { Actor } from '@server/services/transaction-service';
import type {
  CurrencyCode,
  MemberContribution,
  SettlementSuggestion,
  SharedCashSummary,
  SplitItem,
} from '@shared/types/domain';
import { canManageWorkspace } from '@shared/utils/permissions';
import { type OpenShare, netBalances, pairwiseSettlements, splitEqually } from '@shared/utils/split';
import type { CreateSplitInput } from '@shared/validation/collab';

export type SplitErrorCode = 'SPLIT_NOT_FOUND' | 'NOT_A_MEMBER' | 'FORBIDDEN' | 'NOTHING_TO_SETTLE';
export type SplitResult<T> = { ok: true; value: T } | { ok: false; code: SplitErrorCode };

const payer = alias(users, 'payer');

async function memberIds(db: DbClient, workspaceId: number): Promise<Set<number>> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return new Set(rows.map((r) => r.userId));
}

export async function listSplits(db: DbClient, actor: Actor, limit = 50): Promise<SplitItem[]> {
  const splits = await db
    .select({
      id: splitExpenses.id,
      title: splitExpenses.title,
      totalMinor: splitExpenses.totalMinor,
      currency: splitExpenses.currencyCode,
      occurredAt: splitExpenses.occurredAt,
      paidById: payer.id,
      paidByName: payer.name,
    })
    .from(splitExpenses)
    .innerJoin(payer, eq(splitExpenses.paidByUserId, payer.id))
    .where(eq(splitExpenses.workspaceId, actor.workspace.id))
    .orderBy(desc(splitExpenses.occurredAt), desc(splitExpenses.id))
    .limit(limit);
  if (splits.length === 0) return [];

  const parts = await db
    .select({
      splitId: splitParticipants.splitExpenseId,
      userId: splitParticipants.userId,
      name: users.name,
      owedMinor: splitParticipants.owedMinor,
      isSettled: splitParticipants.isSettled,
      settledAt: splitParticipants.settledAt,
    })
    .from(splitParticipants)
    .innerJoin(users, eq(splitParticipants.userId, users.id))
    .where(inArray(splitParticipants.splitExpenseId, splits.map((s) => s.id)))
    .orderBy(splitParticipants.id);

  const isAdmin = canManageWorkspace(actor.workspace.role);
  return splits.map((s) => {
    const participants = parts
      .filter((p) => p.splitId === s.id)
      .map(({ splitId: _splitId, settledAt, ...p }) => ({ ...p, settledAt: settledAt?.toISOString() ?? null }));
    return {
      id: s.id,
      title: s.title,
      totalMinor: s.totalMinor,
      currency: s.currency as CurrencyCode,
      occurredAt: s.occurredAt.toISOString(),
      paidBy: { id: s.paidById, name: s.paidByName },
      participants,
      outstandingMinor: participants
        .filter((p) => !p.isSettled && p.userId !== s.paidById)
        .reduce((acc, p) => acc + p.owedMinor, 0),
      canDelete: isAdmin || s.paidById === actor.userId,
    };
  });
}

export async function createSplit(db: DbClient, actor: Actor, input: CreateSplitInput): Promise<SplitResult<number>> {
  const members = await memberIds(db, actor.workspace.id);
  if (!members.has(input.paidByUserId) || input.participants.some((p) => !members.has(p.userId))) {
    return { ok: false, code: 'NOT_A_MEMBER' };
  }

  const shares =
    input.mode === 'equal'
      ? splitEqually(
          input.totalMinor,
          input.participants.map((p) => p.userId)
        )
      : input.participants.map((p) => ({ userId: p.userId, owedMinor: p.owedMinor ?? 0 }));

  const names = new Map(
    (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, input.paidByUserId))).map((u) => [
      u.id,
      u.name,
    ])
  );

  const id = await db.transaction(async (tx) => {
    const [result] = await tx.insert(splitExpenses).values({
      workspaceId: actor.workspace.id,
      paidByUserId: input.paidByUserId,
      title: input.title,
      totalMinor: input.totalMinor,
      currencyCode: actor.workspace.primaryCurrency,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    });
    const splitId = Number(result.insertId);
    const now = new Date();
    await tx.insert(splitParticipants).values(
      shares
        .filter((share) => share.owedMinor > 0)
        .map((share) => {
          // Porsi pembayar sendiri otomatis lunas (tidak berutang ke diri sendiri).
          const own = share.userId === input.paidByUserId;
          return {
            splitExpenseId: splitId,
            userId: share.userId,
            owedMinor: share.owedMinor,
            settledMinor: own ? share.owedMinor : 0,
            isSettled: own,
            settledAt: own ? now : null,
          };
        })
    );
    await recordAudit(tx, {
      workspaceId: actor.workspace.id,
      actorUserId: actor.userId,
      entityType: 'split',
      entityId: splitId,
      action: 'create',
      metadata: {
        title: input.title,
        totalMinor: input.totalMinor,
        currency: actor.workspace.primaryCurrency,
        paidByName: names.get(input.paidByUserId) ?? '',
      },
    });
    return splitId;
  });
  return { ok: true, value: id };
}

export async function deleteSplit(db: DbClient, actor: Actor, splitId: number): Promise<SplitResult<true>> {
  const rows = await db
    .select({ paidByUserId: splitExpenses.paidByUserId, title: splitExpenses.title })
    .from(splitExpenses)
    .where(and(eq(splitExpenses.id, splitId), eq(splitExpenses.workspaceId, actor.workspace.id)))
    .limit(1);
  const split = rows[0];
  if (!split) return { ok: false, code: 'SPLIT_NOT_FOUND' };
  if (split.paidByUserId !== actor.userId && !canManageWorkspace(actor.workspace.role)) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  await db.transaction(async (tx) => {
    await tx.delete(splitExpenses).where(eq(splitExpenses.id, splitId));
    await recordAudit(tx, {
      workspaceId: actor.workspace.id,
      actorUserId: actor.userId,
      entityType: 'split',
      entityId: splitId,
      action: 'delete',
      metadata: { title: split.title },
    });
  });
  return { ok: true, value: true };
}

/** Semua porsi yang belum lunas (peserta ≠ pembayar) di Workspace. */
async function openShares(db: DbClient, workspaceId: number): Promise<OpenShare[]> {
  const rows = await db
    .select({
      debtorId: splitParticipants.userId,
      creditorId: splitExpenses.paidByUserId,
      owed: splitParticipants.owedMinor,
      settled: splitParticipants.settledMinor,
    })
    .from(splitParticipants)
    .innerJoin(splitExpenses, eq(splitParticipants.splitExpenseId, splitExpenses.id))
    .where(
      and(
        eq(splitExpenses.workspaceId, workspaceId),
        eq(splitParticipants.isSettled, false),
        ne(splitParticipants.userId, splitExpenses.paidByUserId)
      )
    );
  return rows.map((r) => ({ debtorId: r.debtorId, creditorId: r.creditorId, amountMinor: r.owed - r.settled }));
}

/**
 * Tandai lunas semua porsi terbuka antara dua anggota (dua arah), setelah `from` mentransfer
 * nominal netto ke `to`. Hanya penerima uang (`to`) atau admin yang boleh mengonfirmasi.
 */
export async function settlePair(
  db: DbClient,
  actor: Actor,
  fromUserId: number,
  toUserId: number
): Promise<SplitResult<{ amountMinor: number }>> {
  if (actor.userId !== toUserId && !canManageWorkspace(actor.workspace.role)) return { ok: false, code: 'FORBIDDEN' };

  const workspaceId = actor.workspace.id;
  const result = await db.transaction(async (tx): Promise<SplitResult<{ amountMinor: number }>> => {
    const shares = await tx
      .select({
        id: splitParticipants.id,
        debtorId: splitParticipants.userId,
        creditorId: splitExpenses.paidByUserId,
        owed: splitParticipants.owedMinor,
        settled: splitParticipants.settledMinor,
      })
      .from(splitParticipants)
      .innerJoin(splitExpenses, eq(splitParticipants.splitExpenseId, splitExpenses.id))
      .where(
        and(
          eq(splitExpenses.workspaceId, workspaceId),
          eq(splitParticipants.isSettled, false),
          or(
            and(eq(splitParticipants.userId, fromUserId), eq(splitExpenses.paidByUserId, toUserId)),
            and(eq(splitParticipants.userId, toUserId), eq(splitExpenses.paidByUserId, fromUserId))
          )
        )
      )
      .for('update');

    const net = pairwiseSettlements(
      shares.map((s) => ({ debtorId: s.debtorId, creditorId: s.creditorId, amountMinor: s.owed - s.settled }))
    )[0];
    // Harus ada utang bersih dengan arah from → to.
    if (!net || net.fromUserId !== fromUserId) return { ok: false, code: 'NOTHING_TO_SETTLE' };

    await tx
      .update(splitParticipants)
      .set({ isSettled: true, settledMinor: sql`${splitParticipants.owedMinor}`, settledAt: new Date() })
      .where(inArray(splitParticipants.id, shares.map((s) => s.id)));

    const names = new Map(
      (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [fromUserId, toUserId]))).map(
        (u) => [u.id, u.name]
      )
    );
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      entityType: 'split',
      entityId: 0,
      action: 'settle',
      metadata: {
        fromName: names.get(fromUserId) ?? '',
        toName: names.get(toUserId) ?? '',
        amountMinor: net.amountMinor,
        currency: actor.workspace.primaryCurrency,
      },
    });
    return { ok: true, value: { amountMinor: net.amountMinor } };
  });
  return result;
}

export async function sharedCashSummary(db: DbClient, actor: Actor, monthKey: string): Promise<SharedCashSummary> {
  const workspaceId = actor.workspace.id;
  const { from, to } = monthRange(monthKey);
  const [members, txTotals, splitTotals, shares] = await Promise.all([
    listWorkspaceMembers(db, workspaceId),
    db
      .select({
        userId: transactions.createdByUserId,
        type: transactions.type,
        total: sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          gte(transactions.occurredAt, from),
          lt(transactions.occurredAt, to),
          ne(transactions.type, 'transfer')
        )
      )
      .groupBy(transactions.createdByUserId, transactions.type),
    db
      .select({
        userId: splitExpenses.paidByUserId,
        total: sql<string>`coalesce(sum(${splitExpenses.totalMinor}), 0)`,
      })
      .from(splitExpenses)
      .where(
        and(eq(splitExpenses.workspaceId, workspaceId), gte(splitExpenses.occurredAt, from), lt(splitExpenses.occurredAt, to))
      )
      .groupBy(splitExpenses.paidByUserId),
    openShares(db, workspaceId),
  ]);

  const balances = netBalances(shares);
  const sumTx = (userId: number, type: 'income' | 'expense') =>
    Number(txTotals.find((t) => t.userId === userId && t.type === type)?.total ?? 0);

  const memberRows: MemberContribution[] = members.map((m) => ({
    userId: m.userId,
    name: m.name,
    role: m.role,
    incomeMinor: sumTx(m.userId, 'income'),
    expenseMinor: sumTx(m.userId, 'expense'),
    splitPaidMinor: Number(splitTotals.find((s) => s.userId === m.userId)?.total ?? 0),
    splitNetMinor: balances.get(m.userId) ?? 0,
  }));

  // Nama juga untuk mantan anggota yang masih punya utang-piutang terbuka.
  const nameIds = new Set(shares.flatMap((s) => [s.debtorId, s.creditorId]));
  const nameRows = nameIds.size
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...nameIds]))
    : [];
  const nameOf = new Map(nameRows.map((u) => [u.id, u.name]));
  const isAdmin = canManageWorkspace(actor.workspace.role);

  const settlements: SettlementSuggestion[] = pairwiseSettlements(shares).map((s) => ({
    from: { id: s.fromUserId, name: nameOf.get(s.fromUserId) ?? 'Mantan anggota' },
    to: { id: s.toUserId, name: nameOf.get(s.toUserId) ?? 'Mantan anggota' },
    amountMinor: s.amountMinor,
    canSettle: isAdmin || actor.userId === s.toUserId,
  }));

  return { month: monthKey, currency: actor.workspace.primaryCurrency, members: memberRows, settlements };
}
