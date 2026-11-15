import { and, asc, count, eq } from 'drizzle-orm';
import { categories, receipts, transactions, workspaceMembers, workspaces } from '@server/db/schema';
import { deleteStoredFiles } from '@server/lib/storage';
import type { DbClient } from '@server/lib/http';
import type {
  CurrencyCode,
  WorkspaceDetail,
  WorkspaceSummary,
  WorkspaceType,
} from '@shared/types/domain';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from '@shared/validation/workspace';

export type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

interface DefaultCategory {
  name: string;
  type: 'income' | 'expense';
  color: string;
  icon: string;
}

/** Kategori bawaan yang otomatis dibuat sesuai mode Workspace. */
export const DEFAULT_CATEGORIES: Record<WorkspaceType, DefaultCategory[]> = {
  personal: [
    { name: 'Gaji & Penghasilan', type: 'income', color: '#059669', icon: 'wallet' },
    { name: 'Bonus & Lainnya', type: 'income', color: '#10b981', icon: 'sparkles' },
    { name: 'Makanan & Minuman', type: 'expense', color: '#f97316', icon: 'utensils' },
    { name: 'Transportasi', type: 'expense', color: '#0ea5e9', icon: 'car' },
    { name: 'Tagihan & Utilitas', type: 'expense', color: '#6366f1', icon: 'receipt' },
    { name: 'Belanja Harian', type: 'expense', color: '#ec4899', icon: 'shopping-bag' },
    { name: 'Kesehatan', type: 'expense', color: '#ef4444', icon: 'heart' },
    { name: 'Hiburan', type: 'expense', color: '#8b5cf6', icon: 'film' },
  ],
  shared: [
    { name: 'Iuran Anggota', type: 'income', color: '#059669', icon: 'users' },
    { name: 'Pemasukan Lainnya', type: 'income', color: '#10b981', icon: 'sparkles' },
    { name: 'Konsumsi Bersama', type: 'expense', color: '#f97316', icon: 'utensils' },
    { name: 'Kebutuhan Rumah / Kos', type: 'expense', color: '#ec4899', icon: 'home' },
    { name: 'Tagihan & Utilitas', type: 'expense', color: '#6366f1', icon: 'receipt' },
    { name: 'Sewa', type: 'expense', color: '#0ea5e9', icon: 'key' },
    { name: 'Kegiatan & Acara', type: 'expense', color: '#8b5cf6', icon: 'calendar' },
    { name: 'Lain-lain', type: 'expense', color: '#64748b', icon: 'tag' },
  ],
  business: [
    { name: 'Penjualan / Jasa', type: 'income', color: '#059669', icon: 'briefcase' },
    { name: 'Pendapatan Lainnya', type: 'income', color: '#10b981', icon: 'sparkles' },
    { name: 'Bahan Baku / HPP', type: 'expense', color: '#f97316', icon: 'package' },
    { name: 'Operasional', type: 'expense', color: '#0ea5e9', icon: 'settings' },
    { name: 'Gaji & Honor', type: 'expense', color: '#6366f1', icon: 'users' },
    { name: 'Pemasaran & Iklan', type: 'expense', color: '#ec4899', icon: 'megaphone' },
    { name: 'Peralatan & Software', type: 'expense', color: '#8b5cf6', icon: 'laptop' },
    { name: 'Pajak & Biaya Admin', type: 'expense', color: '#ef4444', icon: 'landmark' },
  ],
};

/** Membuat Workspace + keanggotaan owner + kategori default di dalam DB transaction yang sudah berjalan. */
export async function createWorkspaceInTx(
  tx: DbTransaction,
  ownerUserId: number,
  input: CreateWorkspaceInput
): Promise<WorkspaceSummary> {
  const [wsResult] = await tx.insert(workspaces).values({
    name: input.name,
    type: input.type,
    primaryCurrency: input.primaryCurrency,
    icon: input.icon ?? null,
    color: input.color ?? null,
    createdByUserId: ownerUserId,
  });

  const workspaceId = Number(wsResult.insertId);

  await tx.insert(workspaceMembers).values({
    workspaceId,
    userId: ownerUserId,
    role: 'owner',
  });

  await tx.insert(categories).values(
    DEFAULT_CATEGORIES[input.type].map((cat) => ({
      workspaceId,
      name: cat.name,
      type: cat.type,
      color: cat.color,
      icon: cat.icon,
      isDefault: true,
    }))
  );

  return {
    id: workspaceId,
    name: input.name,
    type: input.type,
    primaryCurrency: input.primaryCurrency,
    role: 'owner',
    icon: input.icon ?? null,
    color: input.color ?? null,
  };
}

export function createWorkspace(
  db: DbClient,
  ownerUserId: number,
  input: CreateWorkspaceInput
): Promise<WorkspaceSummary> {
  return db.transaction((tx) => createWorkspaceInTx(tx, ownerUserId, input));
}

const summaryColumns = {
  id: workspaces.id,
  name: workspaces.name,
  type: workspaces.type,
  primaryCurrency: workspaces.primaryCurrency,
  role: workspaceMembers.role,
  icon: workspaces.icon,
  color: workspaces.color,
};

function toSummary(row: {
  id: number;
  name: string;
  type: WorkspaceType;
  primaryCurrency: string;
  role: WorkspaceSummary['role'];
  icon: string | null;
  color: string | null;
}): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    primaryCurrency: row.primaryCurrency as CurrencyCode,
    role: row.role,
    icon: row.icon,
    color: row.color,
  };
}

/** Workspace yang diikuti user, urut sesuai waktu bergabung (Workspace Pribadi awal selalu pertama). */
export async function getUserWorkspaces(
  db: DbClient,
  userId: number
): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.joinedAt), asc(workspaces.id));

  return rows.map(toSummary);
}

/** Workspace + role user, atau null bila Workspace tidak ada / user bukan anggota. */
export async function findWorkspaceForUser(
  db: DbClient,
  workspaceId: number,
  userId: number
): Promise<WorkspaceSummary | null> {
  const rows = await db
    .select(summaryColumns)
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);

  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getWorkspaceDetail(
  db: DbClient,
  workspace: WorkspaceSummary
): Promise<WorkspaceDetail> {
  const [wsRows, memberRows, categoryRows] = await Promise.all([
    db
      .select({ createdAt: workspaces.createdAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id))
      .limit(1),
    db
      .select({ total: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id)),
    db
      .select({ total: count() })
      .from(categories)
      .where(eq(categories.workspaceId, workspace.id)),
  ]);

  return {
    ...workspace,
    memberCount: memberRows[0]?.total ?? 0,
    categoryCount: categoryRows[0]?.total ?? 0,
    createdAt: (wsRows[0]?.createdAt ?? new Date()).toISOString(),
  };
}

export async function workspaceHasTransactions(db: DbClient, workspaceId: number): Promise<boolean> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.workspaceId, workspaceId))
    .limit(1);
  return rows.length > 0;
}

export async function updateWorkspace(
  db: DbClient,
  workspaceId: number,
  input: UpdateWorkspaceInput
): Promise<void> {
  await db
    .update(workspaces)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.primaryCurrency !== undefined ? { primaryCurrency: input.primaryCurrency } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    })
    .where(eq(workspaces.id, workspaceId));
}

export async function countUserWorkspaces(db: DbClient, userId: number): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return rows[0]?.total ?? 0;
}

/**
 * Menghapus Workspace; seluruh data turunan ikut terhapus lewat FK `ON DELETE CASCADE`,
 * lalu file struk di disk dibersihkan.
 */
export async function deleteWorkspace(db: DbClient, workspaceId: number): Promise<void> {
  const files = await db
    .select({ storagePath: receipts.storagePath })
    .from(receipts)
    .where(eq(receipts.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await deleteStoredFiles(files.map((f) => f.storagePath));
}
