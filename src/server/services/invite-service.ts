import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { env } from '@server/config/env';
import { users, workspaceInvites, workspaceMembers, workspaces } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import { generateRandomToken, hashInviteToken } from '@server/lib/security';
import { recordAudit } from '@server/services/audit-service';
import { findWorkspaceForUser } from '@server/services/workspace-service';
import type {
  CreatedWorkspaceInvite,
  InvitePreview,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceSummary,
} from '@shared/types/domain';
import type { CreateInviteData } from '@shared/validation/invite';

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildInviteUrl(rawToken: string): string {
  return `${env.APP_URL.replace(/\/+$/, '')}/invite/${rawToken}`;
}

export async function createInvite(
  db: DbClient,
  workspaceId: number,
  inviter: { id: number; name: string },
  input: CreateInviteData
): Promise<CreatedWorkspaceInvite> {
  const rawToken = generateRandomToken(24);
  const expiresAt = new Date(Date.now() + input.expiresInDays * DAY_MS);

  const [result] = await db.insert(workspaceInvites).values({
    workspaceId,
    invitedByUserId: inviter.id,
    email: input.email ?? null,
    role: input.role,
    token: hashInviteToken(rawToken),
    expiresAt,
  });

  return {
    id: Number(result.insertId),
    role: input.role,
    email: input.email ?? null,
    invitedByName: inviter.name,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    inviteUrl: buildInviteUrl(rawToken),
  };
}

/** Undangan yang masih bisa dipakai (belum diterima dan belum kedaluwarsa). */
export async function listPendingInvites(
  db: DbClient,
  workspaceId: number
): Promise<WorkspaceInvite[]> {
  const rows = await db
    .select({
      id: workspaceInvites.id,
      role: workspaceInvites.role,
      email: workspaceInvites.email,
      invitedByName: users.name,
      expiresAt: workspaceInvites.expiresAt,
      createdAt: workspaceInvites.createdAt,
    })
    .from(workspaceInvites)
    .innerJoin(users, eq(workspaceInvites.invitedByUserId, users.id))
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.acceptedAt),
        gt(workspaceInvites.expiresAt, new Date())
      )
    )
    .orderBy(desc(workspaceInvites.createdAt), desc(workspaceInvites.id));

  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Menghapus undangan yang belum diterima. Mengembalikan false bila tidak ditemukan di Workspace ini. */
export async function revokeInvite(
  db: DbClient,
  workspaceId: number,
  inviteId: number
): Promise<boolean> {
  const [result] = await db
    .delete(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.acceptedAt)
      )
    );
  return result.affectedRows > 0;
}

async function findInviteByRawToken(db: DbClient, rawToken: string) {
  const rows = await db
    .select({
      id: workspaceInvites.id,
      workspaceId: workspaceInvites.workspaceId,
      role: workspaceInvites.role,
      email: workspaceInvites.email,
      expiresAt: workspaceInvites.expiresAt,
      acceptedAt: workspaceInvites.acceptedAt,
      workspaceName: workspaces.name,
      workspaceType: workspaces.type,
      invitedByName: users.name,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
    .innerJoin(users, eq(workspaceInvites.invitedByUserId, users.id))
    .where(eq(workspaceInvites.token, hashInviteToken(rawToken)))
    .limit(1);
  return rows[0] ?? null;
}

type InviteRow = NonNullable<Awaited<ReturnType<typeof findInviteByRawToken>>>;

function inviteStatus(invite: InviteRow): InvitePreview['status'] {
  if (invite.acceptedAt) return 'used';
  if (invite.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

export async function getInvitePreview(
  db: DbClient,
  rawToken: string
): Promise<InvitePreview | null> {
  const invite = await findInviteByRawToken(db, rawToken);
  if (!invite) return null;

  return {
    workspaceName: invite.workspaceName,
    workspaceType: invite.workspaceType,
    role: invite.role,
    invitedByName: invite.invitedByName,
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
    status: inviteStatus(invite),
  };
}

export type AcceptInviteResult =
  | { ok: true; workspace: WorkspaceSummary; alreadyMember: boolean }
  | {
      ok: false;
      code: 'INVITE_NOT_FOUND' | 'INVITE_EXPIRED' | 'INVITE_USED' | 'INVITE_EMAIL_MISMATCH';
    };

export async function acceptInvite(
  db: DbClient,
  rawToken: string,
  user: { id: number; email: string }
): Promise<AcceptInviteResult> {
  const invite = await findInviteByRawToken(db, rawToken);
  if (!invite) return { ok: false, code: 'INVITE_NOT_FOUND' };

  const status = inviteStatus(invite);
  if (status === 'used') return { ok: false, code: 'INVITE_USED' };
  if (status === 'expired') return { ok: false, code: 'INVITE_EXPIRED' };

  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, code: 'INVITE_EMAIL_MISMATCH' };
  }

  // Sudah anggota: jangan pakai undangannya (bisa jadi untuk orang lain), cukup arahkan ke Workspace.
  const existing = await findWorkspaceForUser(db, invite.workspaceId, user.id);
  if (existing) return { ok: true, workspace: existing, alreadyMember: true };

  let claimed: boolean;
  try {
    claimed = await claimInvite(db, invite, user.id);
  } catch (err) {
    // Dua undangan berbeda diterima bersamaan oleh user yang sama → unique (workspace_id, user_id).
    if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    const raced = await findWorkspaceForUser(db, invite.workspaceId, user.id);
    if (raced) return { ok: true, workspace: raced, alreadyMember: true };
    throw err;
  }

  if (!claimed) return { ok: false, code: 'INVITE_USED' };

  const workspace = await findWorkspaceForUser(db, invite.workspaceId, user.id);
  return workspace
    ? { ok: true, workspace, alreadyMember: false }
    : { ok: false, code: 'INVITE_NOT_FOUND' };
}

function claimInvite(db: DbClient, invite: InviteRow, userId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Klaim undangan secara atomik: hanya satu request yang bisa mengubah accepted_at dari NULL.
    const [claim] = await tx
      .update(workspaceInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(workspaceInvites.id, invite.id), isNull(workspaceInvites.acceptedAt)));
    if (claim.affectedRows === 0) return false;

    await tx.insert(workspaceMembers).values({
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
    });
    await recordAudit(tx, {
      workspaceId: invite.workspaceId,
      actorUserId: userId,
      entityType: 'member',
      entityId: userId,
      action: 'create',
      metadata: { event: 'joined', role: invite.role },
    });
    return true;
  });
}

export async function listWorkspaceMembers(
  db: DbClient,
  workspaceId: number
): Promise<WorkspaceMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.joinedAt), asc(users.id));

  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
}
