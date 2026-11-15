import { and, eq, inArray, or } from 'drizzle-orm';
import { transactions, users, wallets, workspaceMembers, workspaceWallets } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import { recordAudit } from '@server/services/audit-service';
import type { Actor } from '@server/services/transaction-service';
import type { WorkspaceRole } from '@shared/types/domain';
import { canManageMember } from '@shared/utils/permissions';

export type MemberErrorCode = 'MEMBER_NOT_FOUND' | 'FORBIDDEN' | 'OWNER_CANNOT_LEAVE' | 'CANNOT_CHANGE_SELF';
export type MemberResult = { ok: true } | { ok: false; code: MemberErrorCode };

async function findMember(db: DbClient, workspaceId: number, userId: number) {
  const rows = await db
    .select({ role: workspaceMembers.role, name: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function changeMemberRole(
  db: DbClient,
  actor: Actor,
  targetUserId: number,
  newRole: Exclude<WorkspaceRole, 'owner'>
): Promise<MemberResult> {
  if (targetUserId === actor.userId) return { ok: false, code: 'CANNOT_CHANGE_SELF' };
  const target = await findMember(db, actor.workspace.id, targetUserId);
  if (!target) return { ok: false, code: 'MEMBER_NOT_FOUND' };
  if (!canManageMember(actor.workspace.role, target.role, newRole)) return { ok: false, code: 'FORBIDDEN' };
  if (target.role === newRole) return { ok: true };

  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMembers)
      .set({ role: newRole })
      .where(and(eq(workspaceMembers.workspaceId, actor.workspace.id), eq(workspaceMembers.userId, targetUserId)));
    await recordAudit(tx, {
      workspaceId: actor.workspace.id,
      actorUserId: actor.userId,
      entityType: 'member',
      entityId: targetUserId,
      action: 'update',
      metadata: { event: 'role_changed', targetName: target.name, fromRole: target.role, toRole: newRole },
    });
  });
  return { ok: true };
}

/**
 * Keluarkan anggota (atau keluar sendiri bila `targetUserId` = aktor).
 * Privasi: dompet milik anggota yang belum dipakai transaksi di Workspace ini dilepas, dan dompet
 * yang masih dipakai diturunkan ke `workspace_only` agar riwayat pribadinya tidak terus terlihat.
 */
export async function removeMember(db: DbClient, actor: Actor, targetUserId: number): Promise<MemberResult> {
  const leaving = targetUserId === actor.userId;
  const target = await findMember(db, actor.workspace.id, targetUserId);
  if (!target) return { ok: false, code: 'MEMBER_NOT_FOUND' };
  if (leaving && target.role === 'owner') return { ok: false, code: 'OWNER_CANNOT_LEAVE' };
  if (!leaving && !canManageMember(actor.workspace.role, target.role)) return { ok: false, code: 'FORBIDDEN' };

  const workspaceId = actor.workspace.id;
  await db.transaction(async (tx) => {
    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));

    const linked = await tx
      .select({ walletId: workspaceWallets.walletId })
      .from(workspaceWallets)
      .innerJoin(wallets, eq(workspaceWallets.walletId, wallets.id))
      .where(and(eq(workspaceWallets.workspaceId, workspaceId), eq(wallets.ownerUserId, targetUserId)));
    const walletIds = linked.map((l) => l.walletId);

    if (walletIds.length > 0) {
      const used = await tx
        .selectDistinct({ walletId: transactions.walletId, targetId: transactions.transferTargetWalletId })
        .from(transactions)
        .where(
          and(
            eq(transactions.workspaceId, workspaceId),
            or(inArray(transactions.walletId, walletIds), inArray(transactions.transferTargetWalletId, walletIds))
          )
        );
      const usedIds = new Set(used.flatMap((u) => [u.walletId, u.targetId]).filter((id): id is number => id !== null));
      const unused = walletIds.filter((id) => !usedIds.has(id));
      const stillUsed = walletIds.filter((id) => usedIds.has(id));

      if (unused.length > 0) {
        await tx
          .delete(workspaceWallets)
          .where(and(eq(workspaceWallets.workspaceId, workspaceId), inArray(workspaceWallets.walletId, unused)));
      }
      if (stillUsed.length > 0) {
        await tx
          .update(workspaceWallets)
          .set({ visibilityMode: 'workspace_only' })
          .where(and(eq(workspaceWallets.workspaceId, workspaceId), inArray(workspaceWallets.walletId, stillUsed)));
      }
    }

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      entityType: 'member',
      entityId: targetUserId,
      action: 'delete',
      metadata: { event: leaving ? 'left' : 'removed', targetName: target.name, role: target.role },
    });
  });
  return { ok: true };
}
