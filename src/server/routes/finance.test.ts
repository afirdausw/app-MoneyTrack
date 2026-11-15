import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { auditLogs, categories, receipts, users, wallets, workspaceMembers, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import { createSessionForUser, createUserWithDefaultWorkspace } from '@server/services/auth-service';
import type {
  ApiError,
  ReceiptItem,
  TransactionDetail,
  TransactionPage,
  WorkspaceOverview,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';

const app = createApp({ serveStaticClient: false });

type Json<T> = { ok: boolean; data: T; error: ApiError['error'] };
type Who = 'owner' | 'member' | 'viewer' | 'outsider';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

describe.skipIf(!env.DATABASE_URL)('finance routes (dompet, transaksi, struk)', () => {
  const stamp = Date.now();
  const ids = {} as Record<Who, number>;
  const cookies = {} as Record<Who, string>;
  const personalWs = {} as Record<Who, number>;
  let sharedWs = 0;

  function call(who: Who, url: string, init: RequestInit = {}) {
    const isJson = typeof init.body === 'string';
    return app.request(url, {
      ...init,
      headers: { Cookie: cookies[who], ...(isJson ? { 'Content-Type': 'application/json' } : {}) },
    });
  }

  async function json<T>(who: Who, url: string, init: RequestInit = {}) {
    const res = await call(who, url, init);
    return { status: res.status, body: (await res.json()) as Json<T> };
  }

  const post = <T>(who: Who, url: string, body: unknown) =>
    json<T>(who, url, { method: 'POST', body: JSON.stringify(body) });
  const patch = <T>(who: Who, url: string, body: unknown) =>
    json<T>(who, url, { method: 'PATCH', body: JSON.stringify(body) });

  async function createWallet(who: Who, wsId: number, body: Record<string, unknown>) {
    const res = await post<WorkspaceWallet>(who, `/api/workspaces/${wsId}/wallets`, {
      kind: 'bank',
      currency: 'IDR',
      openingBalanceMinor: 0,
      visibilityMode: 'workspace_only',
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  async function balanceOf(walletId: number): Promise<number> {
    const rows = await getDb()!.select({ b: wallets.balanceMinor }).from(wallets).where(eq(wallets.id, walletId));
    return rows[0]!.b;
  }

  async function categoryId(wsId: number, type: 'income' | 'expense'): Promise<number> {
    const rows = await getDb()!
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.workspaceId, wsId), eq(categories.type, type)))
      .limit(1);
    return rows[0]!.id;
  }

  beforeAll(async () => {
    const db = getDb()!;
    for (const who of ['owner', 'member', 'viewer', 'outsider'] as Who[]) {
      const created = await createUserWithDefaultWorkspace(db, {
        name: `Uji ${who}`,
        email: `vitest-fin-${who}-${stamp}@example.test`,
        passwordHash: null,
      });
      ids[who] = created.user.id;
      personalWs[who] = created.workspaces[0]!.id;
      cookies[who] = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, created.user.id)}`;
    }
    const shared = await post<WorkspaceSummary>('owner', '/api/workspaces', {
      name: 'Kas Bersama Uji',
      type: 'shared',
      primaryCurrency: 'IDR',
    });
    sharedWs = shared.body.data.id;
    await db.insert(workspaceMembers).values([
      { workspaceId: sharedWs, userId: ids.member, role: 'member' },
      { workspaceId: sharedWs, userId: ids.viewer, role: 'viewer' },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    const userIds = Object.values(ids);
    if (db && userIds.length > 0) {
      const files = await db
        .select({ p: receipts.storagePath })
        .from(receipts)
        .innerJoin(workspaces, eq(receipts.workspaceId, workspaces.id))
        .where(inArray(workspaces.createdByUserId, userIds));
      await db.delete(workspaces).where(inArray(workspaces.createdByUserId, userIds));
      await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
      for (const f of files) fs.rmSync(path.resolve(env.UPLOAD_DIR, f.p), { force: true });
    }
    await closeDb();
  });

  it('keeps wallet balances in sync on create, edit, transfer and delete', async () => {
    const ws = personalWs.owner;
    const bca = await createWallet('owner', ws, { name: 'BCA Uji', openingBalanceMinor: 100_000 });
    const cash = await createWallet('owner', ws, { name: 'Tunai Uji', kind: 'cash' });
    const expenseCat = await categoryId(ws, 'expense');

    const expense = await post<TransactionDetail>('owner', `/api/workspaces/${ws}/transactions`, {
      type: 'expense',
      walletId: bca.id,
      categoryId: expenseCat,
      amountMinor: 25_000,
      title: 'Makan siang',
    });
    expect(expense.status).toBe(201);
    expect(expense.body.data).toMatchObject({ convertedAmountMinor: 25_000, exchangeRate: '1.000000', canEdit: true });
    expect(await balanceOf(bca.id)).toBe(75_000);

    await post('owner', `/api/workspaces/${ws}/transactions`, {
      type: 'income',
      walletId: bca.id,
      amountMinor: 50_000,
      title: 'Bonus',
    });
    expect(await balanceOf(bca.id)).toBe(125_000);

    const transfer = await post<TransactionDetail>('owner', `/api/workspaces/${ws}/transactions`, {
      type: 'transfer',
      walletId: bca.id,
      transferTargetWalletId: cash.id,
      amountMinor: 20_000,
      title: 'Tarik tunai',
    });
    expect(transfer.body.data.targetWallet?.id).toBe(cash.id);
    expect(await balanceOf(bca.id)).toBe(105_000);
    expect(await balanceOf(cash.id)).toBe(20_000);

    // Edit: pengeluaran 25rb dari BCA → 40rb dari Tunai
    const edited = await patch<TransactionDetail>(
      'owner',
      `/api/workspaces/${ws}/transactions/${expense.body.data.id}`,
      { type: 'expense', walletId: cash.id, categoryId: expenseCat, amountMinor: 40_000, title: 'Makan malam' }
    );
    expect(edited.status).toBe(200);
    expect(await balanceOf(bca.id)).toBe(130_000);
    expect(await balanceOf(cash.id)).toBe(-20_000);

    const del = await call('owner', `/api/workspaces/${ws}/transactions/${transfer.body.data.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    expect(await balanceOf(bca.id)).toBe(150_000);
    expect(await balanceOf(cash.id)).toBe(-40_000);

    const audit = await getDb()!
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ws), eq(auditLogs.entityId, transfer.body.data.id)));
    expect(audit.map((a) => a.action)).toEqual(['create', 'delete']);

    const overview = await json<WorkspaceOverview>(
      'owner',
      `/api/workspaces/${ws}/overview?month=${new Date().toISOString().slice(0, 7)}`
    );
    expect(overview.body.data).toMatchObject({
      incomeMinor: 50_000,
      expenseMinor: 40_000,
      totalBalanceMinor: 110_000,
      walletCount: 2,
    });
  });

  it('handles concurrent writes on the same wallets without deadlocks or lost balance updates', async () => {
    const ws = personalWs.owner;
    const a = await createWallet('owner', ws, { name: 'Paralel A', openingBalanceMinor: 1_000_000 });
    const b = await createWallet('owner', ws, { name: 'Paralel B', openingBalanceMinor: 1_000_000 });
    const url = `/api/workspaces/${ws}/transactions`;

    // 8 pengeluaran sekaligus di dompet yang sama + transfer silang A→B dan B→A bersamaan.
    const results = await Promise.all([
      ...Array.from({ length: 8 }, (_, i) =>
        post<TransactionDetail>('owner', url, { type: 'expense', walletId: a.id, amountMinor: 1_000, title: `Paralel ${i}` })
      ),
      ...Array.from({ length: 3 }, () =>
        post<TransactionDetail>('owner', url, {
          type: 'transfer',
          walletId: a.id,
          transferTargetWalletId: b.id,
          amountMinor: 10_000,
          title: 'A ke B',
        })
      ),
      ...Array.from({ length: 3 }, () =>
        post<TransactionDetail>('owner', url, {
          type: 'transfer',
          walletId: b.id,
          transferTargetWalletId: a.id,
          amountMinor: 5_000,
          title: 'B ke A',
        })
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(201));
    // A: 1.000.000 − 8×1.000 − 3×10.000 + 3×5.000 ; B: 1.000.000 + 3×10.000 − 3×5.000
    expect(await balanceOf(a.id)).toBe(977_000);
    expect(await balanceOf(b.id)).toBe(1_015_000);

    // Edit & hapus paralel juga tetap konsisten.
    const expenses = results.slice(0, 8).map((r) => r.body.data.id);
    const mixed = await Promise.all([
      ...expenses.slice(0, 4).map((id) =>
        patch('owner', `${url}/${id}`, { type: 'expense', walletId: b.id, amountMinor: 2_000, title: 'Pindah ke B' })
      ),
      ...expenses.slice(4).map((id) => call('owner', `${url}/${id}`, { method: 'DELETE' })),
    ]);
    expect(mixed.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await balanceOf(a.id)).toBe(985_000);
    expect(await balanceOf(b.id)).toBe(1_007_000);
  });

  it('validates wallet linkage, categories, currencies and exchange rates', async () => {
    const ws = personalWs.owner;
    const idr = await createWallet('owner', ws, { name: 'Dompet IDR' });
    const usd = await createWallet('owner', ws, { name: 'Wise USD', currency: 'USD' });
    const foreign = await createWallet('outsider', personalWs.outsider, { name: 'Dompet Orang Lain' });
    const incomeCat = await categoryId(ws, 'income');
    const url = `/api/workspaces/${ws}/transactions`;

    const notLinked = await post('owner', url, { type: 'expense', walletId: foreign.id, amountMinor: 1, title: 'x' });
    expect(notLinked.body.error.code).toBe('WALLET_NOT_LINKED');

    const wrongCat = await post('owner', url, {
      type: 'expense',
      walletId: idr.id,
      categoryId: incomeCat,
      amountMinor: 1,
      title: 'x',
    });
    expect(wrongCat.body.error.code).toBe('CATEGORY_INVALID');

    const noRate = await post('owner', url, { type: 'expense', walletId: usd.id, amountMinor: 1250, title: 'Hosting' });
    expect(noRate.body.error.code).toBe('EXCHANGE_RATE_REQUIRED');

    const withRate = await post<TransactionDetail>('owner', url, {
      type: 'expense',
      walletId: usd.id,
      amountMinor: 1250,
      title: 'Hosting',
      exchangeRate: '16250',
    });
    expect(withRate.body.data).toMatchObject({
      currency: 'USD',
      amountMinor: 1250,
      convertedAmountMinor: 203_125,
      exchangeRate: '16250.000000',
    });

    const mismatch = await post('owner', url, {
      type: 'transfer',
      walletId: usd.id,
      transferTargetWalletId: idr.id,
      amountMinor: 100,
      title: 'x',
    });
    expect(mismatch.body.error.code).toBe('TRANSFER_CURRENCY_MISMATCH');
  });

  it('enforces roles: viewer cannot record, member edits only own transactions', async () => {
    const kas = await createWallet('owner', sharedWs, { name: 'Kas Kos', visibilityMode: 'full_transparent' });
    const url = `/api/workspaces/${sharedWs}/transactions`;
    const body = { type: 'expense', walletId: kas.id, amountMinor: 10_000, title: 'Galon' };

    expect((await post('viewer', url, body)).status).toBe(403);
    expect((await post('outsider', url, body)).status).toBe(404);

    const byOwner = await post<TransactionDetail>('owner', url, body);
    const byMember = await post<TransactionDetail>('member', url, { ...body, title: 'Sabun' });
    expect(byMember.status).toBe(201);

    expect((await patch('member', `${url}/${byOwner.body.data.id}`, body)).body.error.code).toBe('FORBIDDEN');
    expect((await patch('member', `${url}/${byMember.body.data.id}`, { ...body, amountMinor: 12_000 })).status).toBe(
      200
    );
    expect((await call('owner', `${url}/${byMember.body.data.id}`, { method: 'DELETE' })).status).toBe(200);

    const list = await json<TransactionPage>('member', url);
    const own = list.body.data.items.find((t) => t.id === byOwner.body.data.id);
    expect(own?.canEdit).toBe(false);

    // Admin Workspace tidak boleh mengubah visibilitas dompet milik orang lain; pemiliknya boleh.
    const memberWallet = await post<WorkspaceWallet>('member', `/api/workspaces/${personalWs.member}/wallets`, {
      name: 'Dompet Member',
      kind: 'ewallet',
      currency: 'IDR',
      visibilityMode: 'workspace_only',
    });
    expect(memberWallet.status).toBe(201);
    expect(
      (await patch('owner', `/api/workspaces/${sharedWs}/wallets/${kas.id}`, { visibilityMode: 'workspace_only' }))
        .status
    ).toBe(200);
    expect(
      (await patch('member', `/api/workspaces/${sharedWs}/wallets/${kas.id}`, { visibilityMode: 'full_transparent' }))
        .status
    ).toBe(403);

    const unlink = await call('owner', `/api/workspaces/${sharedWs}/wallets/${kas.id}`, { method: 'DELETE' });
    expect(unlink.status).toBe(409);
  });

  it('shows other workspaces’ transactions only for full_transparent wallets (read-only)', async () => {
    const personal = personalWs.owner;
    const wallet = await createWallet('owner', personal, { name: 'BCA Tautan' });
    const secret = await post<TransactionDetail>('owner', `/api/workspaces/${personal}/transactions`, {
      type: 'expense',
      walletId: wallet.id,
      amountMinor: 99_000,
      title: 'Belanja pribadi',
    });

    const link = await post('owner', `/api/workspaces/${sharedWs}/wallets/link`, {
      walletId: wallet.id,
      visibilityMode: 'workspace_only',
    });
    expect(link.status).toBe(201);
    expect((await post('owner', `/api/workspaces/${sharedWs}/wallets/link`, { walletId: wallet.id, visibilityMode: 'workspace_only' })).status).toBe(409);

    const hidden = await json<TransactionPage>('member', `/api/workspaces/${sharedWs}/transactions?walletId=${wallet.id}`);
    expect(hidden.body.data.items.map((t) => t.id)).not.toContain(secret.body.data.id);

    await patch('owner', `/api/workspaces/${sharedWs}/wallets/${wallet.id}`, { visibilityMode: 'full_transparent' });
    const visible = await json<TransactionPage>('member', `/api/workspaces/${sharedWs}/transactions?walletId=${wallet.id}`);
    const item = visible.body.data.items.find((t) => t.id === secret.body.data.id);
    expect(item).toMatchObject({ sourceWorkspaceName: 'Keuangan Pribadi', canEdit: false });

    const foreignDetail = await json<TransactionDetail>(
      'member',
      `/api/workspaces/${sharedWs}/transactions/${secret.body.data.id}`
    );
    expect(foreignDetail.body.data).toMatchObject({ canEdit: false, receipts: [], receiptCount: 0 });

    // Tetap tidak bisa diubah dari Workspace lain.
    expect(
      (await patch('owner', `/api/workspaces/${sharedWs}/transactions/${secret.body.data.id}`, {
        type: 'expense',
        walletId: wallet.id,
        amountMinor: 1,
        title: 'x',
      })).status
    ).toBe(404);
  });

  it('paginates with a stable cursor', async () => {
    const ws = personalWs.viewer;
    const w = await createWallet('viewer', ws, { name: 'Dompet Paging' });
    for (let i = 0; i < 5; i++) {
      await post('viewer', `/api/workspaces/${ws}/transactions`, {
        type: 'expense',
        walletId: w.id,
        amountMinor: 1000 + i,
        title: `Tx ${i}`,
        occurredAt: new Date(2026, 0, 10, 12, 0, 0).toISOString(),
      });
    }
    const first = await json<TransactionPage>('viewer', `/api/workspaces/${ws}/transactions?limit=3`);
    expect(first.body.data.items).toHaveLength(3);
    const second = await json<TransactionPage>(
      'viewer',
      `/api/workspaces/${ws}/transactions?limit=3&before=${first.body.data.nextCursor}`
    );
    expect(second.body.data.items).toHaveLength(2);
    expect(second.body.data.nextCursor).toBeNull();
    const allIds = [...first.body.data.items, ...second.body.data.items].map((t) => t.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('stores receipts privately, serves them to members only, and deletes files with the transaction', async () => {
    const ws = personalWs.owner;
    const w = await createWallet('owner', ws, { name: 'Dompet Struk' });
    const tx = await post<TransactionDetail>('owner', `/api/workspaces/${ws}/transactions`, {
      type: 'expense',
      walletId: w.id,
      amountMinor: 15_000,
      title: 'Kopi',
    });
    const txUrl = `/api/workspaces/${ws}/transactions/${tx.body.data.id}`;

    const upload = (bytes: Uint8Array, name: string, type: string) => {
      const form = new FormData();
      form.append('file', new File([bytes], name, { type }));
      return call('owner', `${txUrl}/receipts`, { method: 'POST', body: form });
    };

    // Isi bukan gambar walau diberi nama & type gambar → ditolak.
    const fake = await upload(new TextEncoder().encode('<script>alert(1)</script>'), 'struk.png', 'image/png');
    expect(fake.status).toBe(415);

    const ok = await upload(PNG_BYTES, 'struk.png', 'image/png');
    expect(ok.status).toBe(201);
    const receipt = ((await ok.json()) as Json<ReceiptItem>).data;
    expect(receipt.mimeType).toBe('image/png');

    const stored = await getDb()!
      .select({ p: receipts.storagePath })
      .from(receipts)
      .where(eq(receipts.id, receipt.id));
    const filePath = path.resolve(env.UPLOAD_DIR, stored[0]!.p);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath.includes(`${path.sep}public${path.sep}`)).toBe(false);

    const download = await call('owner', receipt.url);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG_BYTES);

    expect((await call('outsider', receipt.url)).status).toBe(404);
    expect((await call('owner', `/api/workspaces/${sharedWs}/receipts/${receipt.id}`)).status).toBe(404);

    const detail = await json<TransactionDetail>('owner', txUrl);
    expect(detail.body.data.receipts).toHaveLength(1);

    expect((await call('owner', txUrl, { method: 'DELETE' })).status).toBe(200);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
