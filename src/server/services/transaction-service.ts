import { type SQL, and, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import {
  auditLogs,
  categories,
  invoices,
  projects,
  receipts,
  transactions,
  users,
  wallets,
  workspaceWallets,
  workspaces,
} from '@server/db/schema';
import { monthRange } from '@server/lib/dates';
import type { DbClient } from '@server/lib/http';
import { recomputeInvoices, resolveBusinessLinks } from '@server/services/business-service';
import { advanceBillInTx } from '@server/services/planning-service';
import type { DbTransaction } from '@server/services/workspace-service';
import { findLinkedWallet } from '@server/services/wallet-service';
import type {
  CurrencyCode,
  ReceiptItem,
  TransactionDetail,
  TransactionItem,
  TransactionPage,
  WorkspaceOverview,
  WorkspaceSummary,
} from '@shared/types/domain';
import { convertMinor, normalizeRate } from '@shared/utils/money';
import { canEditTransaction } from '@shared/utils/permissions';
import type { TransactionInput, TransactionQuery } from '@shared/validation/finance';

export type TransactionErrorCode =
  | 'WALLET_NOT_LINKED'
  | 'TARGET_WALLET_NOT_LINKED'
  | 'TRANSFER_CURRENCY_MISMATCH'
  | 'CATEGORY_INVALID'
  | 'EXCHANGE_RATE_REQUIRED'
  | 'TRANSACTION_NOT_FOUND'
  | 'RECURRING_NOT_FOUND'
  | 'RECURRING_INACTIVE'
  | 'RECURRING_TYPE_MISMATCH'
  | 'PROJECT_NOT_FOUND'
  | 'INVOICE_NOT_FOUND'
  | 'FORBIDDEN';

export type Result<T> = { ok: true; value: T } | { ok: false; code: TransactionErrorCode };

export interface Actor {
  userId: number;
  workspace: WorkspaceSummary;
}

interface PreparedTransaction {
  values: {
    type: TransactionInput['type'];
    walletId: number;
    transferTargetWalletId: number | null;
    categoryId: number | null;
    amountMinor: number;
    currencyCode: CurrencyCode;
    exchangeRateToWorkspace: string;
    convertedAmountMinor: number;
    title: string;
    notes: string | null;
    occurredAt: Date;
    projectId: number | null;
    invoiceId: number | null;
  };
}

/** Validasi relasi (dompet tertaut, kategori milik Workspace, kurs) lalu hitung nilai konversi. */
async function prepare(
  db: DbClient,
  workspace: WorkspaceSummary,
  input: TransactionInput
): Promise<Result<PreparedTransaction>> {
  const wallet = await findLinkedWallet(db, workspace.id, input.walletId);
  if (!wallet) return { ok: false, code: 'WALLET_NOT_LINKED' };

  if (input.type === 'transfer' && input.transferTargetWalletId) {
    const target = await findLinkedWallet(db, workspace.id, input.transferTargetWalletId);
    if (!target) return { ok: false, code: 'TARGET_WALLET_NOT_LINKED' };
    if (target.currency !== wallet.currency) return { ok: false, code: 'TRANSFER_CURRENCY_MISMATCH' };
  }

  if (input.type !== 'transfer' && input.categoryId) {
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, input.categoryId),
          eq(categories.workspaceId, workspace.id),
          eq(categories.type, input.type)
        )
      )
      .limit(1);
    if (rows.length === 0) return { ok: false, code: 'CATEGORY_INVALID' };
  }

  const links = await resolveBusinessLinks(db, workspace.id, {
    projectId: input.type === 'transfer' ? null : input.projectId,
    invoiceId: input.type === 'income' ? input.invoiceId : null,
  });
  if (!links.ok) return { ok: false, code: links.code === 'INVOICE_NOT_FOUND' ? 'INVOICE_NOT_FOUND' : 'PROJECT_NOT_FOUND' };

  let rate = '1';
  if (wallet.currency !== workspace.primaryCurrency) {
    if (!input.exchangeRate) return { ok: false, code: 'EXCHANGE_RATE_REQUIRED' };
    rate = input.exchangeRate;
  }

  return {
    ok: true,
    value: {
      values: {
        type: input.type,
        walletId: wallet.id,
        transferTargetWalletId: input.type === 'transfer' ? (input.transferTargetWalletId ?? null) : null,
        categoryId: input.type === 'transfer' ? null : (input.categoryId ?? null),
        amountMinor: input.amountMinor,
        currencyCode: wallet.currency,
        exchangeRateToWorkspace: normalizeRate(rate),
        convertedAmountMinor: convertMinor(input.amountMinor, wallet.currency, workspace.primaryCurrency, rate),
        title: input.title,
        notes: input.notes ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        projectId: links.value.projectId,
        invoiceId: links.value.invoiceId,
      },
    },
  };
}

interface BalanceEffect {
  type: TransactionInput['type'];
  walletId: number;
  transferTargetWalletId: number | null;
  amountMinor: number;
}

/**
 * Kunci baris dompet yang akan diubah saldonya (exclusive, `SELECT â€¦ FOR UPDATE`) di awal transaksi DB,
 * selalu urut id naik.
 *
 * Tanpa ini InnoDB deadlock saat penulisan paralel: INSERT transaksi mengambil shared lock pada dompet (FK),
 * lalu UPDATE saldo minta exclusive lock â€” dua request yang sama-sama memegang shared lock saling menunggu.
 * Urutan id yang konsisten juga mencegah deadlock antara transfer Aâ†’B dan Bâ†’A yang bersamaan.
 */
async function lockWallets(tx: DbTransaction, ...walletIds: Array<number | null | undefined>): Promise<void> {
  const ids = [...new Set(walletIds.filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.select({ id: wallets.id }).from(wallets).where(inArray(wallets.id, ids)).orderBy(wallets.id).for('update');
}

const DEADLOCK_RETRIES = 3;

function isDeadlock(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } } | null)?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
}

/**
 * Jaring pengaman: ulangi transaksi DB bila InnoDB tetap memilihnya sebagai korban deadlock
 * (aman karena seluruh perubahan di-rollback sebelum diulang).
 */
async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= DEADLOCK_RETRIES || !isDeadlock(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.random() * 25));
    }
  }
}

/** Terapkan (sign = 1) atau batalkan (sign = -1) efek transaksi pada saldo dompet. */
async function applyBalance(tx: DbTransaction, effect: BalanceEffect, sign: 1 | -1): Promise<void> {
  const amount = effect.amountMinor * sign;
  const sourceDelta = effect.type === 'income' ? amount : -amount;
  await tx
    .update(wallets)
    .set({ balanceMinor: sql`${wallets.balanceMinor} + ${sourceDelta}` })
    .where(eq(wallets.id, effect.walletId));

  if (effect.type === 'transfer' && effect.transferTargetWalletId) {
    await tx
      .update(wallets)
      .set({ balanceMinor: sql`${wallets.balanceMinor} + ${amount}` })
      .where(eq(wallets.id, effect.transferTargetWalletId));
  }
}

async function writeAudit(
  tx: DbTransaction,
  actor: Actor,
  entityId: number,
  action: 'create' | 'update' | 'delete',
  metadata: Record<string, unknown>
): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: actor.workspace.id,
    actorUserId: actor.userId,
    entityType: 'transaction',
    entityId,
    action,
    metadataJson: JSON.stringify(metadata),
  });
}

function auditSnapshot(v: BalanceEffect & { title: string; currencyCode: string; categoryId: number | null }) {
  return {
    type: v.type,
    title: v.title,
    amountMinor: v.amountMinor,
    currency: v.currencyCode,
    walletId: v.walletId,
    transferTargetWalletId: v.transferTargetWalletId ?? null,
    categoryId: v.categoryId ?? null,
  };
}

export async function createTransaction(
  db: DbClient,
  actor: Actor,
  input: TransactionInput
): Promise<Result<number>> {
  const prepared = await prepare(db, actor.workspace, input);
  if (!prepared.ok) return prepared;
  const { values } = prepared.value;

  return withDeadlockRetry(() => db.transaction(async (tx): Promise<Result<number>> => {
    await lockWallets(tx, values.walletId, values.transferTargetWalletId);
    // Bayar 1-Klik: kunci tagihan & majukan jatuh tempo di transaksi DB yang sama dengan pencatatan.
    const billId = input.recurringBillId ?? null;
    if (billId) {
      const advanced = await advanceBillInTx(tx, actor.workspace.id, billId);
      if (!advanced.ok) {
        return { ok: false, code: advanced.code === 'RECURRING_INACTIVE' ? 'RECURRING_INACTIVE' : 'RECURRING_NOT_FOUND' };
      }
      if (advanced.value.type !== values.type) {
        // Lempar agar perubahan jatuh tempo ikut dibatalkan (rollback).
        throw new RecurringTypeMismatch();
      }
    }

    const [result] = await tx.insert(transactions).values({
      ...values,
      recurringBillId: billId,
      workspaceId: actor.workspace.id,
      createdByUserId: actor.userId,
    });
    const insertedId = Number(result.insertId);
    await applyBalance(tx, values, 1);
    await recomputeInvoices(tx, [values.invoiceId]);
    await writeAudit(tx, actor, insertedId, 'create', { ...auditSnapshot(values), recurringBillId: billId });
    return { ok: true, value: insertedId };
  })).catch((err: unknown) => {
    if (err instanceof RecurringTypeMismatch) return { ok: false as const, code: 'RECURRING_TYPE_MISMATCH' as const };
    throw err;
  });
}

class RecurringTypeMismatch extends Error {}

async function lockOwnTransaction(tx: DbTransaction, workspaceId: number, transactionId: number) {
  const rows = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, workspaceId)))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

export async function updateTransaction(
  db: DbClient,
  actor: Actor,
  transactionId: number,
  input: TransactionInput
): Promise<Result<number>> {
  const prepared = await prepare(db, actor.workspace, input);
  if (!prepared.ok) return prepared;
  const { values } = prepared.value;

  return withDeadlockRetry(() => db.transaction(async (tx): Promise<Result<number>> => {
    const existing = await lockOwnTransaction(tx, actor.workspace.id, transactionId);
    if (!existing) return { ok: false, code: 'TRANSACTION_NOT_FOUND' };
    if (!canEditTransaction(actor.workspace.role, existing.createdByUserId === actor.userId)) {
      return { ok: false, code: 'FORBIDDEN' };
    }

    await lockWallets(
      tx,
      existing.walletId,
      existing.transferTargetWalletId,
      values.walletId,
      values.transferTargetWalletId
    );
    await applyBalance(tx, existing, -1);
    await tx.update(transactions).set(values).where(eq(transactions.id, transactionId));
    await applyBalance(tx, values, 1);
    await recomputeInvoices(tx, [existing.invoiceId, values.invoiceId]);
    await writeAudit(tx, actor, transactionId, 'update', {
      before: auditSnapshot(existing),
      after: auditSnapshot(values),
    });
    return { ok: true, value: transactionId };
  }));
}

/** Menghapus transaksi + membalik saldo. Mengembalikan path struk yang perlu dihapus dari disk. */
export async function deleteTransaction(
  db: DbClient,
  actor: Actor,
  transactionId: number
): Promise<Result<string[]>> {
  return withDeadlockRetry(() => db.transaction(async (tx): Promise<Result<string[]>> => {
    const existing = await lockOwnTransaction(tx, actor.workspace.id, transactionId);
    if (!existing) return { ok: false, code: 'TRANSACTION_NOT_FOUND' };
    if (!canEditTransaction(actor.workspace.role, existing.createdByUserId === actor.userId)) {
      return { ok: false, code: 'FORBIDDEN' };
    }

    const files = await tx
      .select({ storagePath: receipts.storagePath })
      .from(receipts)
      .where(eq(receipts.transactionId, transactionId));

    await lockWallets(tx, existing.walletId, existing.transferTargetWalletId);
    await applyBalance(tx, existing, -1);
    await tx.delete(transactions).where(eq(transactions.id, transactionId));
    await recomputeInvoices(tx, [existing.invoiceId]);
    await writeAudit(tx, actor, transactionId, 'delete', auditSnapshot(existing));
    return { ok: true, value: files.map((f) => f.storagePath) };
  }));
}

const targetWallet = alias(wallets, 'target_wallet');
const txProject = alias(projects, 'tx_project');
const txInvoice = alias(invoices, 'tx_invoice');

const itemColumns = {
  id: transactions.id,
  workspaceId: transactions.workspaceId,
  sourceWorkspaceName: workspaces.name,
  type: transactions.type,
  amountMinor: transactions.amountMinor,
  currency: transactions.currencyCode,
  exchangeRate: transactions.exchangeRateToWorkspace,
  convertedAmountMinor: transactions.convertedAmountMinor,
  title: transactions.title,
  notes: transactions.notes,
  occurredAt: transactions.occurredAt,
  walletId: wallets.id,
  walletName: wallets.name,
  targetWalletId: targetWallet.id,
  targetWalletName: targetWallet.name,
  categoryId: categories.id,
  categoryName: categories.name,
  categoryColor: categories.color,
  categoryIcon: categories.icon,
  createdById: users.id,
  projectId: txProject.id,
  projectName: txProject.name,
  invoiceId: txInvoice.id,
  invoiceNumber: txInvoice.invoiceNumber,
  createdByName: users.name,
  receiptCount: sql<number>`(select count(*) from ${receipts} where ${receipts.transactionId} = ${transactions.id})`.mapWith(
    Number
  ),
};

function baseItemQuery(db: DbClient) {
  return db
    .select(itemColumns)
    .from(transactions)
    .innerJoin(wallets, eq(transactions.walletId, wallets.id))
    .leftJoin(targetWallet, eq(transactions.transferTargetWalletId, targetWallet.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(users, eq(transactions.createdByUserId, users.id))
    .innerJoin(workspaces, eq(transactions.workspaceId, workspaces.id))
    .leftJoin(txProject, eq(transactions.projectId, txProject.id))
    .leftJoin(txInvoice, eq(transactions.invoiceId, txInvoice.id));
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof baseItemQuery>['execute']>>[number];

function toItem(row: ItemRow, actor: Actor): TransactionItem {
  const foreign = row.workspaceId !== actor.workspace.id;
  return {
    id: row.id,
    type: row.type,
    amountMinor: row.amountMinor,
    currency: row.currency as CurrencyCode,
    exchangeRate: row.exchangeRate,
    convertedAmountMinor: row.convertedAmountMinor,
    title: row.title,
    notes: row.notes,
    occurredAt: row.occurredAt.toISOString(),
    wallet: { id: row.walletId, name: row.walletName },
    targetWallet:
      row.targetWalletId !== null && row.targetWalletName !== null
        ? { id: row.targetWalletId, name: row.targetWalletName }
        : null,
    category:
      row.categoryId !== null
        ? {
            id: row.categoryId,
            name: row.categoryName ?? '',
            color: row.categoryColor ?? '#64748b',
            icon: row.categoryIcon ?? 'tag',
          }
        : null,
    createdBy: { id: row.createdById, name: row.createdByName },
    project: row.projectId !== null && row.projectName !== null ? { id: row.projectId, name: row.projectName } : null,
    invoice:
      row.invoiceId !== null && row.invoiceNumber !== null ? { id: row.invoiceId, number: row.invoiceNumber } : null,
    receiptCount: row.receiptCount,
    sourceWorkspaceName: foreign ? row.sourceWorkspaceName : null,
    canEdit: !foreign && canEditTransaction(actor.workspace.role, row.createdById === actor.userId),
  };
}

/**
 * Transaksi yang terlihat di Workspace:
 * - semua transaksi yang dicatat di Workspace ini, ditambah
 * - transaksi Workspace lain pada dompet yang ditautkan ke sini dengan mode `full_transparent`.
 */
async function visibilityCondition(db: DbClient, workspaceId: number): Promise<SQL> {
  const transparent = await db
    .select({ walletId: workspaceWallets.walletId })
    .from(workspaceWallets)
    .where(
      and(eq(workspaceWallets.workspaceId, workspaceId), eq(workspaceWallets.visibilityMode, 'full_transparent'))
    );
  const own = eq(transactions.workspaceId, workspaceId);
  if (transparent.length === 0) return own;

  const ids = transparent.map((t) => t.walletId);
  return or(
    own,
    and(
      ne(transactions.workspaceId, workspaceId),
      or(inArray(transactions.walletId, ids), inArray(transactions.transferTargetWalletId, ids))
    )
  ) as SQL;
}

export async function listTransactions(
  db: DbClient,
  actor: Actor,
  query: TransactionQuery
): Promise<TransactionPage> {
  const conditions: SQL[] = [await visibilityCondition(db, actor.workspace.id)];
  if (query.from) conditions.push(gte(transactions.occurredAt, new Date(query.from)));
  if (query.to) conditions.push(lt(transactions.occurredAt, new Date(query.to)));
  if (query.type) conditions.push(eq(transactions.type, query.type));
  if (query.categoryId) conditions.push(eq(transactions.categoryId, query.categoryId));
  if (query.q) {
    // Escape wildcard LIKE agar "%" / "_" dari user dicari apa adanya.
    const pattern = `%${query.q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    // LOWER() eksplisit: collation DB bisa case-sensitive (mis. utf8mb4_bin di Laragon).
    conditions.push(
      or(sql`lower(${transactions.title}) like ${pattern}`, sql`lower(${transactions.notes}) like ${pattern}`) as SQL
    );
  }
  if (query.minAmount !== undefined) conditions.push(gte(transactions.convertedAmountMinor, query.minAmount));
  if (query.maxAmount !== undefined) conditions.push(lte(transactions.convertedAmountMinor, query.maxAmount));
  if (query.walletId) {
    conditions.push(
      or(eq(transactions.walletId, query.walletId), eq(transactions.transferTargetWalletId, query.walletId)) as SQL
    );
  }

  if (query.before) {
    // Keyset pagination berdasarkan (occurred_at, id) agar urutan stabil.
    const cursor = await db
      .select({ occurredAt: transactions.occurredAt })
      .from(transactions)
      .where(eq(transactions.id, query.before))
      .limit(1);
    if (cursor[0]) {
      conditions.push(
        or(
          lt(transactions.occurredAt, cursor[0].occurredAt),
          and(eq(transactions.occurredAt, cursor[0].occurredAt), lt(transactions.id, query.before))
        ) as SQL
      );
    }
  }

  const rows = await baseItemQuery(db)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => toItem(row, actor)),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export function receiptUrl(workspaceId: number, receiptId: number): string {
  return `/api/workspaces/${workspaceId}/receipts/${receiptId}`;
}

export async function getTransactionDetail(
  db: DbClient,
  actor: Actor,
  transactionId: number
): Promise<TransactionDetail | null> {
  // Ikuti aturan visibilitas daftar: transaksi Workspace lain via dompet `full_transparent` bisa dilihat.
  const rows = await baseItemQuery(db)
    .where(and(eq(transactions.id, transactionId), await visibilityCondition(db, actor.workspace.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Struk tetap privat milik Workspace tempat transaksi dicatat.
  if (row.workspaceId !== actor.workspace.id) return { ...toItem(row, actor), receiptCount: 0, receipts: [] };

  const receiptRows = await db
    .select({
      id: receipts.id,
      mimeType: receipts.mimeType,
      sizeBytes: receipts.sizeBytes,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .where(eq(receipts.transactionId, transactionId))
    .orderBy(receipts.id);

  const receiptItems: ReceiptItem[] = receiptRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    url: receiptUrl(actor.workspace.id, r.id),
  }));

  return { ...toItem(row, actor), receipts: receiptItems };
}


export async function getWorkspaceOverview(
  db: DbClient,
  actor: Actor,
  monthKey: string,
  walletBalances: Array<{ currency: CurrencyCode; balanceMinor: number }>
): Promise<Omit<WorkspaceOverview, 'dueBills' | 'budgetAlerts'>> {
  const { from, to } = monthRange(monthKey);
  const totals = await db
    .select({
      type: transactions.type,
      total: sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, actor.workspace.id),
        gte(transactions.occurredAt, from),
        lt(transactions.occurredAt, to),
        ne(transactions.type, 'transfer')
      )
    )
    .groupBy(transactions.type);

  const sumOf = (type: 'income' | 'expense') => Number(totals.find((t) => t.type === type)?.total ?? 0);
  const primary = actor.workspace.primaryCurrency;
  const recent = await listTransactions(db, actor, { limit: 5 });

  return {
    month: monthKey,
    primaryCurrency: primary,
    incomeMinor: sumOf('income'),
    expenseMinor: sumOf('expense'),
    totalBalanceMinor: walletBalances
      .filter((w) => w.currency === primary)
      .reduce((acc, w) => acc + w.balanceMinor, 0),
    otherCurrencyWallets: walletBalances.filter((w) => w.currency !== primary).length,
    walletCount: walletBalances.length,
    recent: recent.items,
  };
}
