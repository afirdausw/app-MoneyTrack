import { eq } from 'drizzle-orm';
import {
  categories,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import {
  SESSION_TTL_SECONDS,
  generateRandomToken,
  hashSessionToken,
} from '@server/lib/security';
import type { AuthUser, CurrencyCode, WorkspaceSummary } from '@shared/types/domain';

const DEFAULT_PERSONAL_CATEGORIES: Array<{
  name: string;
  type: 'income' | 'expense';
  color: string;
  icon: string;
}> = [
  { name: 'Gaji & Penghasilan', type: 'income', color: '#059669', icon: 'wallet' },
  { name: 'Bonus & Lainnya', type: 'income', color: '#10b981', icon: 'sparkles' },
  { name: 'Makanan & Minuman', type: 'expense', color: '#f97316', icon: 'utensils' },
  { name: 'Transportasi', type: 'expense', color: '#0ea5e9', icon: 'car' },
  { name: 'Tagihan & Utilitas', type: 'expense', color: '#6366f1', icon: 'receipt' },
  { name: 'Belanja Harian', type: 'expense', color: '#ec4899', icon: 'shopping-bag' },
  { name: 'Kesehatan', type: 'expense', color: '#ef4444', icon: 'heart' },
  { name: 'Hiburan', type: 'expense', color: '#8b5cf6', icon: 'film' },
];

type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export async function provisionDefaultPersonalWorkspace(
  tx: DbTransaction,
  userId: number
): Promise<WorkspaceSummary> {
  const [wsResult] = await tx.insert(workspaces).values({
    name: 'Keuangan Pribadi',
    type: 'personal',
    primaryCurrency: 'IDR',
    createdByUserId: userId,
  });

  const workspaceId = Number(wsResult.insertId);

  await tx.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: 'owner',
  });

  await tx.insert(categories).values(
    DEFAULT_PERSONAL_CATEGORIES.map((cat) => ({
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
    name: 'Keuangan Pribadi',
    type: 'personal',
    primaryCurrency: 'IDR',
    role: 'owner',
  };
}

export async function getUserWorkspaces(
  db: DbClient,
  userId: number
): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      type: workspaces.type,
      primaryCurrency: workspaces.primaryCurrency,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    primaryCurrency: row.primaryCurrency as CurrencyCode,
    role: row.role,
  }));
}

export async function createUserWithDefaultWorkspace(
  db: DbClient,
  input: {
    name: string;
    email: string;
    passwordHash: string | null;
    googleId?: string | null;
    avatarUrl?: string | null;
  }
): Promise<{ user: AuthUser; workspaces: WorkspaceSummary[] }> {
  return db.transaction(async (tx) => {
    const [userResult] = await tx.insert(users).values({
      name: input.name,
      email: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      googleId: input.googleId ?? null,
      avatarUrl: input.avatarUrl ?? null,
    });

    const userId = Number(userResult.insertId);
    const defaultWorkspace = await provisionDefaultPersonalWorkspace(tx, userId);

    return {
      user: {
        id: userId,
        name: input.name,
        email: input.email.trim().toLowerCase(),
        avatarUrl: input.avatarUrl ?? null,
      },
      workspaces: [defaultWorkspace],
    };
  });
}

export async function createSessionForUser(db: DbClient, userId: number): Promise<string> {
  const rawToken = generateRandomToken(32);
  const sessionId = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return rawToken;
}

export async function deleteSessionByRawToken(db: DbClient, rawToken: string): Promise<void> {
  const sessionId = hashSessionToken(rawToken);
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
