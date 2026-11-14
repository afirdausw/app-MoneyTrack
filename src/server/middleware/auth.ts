import { and, eq, gt } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { getDb } from '@server/db';
import { sessions, users } from '@server/db/schema';
import { type AppEnv, jsonError } from '@server/lib/http';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  hashSessionToken,
} from '@server/lib/security';
import type { AuthUser } from '@shared/types/domain';

export async function resolveUserFromSessionCookie(rawToken: string): Promise<AuthUser | null> {
  const db = getDb();
  if (!db) {
    return null;
  }

  const sessionId = hashSessionToken(rawToken);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return rows[0] ?? null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!rawToken) {
    return jsonError(c, 401, 'UNAUTHORIZED', 'Silakan login terlebih dahulu.');
  }

  const user = await resolveUserFromSessionCookie(rawToken);
  if (!user) {
    clearSessionCookie(c);
    return jsonError(c, 401, 'SESSION_EXPIRED', 'Sesi login tidak valid atau telah berakhir.');
  }

  c.set('authUser', user);
  await next();
};
