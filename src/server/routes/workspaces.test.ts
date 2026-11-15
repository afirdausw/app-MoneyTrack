import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import {
  categories,
  transactions,
  users,
  wallets,
  workspaceMembers,
  workspaces,
} from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import {
  createSessionForUser,
  createUserWithDefaultWorkspace,
} from '@server/services/auth-service';
import type {
  ApiError,
  ApiSuccess,
  WorkspaceDetail,
  WorkspaceRole,
  WorkspaceSummary,
} from '@shared/types/domain';

const app = createApp({ serveStaticClient: false });

describe('workspace routes tanpa login', () => {
  it('GET /api/workspaces rejects unauthenticated requests', async () => {
    const res = await app.request('/api/workspaces');
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!env.DATABASE_URL)('workspace routes (CRUD + requireWorkspaceRole)', () => {
  const stamp = Date.now();
  const userIds: number[] = [];
  /** Cookie per user uji: owner, admin, member, viewer, outsider. */
  const cookies: Record<'owner' | 'admin' | 'member' | 'viewer' | 'outsider', string> = {
    owner: '',
    admin: '',
    member: '',
    viewer: '',
    outsider: '',
  };
  let ownerPersonalId = 0;

  async function makeUser(label: keyof typeof cookies) {
    const db = getDb()!;
    const created = await createUserWithDefaultWorkspace(db, {
      name: `Uji ${label}`,
      email: `vitest-ws-${label}-${stamp}@example.test`,
      passwordHash: null,
      googleId: `google-ws-${label}-${stamp}`,
    });
    userIds.push(created.user.id);
    cookies[label] = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, created.user.id)}`;
    return created;
  }

  function call(who: keyof typeof cookies, path: string, init: RequestInit = {}) {
    return app.request(path, {
      ...init,
      headers: {
        Cookie: cookies[who],
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  async function createShared(name = 'Kas Kos Melati'): Promise<WorkspaceSummary> {
    const res = await call('owner', '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, type: 'shared', primaryCurrency: 'IDR' }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as ApiSuccess<WorkspaceSummary>).data;
  }

  async function addMember(workspaceId: number, who: keyof typeof cookies, role: WorkspaceRole) {
    const idx = Object.keys(cookies).indexOf(who);
    await getDb()!.insert(workspaceMembers).values({ workspaceId, userId: userIds[idx]!, role });
  }

  beforeAll(async () => {
    const owner = await makeUser('owner');
    ownerPersonalId = owner.workspaces[0]!.id;
    await makeUser('admin');
    await makeUser('member');
    await makeUser('viewer');
    await makeUser('outsider');
  });

  afterAll(async () => {
    const db = getDb();
    if (db && userIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.createdByUserId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await closeDb();
  });

  it('POST creates workspace with owner role and type-specific default categories', async () => {
    const ws = await createShared();
    expect(ws).toMatchObject({ name: 'Kas Kos Melati', type: 'shared', role: 'owner' });

    const cats = await getDb()!
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.workspaceId, ws.id));
    expect(cats.map((c) => c.name)).toContain('Iuran Anggota');
    expect(cats).toHaveLength(8);

    const list = await call('owner', '/api/workspaces');
    const listJson = (await list.json()) as ApiSuccess<WorkspaceSummary[]>;
    expect(listJson.data[0]?.id).toBe(ownerPersonalId);
    expect(listJson.data.map((w) => w.id)).toContain(ws.id);
  });

  it('POST rejects invalid payload with VALIDATION_ERROR', async () => {
    const res = await call('owner', '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', type: 'family', primaryCurrency: 'IDR' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces membership: outsider gets 404, invalid id gets 400', async () => {
    const ws = await createShared('Kas Rahasia');
    const res = await call('outsider', `/api/workspaces/${ws.id}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiError).error.code).toBe('WORKSPACE_NOT_FOUND');

    expect((await call('owner', '/api/workspaces/abc')).status).toBe(400);
  });

  it('enforces role matrix on GET / PATCH / DELETE', async () => {
    const ws = await createShared('Kas Matriks Role');
    await addMember(ws.id, 'admin', 'admin');
    await addMember(ws.id, 'member', 'member');
    await addMember(ws.id, 'viewer', 'viewer');
    const url = `/api/workspaces/${ws.id}`;

    const detail = await call('viewer', url);
    expect(detail.status).toBe(200);
    const detailJson = (await detail.json()) as ApiSuccess<WorkspaceDetail>;
    expect(detailJson.data).toMatchObject({ role: 'viewer', memberCount: 4, categoryCount: 8 });

    const patchBody = { method: 'PATCH', body: JSON.stringify({ name: 'Kas Diubah' }) };
    expect((await call('viewer', url, patchBody)).status).toBe(403);
    expect((await call('member', url, patchBody)).status).toBe(403);

    const adminPatch = await call('admin', url, patchBody);
    expect(adminPatch.status).toBe(200);
    expect(((await adminPatch.json()) as ApiSuccess<WorkspaceSummary>).data.name).toBe('Kas Diubah');

    expect((await call('admin', url, { method: 'DELETE' })).status).toBe(403);
    expect((await call('owner', url, { method: 'DELETE' })).status).toBe(200);
    expect((await call('owner', url)).status).toBe(404);
  });

  it('locks primaryCurrency once the workspace has transactions', async () => {
    const db = getDb()!;
    const ws = await createShared('Kas Bertransaksi');
    const url = `/api/workspaces/${ws.id}`;
    const ownerId = userIds[0]!;

    const [walletRes] = await db.insert(wallets).values({ ownerUserId: ownerId, name: 'Dompet Uji' });
    await db.insert(transactions).values({
      workspaceId: ws.id,
      walletId: Number(walletRes.insertId),
      createdByUserId: ownerId,
      type: 'expense',
      amountMinor: 25000,
      convertedAmountMinor: 25000,
      title: 'Galon',
    });

    const res = await call('owner', url, {
      method: 'PATCH',
      body: JSON.stringify({ primaryCurrency: 'USD' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiError).error.code).toBe('CURRENCY_LOCKED');

    const sameCurrency = await call('owner', url, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Kas Tetap IDR', primaryCurrency: 'IDR' }),
    });
    expect(sameCurrency.status).toBe(200);
  });

  it('refuses to delete the last remaining workspace', async () => {
    const res = await call('outsider', `/api/workspaces/${(await myFirstWorkspace('outsider')).id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiError).error.code).toBe('LAST_WORKSPACE');
  });

  it('customizes icon & color of workspaces, wallets and categories', async () => {
    const ws = await createShared('Kas Kustom');
    expect(ws).toMatchObject({ icon: null, color: null });

    // Workspace: simpan, tolak ikon/warna tak valid, lalu kembalikan ke bawaan dengan null.
    const patched = await call('owner', `/api/workspaces/${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ icon: 'home', color: '#ec4899' }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as ApiSuccess<WorkspaceSummary>).data).toMatchObject({
      icon: 'home',
      color: '#ec4899',
    });
    const listed = ((await (await call('owner', '/api/workspaces')).json()) as ApiSuccess<WorkspaceSummary[]>).data;
    expect(listed.find((w) => w.id === ws.id)).toMatchObject({ icon: 'home', color: '#ec4899' });

    for (const bad of [{ icon: 'not-an-icon' }, { color: 'pink' }]) {
      const res = await call('owner', `/api/workspaces/${ws.id}`, { method: 'PATCH', body: JSON.stringify(bad) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe('VALIDATION_ERROR');
    }

    const reset = await call('owner', `/api/workspaces/${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ icon: null, color: null }),
    });
    expect(((await reset.json()) as ApiSuccess<WorkspaceSummary>).data).toMatchObject({ icon: null, color: null });

    // Dompet: ikon/warna saat dibuat, lalu diubah pemilik lewat /api/wallets/:id.
    const created = await call('owner', `/api/workspaces/${ws.id}/wallets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Dompet Kustom',
        kind: 'ewallet',
        currency: 'IDR',
        visibilityMode: 'workspace_only',
        icon: 'coins',
        color: '#eab308',
      }),
    });
    expect(created.status).toBe(201);
    const walletRow = (
      await getDb()!.select().from(wallets).where(eq(wallets.name, 'Dompet Kustom')).limit(1)
    )[0]!;
    expect(walletRow).toMatchObject({ icon: 'coins', color: '#eab308' });
    const walletPatch = await call('owner', `/api/wallets/${walletRow.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ icon: 'piggy-bank', color: null }),
    });
    expect(walletPatch.status).toBe(200);
    const walletsJson = (await (await call('owner', `/api/workspaces/${ws.id}/wallets`)).json()) as ApiSuccess<
      Array<{ id: number; icon: string | null; color: string | null }>
    >;
    expect(walletsJson.data.find((w) => w.id === walletRow.id)).toMatchObject({ icon: 'piggy-bank', color: null });

    // Kategori: ikon ikut tersimpan saat dibuat & diubah.
    const cat = await call('owner', `/api/workspaces/${ws.id}/categories`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Ngopi', type: 'expense', color: '#f97316', icon: 'coffee' }),
    });
    expect(cat.status).toBe(201);
    const catId = ((await cat.json()) as ApiSuccess<{ id: number; icon: string }>).data;
    expect(catId.icon).toBe('coffee');
    const catPatch = await call('owner', `/api/workspaces/${ws.id}/categories/${catId.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ icon: 'utensils' }),
    });
    expect(catPatch.status).toBe(200);
    const catRow = (await getDb()!.select().from(categories).where(eq(categories.id, catId.id)).limit(1))[0]!;
    expect(catRow.icon).toBe('utensils');
  });

  async function myFirstWorkspace(who: keyof typeof cookies): Promise<WorkspaceSummary> {
    const res = await call(who, '/api/workspaces');
    return ((await res.json()) as ApiSuccess<WorkspaceSummary[]>).data[0]!;
  }
});
