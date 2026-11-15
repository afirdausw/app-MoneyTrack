import type { MiddlewareHandler } from 'hono';
import { type AppEnv, jsonError, requireDb } from '@server/lib/http';
import { findWorkspaceForUser } from '@server/services/workspace-service';
import type { WorkspaceRole } from '@shared/types/domain';
import { hasMinimumRole } from '@shared/utils/permissions';

/**
 * Memastikan user aktif adalah anggota Workspace pada param `:wsId` dengan role minimal `minimumRole`.
 * Wajib dipasang setelah `requireAuth`. Hasilnya tersedia lewat `c.get('workspace')`.
 *
 * - Bukan anggota / Workspace tidak ada → 404 (tidak membocorkan keberadaan Workspace orang lain).
 * - Anggota tetapi role kurang → 403.
 */
export function requireWorkspaceRole(minimumRole: WorkspaceRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const wsId = Number(c.req.param('wsId'));
    if (!Number.isSafeInteger(wsId) || wsId <= 0) {
      return jsonError(c, 400, 'VALIDATION_ERROR', 'ID Workspace tidak valid.');
    }

    const db = requireDb(c);
    if (db instanceof Response) return db;

    const workspace = await findWorkspaceForUser(db, wsId, c.get('authUser').id);
    if (!workspace) {
      return jsonError(c, 404, 'WORKSPACE_NOT_FOUND', 'Workspace tidak ditemukan.');
    }

    if (!hasMinimumRole(workspace.role, minimumRole)) {
      return jsonError(
        c,
        403,
        'FORBIDDEN',
        'Role kamu di Workspace ini tidak memiliki izin untuk aksi tersebut.'
      );
    }

    c.set('workspace', workspace);
    await next();
  };
}
