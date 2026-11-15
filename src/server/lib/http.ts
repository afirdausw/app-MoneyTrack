import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { getDb } from '@server/db';
import type * as schema from '@server/db/schema';
import type { ApiError, ApiSuccess, AuthUser, WorkspaceSummary } from '@shared/types/domain';

export type DbClient = MySql2Database<typeof schema>;

export interface AppEnv {
  Variables: {
    authUser: AuthUser;
    /** Diisi oleh `requireWorkspaceRole` — Workspace dari param `:wsId` + role user aktif. */
    workspace: WorkspaceSummary;
  };
}

export function jsonOk<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  const payload: ApiSuccess<T> = { ok: true, data };
  return c.json(payload, status);
}

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string
) {
  const payload: ApiError = {
    ok: false,
    error: { code, message },
  };
  return c.json(payload, status);
}

export function requireDb(c: Context): DbClient | Response {
  const db = getDb();
  if (!db) {
    return jsonError(
      c,
      503,
      'DATABASE_NOT_CONFIGURED',
      'Database belum dikonfigurasi pada .env.'
    );
  }
  return db;
}
