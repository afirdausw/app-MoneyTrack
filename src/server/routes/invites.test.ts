import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { users, workspaceInvites, workspaceMembers, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME, hashInviteToken } from '@server/lib/security';
import {
  createSessionForUser,
  createUserWithDefaultWorkspace,
} from '@server/services/auth-service';
import type {
  ApiError,
  ApiSuccess,
  AcceptInvitePayload,
  CreatedWorkspaceInvite,
  InvitePreview,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from '@shared/types/domain';
import { canInviteWithRole } from '@shared/utils/permissions';
import { createInviteSchema } from '@shared/validation/invite';

const app = createApp({ serveStaticClient: false });

/** Respons JSON yang dibaca test: `data` saat sukses, `error` saat gagal. */
type Json<T> = { ok: boolean; data: T; error: ApiError['error'] };

describe('invite rules (tanpa DB)', () => {
  it('only owner can invite admins; nobody can invite owners', () => {
    expect(canInviteWithRole('owner', 'admin')).toBe(true);
    expect(canInviteWithRole('admin', 'admin')).toBe(false);
    expect(canInviteWithRole('admin', 'member')).toBe(true);
    expect(canInviteWithRole('member', 'viewer')).toBe(false);
    expect(canInviteWithRole('owner', 'owner')).toBe(false);
  });

  it('normalizes optional email and expiry', () => {
    const parsed = createInviteSchema.parse({ role: 'member', email: '  Teman@Mail.COM ' });
    expect(parsed).toEqual({ role: 'member', email: 'teman@mail.com', expiresInDays: 7 });
    expect(createInviteSchema.parse({ role: 'viewer', email: '' }).email).toBeUndefined();
    expect(createInviteSchema.safeParse({ role: 'viewer', expiresInDays: 3 }).success).toBe(false);
    expect(createInviteSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('rejects malformed tokens without touching the DB', async () => {
    expect((await app.request('/api/invites/bukan-token')).status).toBe(404);
  });
});

type Who = 'owner' | 'admin' | 'member' | 'guest' | 'guest2';

describe.skipIf(!env.DATABASE_URL)('invite routes', () => {
  const stamp = Date.now();
  const ids = {} as Record<Who, number>;
  const emails = {} as Record<Who, string>;
  const cookies = {} as Record<Who, string>;
  let wsId = 0;

  function call(who: Who | null, path: string, init: RequestInit = {}) {
    return app.request(path, {
      ...init,
      headers: {
        ...(who ? { Cookie: cookies[who] } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  async function invite(who: Who, body: Record<string, unknown>) {
    const res = await call(who, `/api/workspaces/${wsId}/invites`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Json<CreatedWorkspaceInvite> };
  }

  function tokenOf(created: CreatedWorkspaceInvite): string {
    return created.inviteUrl.split('/invite/')[1]!;
  }

  async function accept(who: Who, token: string) {
    const res = await call(who, `/api/invites/${token}/accept`, { method: 'POST' });
    return { res, json: (await res.json()) as Json<AcceptInvitePayload> };
  }

  beforeAll(async () => {
    const db = getDb()!;
    for (const who of ['owner', 'admin', 'member', 'guest', 'guest2'] as Who[]) {
      emails[who] = `vitest-inv-${who}-${stamp}@example.test`;
      const created = await createUserWithDefaultWorkspace(db, {
        name: `Uji ${who}`,
        email: emails[who],
        passwordHash: null,
      });
      ids[who] = created.user.id;
      cookies[who] = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, created.user.id)}`;
    }

    const res = await call('owner', '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'Kas Undangan', type: 'shared', primaryCurrency: 'IDR' }),
    });
    wsId = ((await res.json()) as ApiSuccess<WorkspaceSummary>).data.id;

    const extra: Array<[Who, WorkspaceRole]> = [
      ['admin', 'admin'],
      ['member', 'member'],
    ];
    for (const [who, role] of extra) {
      await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: ids[who], role });
    }
  });

  afterAll(async () => {
    const db = getDb();
    const userIds = Object.values(ids);
    if (db && userIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.createdByUserId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await closeDb();
  });

  it('enforces who may create invites and with which role', async () => {
    expect((await invite('member', { role: 'viewer' })).res.status).toBe(403);
    expect((await invite('admin', { role: 'admin' })).res.status).toBe(403);
    expect((await invite('admin', { role: 'member' })).res.status).toBe(201);
    expect((await invite('guest', { role: 'member' })).res.status).toBe(404);
    expect((await invite('owner', { role: 'superuser' })).res.status).toBe(400);
  });

  it('stores only a hash of the token and builds an APP_URL link', async () => {
    const { json } = await invite('owner', { role: 'admin', expiresInDays: 1 });
    const token = tokenOf(json.data);
    expect(json.data.inviteUrl.startsWith(`${env.APP_URL.replace(/\/+$/, '')}/invite/`)).toBe(true);
    expect(token).toMatch(/^[a-f0-9]{48}$/);

    const rows = await getDb()!
      .select({ token: workspaceInvites.token })
      .from(workspaceInvites)
      .where(eq(workspaceInvites.id, json.data.id));
    expect(rows[0]?.token).toBe(hashInviteToken(token));
    expect(rows[0]?.token).not.toBe(token);
  });

  it('previews publicly, accepts once, then reports used', async () => {
    const { json } = await invite('owner', { role: 'viewer' });
    const token = tokenOf(json.data);

    const preview = await call(null, `/api/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as ApiSuccess<InvitePreview>).data).toMatchObject({
      workspaceName: 'Kas Undangan',
      role: 'viewer',
      invitedByName: 'Uji owner',
      status: 'pending',
    });

    expect((await call(null, `/api/invites/${token}/accept`, { method: 'POST' })).status).toBe(401);

    const first = await accept('guest', token);
    expect(first.res.status).toBe(200);
    expect(first.json.data).toMatchObject({ workspace: { id: wsId, role: 'viewer' }, alreadyMember: false });

    const again = await accept('guest2', token);
    expect(again.res.status).toBe(410);
    expect(again.json.error.code).toBe('INVITE_USED');

    const usedPreview = (await (await call(null, `/api/invites/${token}`)).json()) as ApiSuccess<InvitePreview>;
    expect(usedPreview.data.status).toBe('used');

    const members = await call('guest', `/api/workspaces/${wsId}/members`);
    const list = ((await members.json()) as ApiSuccess<WorkspaceMember[]>).data;
    expect(list.map((m) => m.role)).toEqual(['owner', 'admin', 'member', 'viewer']);
  });

  it('leaves invite unused for existing members; rejects wrong email and expired', async () => {
    const forMember = tokenOf((await invite('owner', { role: 'viewer' })).json.data);
    const dup = await accept('member', forMember);
    expect(dup.res.status).toBe(200);
    expect(dup.json.data).toMatchObject({ workspace: { id: wsId, role: 'member' }, alreadyMember: true });
    const stillPending = (await (await call(null, `/api/invites/${forMember}`)).json()) as ApiSuccess<InvitePreview>;
    expect(stillPending.data.status).toBe('pending');

    const emailBound = tokenOf(
      (await invite('owner', { role: 'member', email: emails.guest2.toUpperCase() })).json.data
    );
    const wrong = await accept('admin', emailBound);
    expect(wrong.json.error.code).toBe('INVITE_EMAIL_MISMATCH');
    expect((await accept('guest2', emailBound)).res.status).toBe(200);

    const expiring = (await invite('owner', { role: 'viewer' })).json.data;
    await getDb()!
      .update(workspaceInvites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(workspaceInvites.id, expiring.id));
    const expired = await accept('admin', tokenOf(expiring));
    expect(expired.res.status).toBe(410);
    expect(expired.json.error.code).toBe('INVITE_EXPIRED');
  });

  it('lists pending invites for admins only and allows revoking', async () => {
    const created = (await invite('owner', { role: 'member' })).json.data;

    expect((await call('member', `/api/workspaces/${wsId}/invites`)).status).toBe(403);

    const listRes = await call('admin', `/api/workspaces/${wsId}/invites`);
    const pending = ((await listRes.json()) as ApiSuccess<WorkspaceInvite[]>).data;
    expect(pending.map((i) => i.id)).toContain(created.id);
    expect(JSON.stringify(pending)).not.toContain(tokenOf(created));

    const revoke = await call('admin', `/api/workspaces/${wsId}/invites/${created.id}`, {
      method: 'DELETE',
    });
    expect(revoke.status).toBe(200);
    expect((await accept('admin', tokenOf(created))).res.status).toBe(404);
    expect(
      (await call('admin', `/api/workspaces/${wsId}/invites/${created.id}`, { method: 'DELETE' }))
        .status
    ).toBe(404);
  });
});
