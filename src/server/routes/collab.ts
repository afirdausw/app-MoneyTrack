import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { requireWorkspaceRole } from '@server/middleware/workspace';
import { listAuditLogs } from '@server/services/audit-service';
import { type MemberErrorCode, changeMemberRole, removeMember } from '@server/services/member-service';
import {
  type SplitErrorCode,
  createSplit,
  deleteSplit,
  listSplits,
  settlePair,
  sharedCashSummary,
} from '@server/services/split-service';
import type { Actor } from '@server/services/transaction-service';
import type { AuditLogPage, SharedCashSummary, SplitItem } from '@shared/types/domain';
import { auditQuerySchema, createSplitSchema, settlePairSchema, updateMemberRoleSchema } from '@shared/validation/collab';
import { monthKeySchema } from '@shared/validation/finance';

/** Kolaborasi: anggota, split bill & settlement, kas bersama, audit log — di bawah `/api/workspaces/:wsId`. */
export const collabRoutes = new Hono<AppEnv>();

const ERRORS: Record<MemberErrorCode | SplitErrorCode, [ContentfulStatusCode, string]> = {
  MEMBER_NOT_FOUND: [404, 'Anggota tidak ditemukan di Workspace ini.'],
  FORBIDDEN: [403, 'Role kamu tidak memiliki izin untuk aksi ini.'],
  OWNER_CANNOT_LEAVE: [409, 'Owner tidak bisa keluar. Hapus Workspace atau tetap sebagai owner.'],
  CANNOT_CHANGE_SELF: [409, 'Kamu tidak bisa mengubah role diri sendiri.'],
  SPLIT_NOT_FOUND: [404, 'Split bill tidak ditemukan.'],
  NOT_A_MEMBER: [400, 'Pembayar dan semua peserta harus anggota Workspace ini.'],
  NOTHING_TO_SETTLE: [409, 'Tidak ada utang yang perlu dilunasi untuk pasangan ini.'],
};

function fail(c: Context, code: keyof typeof ERRORS) {
  const [status, message] = ERRORS[code];
  return jsonError(c, status, code, message);
}

function actorOf(c: Context<AppEnv>): Actor {
  return { userId: c.get('authUser').id, workspace: c.get('workspace') };
}

function idParam(c: Context, name: string): number | null {
  const id = Number(c.req.param(name));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const invalidId = (c: Context) => jsonError(c, 400, 'VALIDATION_ERROR', 'ID tidak valid.');
const validationError = (c: Context, message?: string) =>
  jsonError(c, 400, 'VALIDATION_ERROR', message ?? 'Input tidak valid');

// ---------- Anggota ----------

collabRoutes.patch('/members/:userId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const userId = idParam(c, 'userId');
  if (!userId) return invalidId(c);
  const parsed = updateMemberRoleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error.issues[0]?.message);

  const result = await changeMemberRole(db, actorOf(c), userId, parsed.data.role);
  return result.ok ? jsonOk(c, { userId, role: parsed.data.role }) : fail(c, result.code);
});

/** Keluarkan anggota (admin/owner) atau keluar sendiri (`:userId` = diri sendiri, semua role kecuali owner). */
collabRoutes.delete('/members/:userId', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const userId = idParam(c, 'userId');
  if (!userId) return invalidId(c);
  const result = await removeMember(db, actorOf(c), userId);
  return result.ok ? jsonOk(c, { removed: true, userId }) : fail(c, result.code);
});

// ---------- Kas bersama & split bill ----------

collabRoutes.get('/shared-cash', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const month = monthKeySchema.safeParse(c.req.query('month'));
  if (!month.success) return validationError(c, 'Parameter month harus berformat YYYY-MM.');
  return jsonOk<SharedCashSummary>(c, await sharedCashSummary(db, actorOf(c), month.data));
});

collabRoutes.get('/splits', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<SplitItem[]>(c, await listSplits(db, actorOf(c)));
});

collabRoutes.post('/splits', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = createSplitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error.issues[0]?.message);

  const actor = actorOf(c);
  const result = await createSplit(db, actor, parsed.data);
  if (!result.ok) return fail(c, result.code);
  const created = (await listSplits(db, actor)).find((s) => s.id === result.value);
  return jsonOk<SplitItem>(c, created!, 201);
});

collabRoutes.delete('/splits/:splitId', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const splitId = idParam(c, 'splitId');
  if (!splitId) return invalidId(c);
  const result = await deleteSplit(db, actorOf(c), splitId);
  return result.ok ? jsonOk(c, { deleted: true, id: splitId }) : fail(c, result.code);
});

/** Konfirmasi pelunasan netto antar dua anggota (oleh penerima uang atau admin). */
collabRoutes.post('/splits/settle', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = settlePairSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error.issues[0]?.message);

  const result = await settlePair(db, actorOf(c), parsed.data.fromUserId, parsed.data.toUserId);
  return result.ok ? jsonOk(c, result.value) : fail(c, result.code);
});

// ---------- Audit log ----------

collabRoutes.get('/audit-logs', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const query = auditQuerySchema.safeParse(c.req.query());
  if (!query.success) return validationError(c, query.error.issues[0]?.message);
  return jsonOk<AuditLogPage>(c, await listAuditLogs(db, c.get('workspace').id, query.data));
});
