import { and, eq, lt } from 'drizzle-orm';
import { sessions, users } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import {
  SESSION_TTL_SECONDS,
  generateRandomToken,
  hashSessionToken,
} from '@server/lib/security';
import { createWorkspaceInTx } from '@server/services/workspace-service';
import type { AuthUser, WorkspaceSummary } from '@shared/types/domain';

export { getUserWorkspaces } from '@server/services/workspace-service';

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
    const defaultWorkspace = await createWorkspaceInTx(tx, userId, {
      name: 'Keuangan Pribadi',
      type: 'personal',
      primaryCurrency: 'IDR',
    });

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

  // Bersihkan sesi kedaluwarsa milik user ini agar tabel sessions tidak terus membengkak.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));

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
