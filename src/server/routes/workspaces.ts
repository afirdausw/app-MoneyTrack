import { Hono } from 'hono';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { requireAuth } from '@server/middleware/auth';
import { requireWorkspaceRole } from '@server/middleware/workspace';
import { financeRoutes } from '@server/routes/finance';
import { businessRoutes } from '@server/routes/business';
import { collabRoutes } from '@server/routes/collab';
import { planningRoutes } from '@server/routes/planning';
import { reportRoutes } from '@server/routes/reports';
import { recordAudit } from '@server/services/audit-service';
import { workspaceHasBusinessData } from '@server/services/business-service';
import { workspaceHasPlanningData } from '@server/services/planning-service';
import {
  createInvite,
  listPendingInvites,
  listWorkspaceMembers,
  revokeInvite,
} from '@server/services/invite-service';
import {
  countUserWorkspaces,
  createWorkspace,
  deleteWorkspace,
  getUserWorkspaces,
  getWorkspaceDetail,
  updateWorkspace,
  workspaceHasTransactions,
} from '@server/services/workspace-service';
import type {
  CreatedWorkspaceInvite,
  WorkspaceDetail,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceSummary,
} from '@shared/types/domain';
import { canInviteWithRole } from '@shared/utils/permissions';
import { createInviteSchema } from '@shared/validation/invite';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@shared/validation/workspace';

export const workspaceRoutes = new Hono<AppEnv>();

workspaceRoutes.use('*', requireAuth);

// Dompet, kategori, transaksi & struk: /api/workspaces/:wsId/...
workspaceRoutes.route('/:wsId', financeRoutes);
workspaceRoutes.route('/:wsId', planningRoutes);
workspaceRoutes.route('/:wsId', collabRoutes);
workspaceRoutes.route('/:wsId', businessRoutes);
workspaceRoutes.route('/:wsId', reportRoutes);

workspaceRoutes.get('/', async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  return jsonOk<WorkspaceSummary[]>(c, await getUserWorkspaces(db, c.get('authUser').id));
});

workspaceRoutes.post('/', async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  const body = await c.req.json().catch(() => null);
  const parsed = createWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Input tidak valid');
  }

  const created = await createWorkspace(db, c.get('authUser').id, parsed.data);
  return jsonOk<WorkspaceSummary>(c, created, 201);
});

workspaceRoutes.get('/:wsId', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  return jsonOk<WorkspaceDetail>(c, await getWorkspaceDetail(db, c.get('workspace')));
});

workspaceRoutes.patch('/:wsId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  const body = await c.req.json().catch(() => null);
  const parsed = updateWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Input tidak valid');
  }

  const workspace = c.get('workspace');
  const currencyChanged =
    parsed.data.primaryCurrency !== undefined &&
    parsed.data.primaryCurrency !== workspace.primaryCurrency;

  // Nominal transaksi dikonversi ke mata uang utama saat dicatat, jadi mata uang utama
  // dikunci setelah ada transaksi agar laporan lama tidak berubah makna.
  if (
    currencyChanged &&
    ((await workspaceHasTransactions(db, workspace.id)) ||
      (await workspaceHasPlanningData(db, workspace.id)) ||
      (await workspaceHasBusinessData(db, workspace.id)))
  ) {
    return jsonError(
      c,
      409,
      'CURRENCY_LOCKED',
      'Mata uang utama tidak bisa diubah karena Workspace ini sudah memiliki transaksi, budget, target, atau tagihan.'
    );
  }

  await updateWorkspace(db, workspace.id, parsed.data);
  await recordAudit(db, {
    workspaceId: workspace.id,
    actorUserId: c.get('authUser').id,
    entityType: 'workspace',
    entityId: workspace.id,
    action: 'update',
    metadata: { changes: parsed.data },
  });

  return jsonOk<WorkspaceSummary>(c, {
    ...workspace,
    name: parsed.data.name ?? workspace.name,
    primaryCurrency: parsed.data.primaryCurrency ?? workspace.primaryCurrency,
    icon: parsed.data.icon !== undefined ? parsed.data.icon : workspace.icon,
    color: parsed.data.color !== undefined ? parsed.data.color : workspace.color,
  });
});

workspaceRoutes.delete('/:wsId', requireWorkspaceRole('owner'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  const workspace = c.get('workspace');
  if ((await countUserWorkspaces(db, c.get('authUser').id)) <= 1) {
    return jsonError(
      c,
      409,
      'LAST_WORKSPACE',
      'Workspace terakhir tidak bisa dihapus. Buat Workspace lain terlebih dahulu.'
    );
  }

  await deleteWorkspace(db, workspace.id);
  return jsonOk(c, { deleted: true, id: workspace.id });
});

workspaceRoutes.get('/:wsId/members', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  return jsonOk<WorkspaceMember[]>(c, await listWorkspaceMembers(db, c.get('workspace').id));
});

workspaceRoutes.get('/:wsId/invites', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  return jsonOk<WorkspaceInvite[]>(c, await listPendingInvites(db, c.get('workspace').id));
});

workspaceRoutes.post('/:wsId/invites', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  const body = await c.req.json().catch(() => null);
  const parsed = createInviteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Input tidak valid');
  }

  const workspace = c.get('workspace');
  if (!canInviteWithRole(workspace.role, parsed.data.role)) {
    return jsonError(c, 403, 'FORBIDDEN', 'Hanya owner yang bisa mengundang anggota sebagai admin.');
  }

  const authUser = c.get('authUser');
  const invite = await createInvite(db, workspace.id, authUser, parsed.data);
  return jsonOk<CreatedWorkspaceInvite>(c, invite, 201);
});

workspaceRoutes.delete('/:wsId/invites/:inviteId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  const inviteId = Number(c.req.param('inviteId'));
  if (!Number.isSafeInteger(inviteId) || inviteId <= 0) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'ID undangan tidak valid.');
  }

  if (!(await revokeInvite(db, c.get('workspace').id, inviteId))) {
    return jsonError(c, 404, 'INVITE_NOT_FOUND', 'Undangan tidak ditemukan atau sudah dipakai.');
  }
  return jsonOk(c, { revoked: true, id: inviteId });
});
