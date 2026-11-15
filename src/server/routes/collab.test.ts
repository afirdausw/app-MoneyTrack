import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { auditLogs, users, workspaceMembers, workspaceWallets, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import { createSessionForUser, createUserWithDefaultWorkspace } from '@server/services/auth-service';
import type {
  ApiError,
  AuditLogPage,
  SharedCashSummary,
  SplitItem,
  WorkspaceMember,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';

const app = createApp({ serveStaticClient: false });

type Json<T> = { ok: boolean; data: T; error: ApiError['error'] };
type Who = 'andi' | 'budi' | 'citra' | 'dodi';

describe.skipIf(!env.DATABASE_URL)('collab routes (anggota, split bill, kas bersama, audit log)', () => {
  const stamp = Date.now();
  const ids = {} as Record<Who, number>;
  const cookies = {} as Record<Who, string>;
  const personal = {} as Record<Who, number>;
  let ws = 0;

  async function send<T>(who: Who, method: string, url: string, body?: unknown) {
    const res = await app.request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Cookie: cookies[who], ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    });
    return { status: res.status, body: (await res.json()) as Json<T> };
  }
  const base = () => `/api/workspaces/${ws}`;
  const month = () => new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    const db = getDb()!;
    for (const who of ['andi', 'budi', 'citra', 'dodi'] as Who[]) {
      const created = await createUserWithDefaultWorkspace(db, {
        name: who[0]!.toUpperCase() + who.slice(1),
        email: `vitest-collab-${who}-${stamp}@example.test`,
        passwordHash: null,
      });
      ids[who] = created.user.id;
      personal[who] = created.workspaces[0]!.id;
      cookies[who] = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, created.user.id)}`;
    }
    const shared = await send<WorkspaceSummary>('andi', 'POST', '/api/workspaces', {
      name: 'Kos Melati',
      type: 'shared',
      primaryCurrency: 'IDR',
    });
    ws = shared.body.data.id;
    await db.insert(workspaceMembers).values([
      { workspaceId: ws, userId: ids.budi, role: 'admin' },
      { workspaceId: ws, userId: ids.citra, role: 'member' },
      { workspaceId: ws, userId: ids.dodi, role: 'member' },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    const userIds = Object.values(ids);
    if (db && userIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.createdByUserId, userIds));
      await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await closeDb();
  });

  it('splits bills, suggests pairwise net settlements, and lets only the receiver confirm', async () => {
    // Andi menalangi 90rb untuk bertiga (Andi, Budi, Citra) → Budi & Citra masing-masing 30rb ke Andi.
    const dinner = await send<SplitItem>('citra', 'POST', `${base()}/splits`, {
      title: 'Makan malam',
      totalMinor: 90_000,
      paidByUserId: ids.andi,
      mode: 'equal',
      participants: [{ userId: ids.andi }, { userId: ids.budi }, { userId: ids.citra }],
    });
    expect(dinner.status).toBe(201);
    expect(dinner.body.data.outstandingMinor).toBe(60_000);
    expect(dinner.body.data.participants.find((p) => p.userId === ids.andi)?.isSettled).toBe(true);

    // Budi menalangi galon 10rb, custom: Andi 10rb → arah sebaliknya 10rb.
    const galon = await send<SplitItem>('budi', 'POST', `${base()}/splits`, {
      title: 'Galon',
      totalMinor: 10_000,
      paidByUserId: ids.budi,
      mode: 'custom',
      participants: [{ userId: ids.andi, owedMinor: 10_000 }],
    });
    expect(galon.status).toBe(201);

    // Peserta yang bukan anggota Workspace (ID user yang tidak tergabung).
    const outsider = await send('citra', 'POST', `${base()}/splits`, {
      title: 'Patungan luar',
      totalMinor: 1000,
      paidByUserId: ids.citra,
      mode: 'equal',
      participants: [{ userId: ids.citra }, { userId: 999_999_999 }],
    });
    expect(outsider.body.error.code).toBe('NOT_A_MEMBER');

    const summary = (await send<SharedCashSummary>('dodi', 'GET', `${base()}/shared-cash?month=${month()}`)).body.data;
    const pairs = summary.settlements.map((s) => [s.from.name, s.to.name, s.amountMinor]);
    expect(pairs).toEqual([
      ['Citra', 'Andi', 30_000],
      ['Budi', 'Andi', 20_000],
    ]);
    const andi = summary.members.find((m) => m.userId === ids.andi)!;
    expect(andi).toMatchObject({ splitPaidMinor: 90_000, splitNetMinor: 50_000 });
    expect(summary.settlements.every((s) => s.canSettle === false)).toBe(true); // Dodi bukan penerima/admin

    // Citra (yang berutang) tidak boleh menandai lunas sendiri.
    expect((await send('citra', 'POST', `${base()}/splits/settle`, { fromUserId: ids.citra, toUserId: ids.andi })).status).toBe(403);
    // Arah salah tidak ada yang dilunasi.
    expect(
      (await send('andi', 'POST', `${base()}/splits/settle`, { fromUserId: ids.andi, toUserId: ids.budi })).body.error.code
    ).toBe('NOTHING_TO_SETTLE');

    const settled = await send<{ amountMinor: number }>('andi', 'POST', `${base()}/splits/settle`, {
      fromUserId: ids.budi,
      toUserId: ids.andi,
    });
    expect(settled.body.data.amountMinor).toBe(20_000);

    const after = (await send<SharedCashSummary>('andi', 'GET', `${base()}/shared-cash?month=${month()}`)).body.data;
    expect(after.settlements.map((s) => [s.from.name, s.amountMinor])).toEqual([['Citra', 30_000]]);
    expect(after.settlements[0]!.canSettle).toBe(true);

    // Hanya pembayar atau admin yang bisa menghapus split.
    expect((await send('dodi', 'DELETE', `${base()}/splits/${galon.body.data.id}`)).status).toBe(403);
    expect((await send('budi', 'DELETE', `${base()}/splits/${galon.body.data.id}`)).status).toBe(200);
  });

  it('enforces role-change rules', async () => {
    const url = (who: Who) => `${base()}/members/${ids[who]}`;
    // Admin (Budi) tidak bisa menjadikan orang admin; owner bisa.
    expect((await send('budi', 'PATCH', url('citra'), { role: 'admin' })).status).toBe(403);
    expect((await send('budi', 'PATCH', url('citra'), { role: 'viewer' })).status).toBe(200);
    expect((await send('budi', 'PATCH', url('andi'), { role: 'viewer' })).status).toBe(403);
    expect((await send('budi', 'PATCH', url('budi'), { role: 'member' })).body.error.code).toBe('CANNOT_CHANGE_SELF');
    expect((await send('citra', 'PATCH', url('dodi'), { role: 'viewer' })).status).toBe(403);
    expect((await send('andi', 'PATCH', url('citra'), { role: 'member' })).status).toBe(200);

    const members = (await send<WorkspaceMember[]>('dodi', 'GET', `${base()}/members`)).body.data;
    expect(members.find((m) => m.userId === ids.citra)?.role).toBe('member');
  });

  it('removes members and cleans up their wallet links for privacy', async () => {
    const db = getDb()!;
    // Dodi menautkan dua dompet pribadi: satu dipakai transaksi, satu tidak.
    await db.update(workspaceMembers).set({ role: 'admin' }).where(and(eq(workspaceMembers.workspaceId, ws), eq(workspaceMembers.userId, ids.dodi)));
    const used = await send<WorkspaceWallet>('dodi', 'POST', `${base()}/wallets`, {
      name: 'Dompet Dodi Dipakai',
      kind: 'ewallet',
      currency: 'IDR',
      visibilityMode: 'full_transparent',
    });
    const unused = await send<WorkspaceWallet>('dodi', 'POST', `${base()}/wallets`, {
      name: 'Dompet Dodi Nganggur',
      kind: 'cash',
      currency: 'IDR',
      visibilityMode: 'full_transparent',
    });
    await send('dodi', 'POST', `${base()}/transactions`, {
      type: 'expense',
      walletId: used.body.data.id,
      amountMinor: 5_000,
      title: 'Sabun',
    });

    // Dodi keluar sendiri.
    expect((await send('dodi', 'DELETE', `${base()}/members/${ids.dodi}`)).status).toBe(200);
    expect((await send('dodi', 'GET', base())).status).toBe(404);

    const links = await db
      .select({ walletId: workspaceWallets.walletId, mode: workspaceWallets.visibilityMode })
      .from(workspaceWallets)
      .where(eq(workspaceWallets.workspaceId, ws));
    expect(links.find((l) => l.walletId === unused.body.data.id)).toBeUndefined();
    expect(links.find((l) => l.walletId === used.body.data.id)?.mode).toBe('workspace_only');

    // Owner tidak bisa keluar; admin tidak bisa mengeluarkan owner; owner bisa mengeluarkan admin.
    expect((await send('andi', 'DELETE', `${base()}/members/${ids.andi}`)).body.error.code).toBe('OWNER_CANNOT_LEAVE');
    expect((await send('budi', 'DELETE', `${base()}/members/${ids.andi}`)).status).toBe(403);
    expect((await send('andi', 'DELETE', `${base()}/members/${ids.budi}`)).status).toBe(200);
  });

  it('lists a readable audit log, filterable and paginated', async () => {
    const all = (await send<AuditLogPage>('citra', 'GET', `${base()}/audit-logs?limit=50`)).body.data;
    // formatMoney memakai spasi tak terputus (U+00A0) setelah "Rp"; samakan untuk perbandingan.
    const summaries = all.items.map((i) => `${i.actor.name}: ${i.summary}`.replace(/ /g, ' '));
    expect(summaries).toEqual(
      expect.arrayContaining([
        'Citra: membuat split bill "Makan malam" Rp 90.000 (ditalangi Andi)',
        'Andi: menandai lunas: Budi → Andi Rp 20.000',
        'Budi: mengubah role Citra: Member → Viewer',
        'Dodi: keluar dari Workspace',
        'Andi: mengeluarkan Budi dari Workspace',
        'Dodi: mencatat pengeluaran "Sabun" Rp 5.000',
      ])
    );

    const onlySplits = (await send<AuditLogPage>('citra', 'GET', `${base()}/audit-logs?entityType=split`)).body.data;
    expect(onlySplits.items.every((i) => i.entityType === 'split')).toBe(true);

    const page1 = (await send<AuditLogPage>('citra', 'GET', `${base()}/audit-logs?limit=2`)).body.data;
    const page2 = (await send<AuditLogPage>('citra', 'GET', `${base()}/audit-logs?limit=2&before=${page1.nextCursor}`))
      .body.data;
    expect(page1.items).toHaveLength(2);
    expect(page2.items[0]!.id).toBeLessThan(page1.items[1]!.id);
  });
});
