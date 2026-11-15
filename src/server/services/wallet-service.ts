import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { transactions, users, wallets, workspaceWallets, workspaces } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import type {
  CurrencyCode,
  MyWallet,
  WalletKind,
  WalletVisibilityMode,
  WorkspaceWallet,
} from '@shared/types/domain';
import type { CreateWalletInput, UpdateWalletInput } from '@shared/validation/finance';

export interface LinkedWalletRow {
  id: number;
  name: string;
  currency: CurrencyCode;
  ownerUserId: number;
  visibilityMode: WalletVisibilityMode;
}

/** Dompet yang tertaut ke Workspace (null bila tidak tertaut). */
export async function findLinkedWallet(
  db: DbClient,
  workspaceId: number,
  walletId: number
): Promise<LinkedWalletRow | null> {
  const rows = await db
    .select({
      id: wallets.id,
      name: wallets.name,
      currency: wallets.currencyCode,
      ownerUserId: wallets.ownerUserId,
      visibilityMode: workspaceWallets.visibilityMode,
    })
    .from(workspaceWallets)
    .innerJoin(wallets, eq(workspaceWallets.walletId, wallets.id))
    .where(and(eq(workspaceWallets.workspaceId, workspaceId), eq(workspaceWallets.walletId, walletId)))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, currency: row.currency as CurrencyCode } : null;
}

export async function listWorkspaceWallets(
  db: DbClient,
  workspaceId: number,
  viewerUserId: number
): Promise<WorkspaceWallet[]> {
  const rows = await db
    .select({
      id: wallets.id,
      name: wallets.name,
      kind: wallets.walletKind,
      currency: wallets.currencyCode,
      balanceMinor: wallets.balanceMinor,
      icon: wallets.icon,
      color: wallets.color,
      visibilityMode: workspaceWallets.visibilityMode,
      ownerUserId: wallets.ownerUserId,
      ownerName: users.name,
    })
    .from(workspaceWallets)
    .innerJoin(wallets, eq(workspaceWallets.walletId, wallets.id))
    .innerJoin(users, eq(wallets.ownerUserId, users.id))
    .where(eq(workspaceWallets.workspaceId, workspaceId))
    .orderBy(asc(workspaceWallets.linkedAt), asc(wallets.id));

  return rows.map(({ ownerUserId, ...row }) => ({
    ...row,
    currency: row.currency as CurrencyCode,
    isMine: ownerUserId === viewerUserId,
  }));
}

export async function listMyWallets(db: DbClient, userId: number): Promise<MyWallet[]> {
  const own = await db
    .select({
      id: wallets.id,
      name: wallets.name,
      kind: wallets.walletKind,
      currency: wallets.currencyCode,
      balanceMinor: wallets.balanceMinor,
      icon: wallets.icon,
      color: wallets.color,
    })
    .from(wallets)
    .where(eq(wallets.ownerUserId, userId))
    .orderBy(asc(wallets.id));

  if (own.length === 0) return [];

  const links = await db
    .select({
      walletId: workspaceWallets.walletId,
      id: workspaces.id,
      name: workspaces.name,
      visibilityMode: workspaceWallets.visibilityMode,
    })
    .from(workspaceWallets)
    .innerJoin(workspaces, eq(workspaceWallets.workspaceId, workspaces.id))
    .where(
      inArray(
        workspaceWallets.walletId,
        own.map((w) => w.id)
      )
    );

  return own.map((wallet) => ({
    ...wallet,
    currency: wallet.currency as CurrencyCode,
    linkedWorkspaces: links
      .filter((link) => link.walletId === wallet.id)
      .map(({ walletId: _walletId, ...link }) => link),
  }));
}

/** Membuat dompet milik user dan langsung menautkannya ke Workspace. */
export async function createWalletInWorkspace(
  db: DbClient,
  workspaceId: number,
  ownerUserId: number,
  input: CreateWalletInput
): Promise<number> {
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(wallets).values({
      ownerUserId,
      name: input.name,
      walletKind: input.kind,
      currencyCode: input.currency,
      balanceMinor: input.openingBalanceMinor ?? 0,
      icon: input.icon ?? null,
      color: input.color ?? null,
    });
    const walletId = Number(result.insertId);
    await tx.insert(workspaceWallets).values({
      workspaceId,
      walletId,
      visibilityMode: input.visibilityMode,
      linkedByUserId: ownerUserId,
    });
    return walletId;
  });
}

export async function findOwnedWallet(db: DbClient, walletId: number, userId: number) {
  const rows = await db
    .select({ id: wallets.id, currency: wallets.currencyCode })
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.ownerUserId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function linkWallet(
  db: DbClient,
  workspaceId: number,
  walletId: number,
  userId: number,
  visibilityMode: WalletVisibilityMode
): Promise<void> {
  await db.insert(workspaceWallets).values({ workspaceId, walletId, visibilityMode, linkedByUserId: userId });
}

export async function updateWalletLink(
  db: DbClient,
  workspaceId: number,
  walletId: number,
  visibilityMode: WalletVisibilityMode
): Promise<void> {
  await db
    .update(workspaceWallets)
    .set({ visibilityMode })
    .where(and(eq(workspaceWallets.workspaceId, workspaceId), eq(workspaceWallets.walletId, walletId)));
}

/** true bila dompet dipakai transaksi (sebagai sumber maupun tujuan transfer), opsional dibatasi ke satu Workspace. */
export async function walletHasTransactions(
  db: DbClient,
  walletId: number,
  workspaceId?: number
): Promise<boolean> {
  const usesWallet = or(eq(transactions.walletId, walletId), eq(transactions.transferTargetWalletId, walletId));
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(workspaceId ? and(usesWallet, eq(transactions.workspaceId, workspaceId)) : usesWallet)
    .limit(1);
  return rows.length > 0;
}

export async function unlinkWallet(db: DbClient, workspaceId: number, walletId: number): Promise<void> {
  await db
    .delete(workspaceWallets)
    .where(and(eq(workspaceWallets.workspaceId, workspaceId), eq(workspaceWallets.walletId, walletId)));
}

export async function updateWallet(db: DbClient, walletId: number, input: UpdateWalletInput): Promise<void> {
  await db
    .update(wallets)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.kind !== undefined ? { walletKind: input.kind as WalletKind } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    })
    .where(eq(wallets.id, walletId));
}

/** Menghapus dompet beserta seluruh tautannya (FK cascade). Pastikan tidak ada transaksi sebelum memanggil. */
export async function deleteWallet(db: DbClient, walletId: number): Promise<void> {
  await db.delete(wallets).where(eq(wallets.id, walletId));
}
