import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { auditLogs, users, workspaceMembers, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import { createSessionForUser, createUserWithDefaultWorkspace } from '@server/services/auth-service';
import type {
  ApiError,
  ClientItem,
  InvoiceItem,
  ProjectItem,
  TransactionDetail,
  TransactionPage,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';
import { toDateKey } from '@shared/utils/schedule';

const app = createApp({ serveStaticClient: false });

type Json<T> = { ok: boolean; data: T; error: ApiError['error'] };
type Who = 'owner' | 'member';

describe.skipIf(!env.DATABASE_URL)('business routes (klien, project, invoice)', () => {
  const stamp = Date.now();
  const ids = {} as Record<Who, number>;
  const cookies = {} as Record<Who, string>;
  let ws = 0;
  let wallet = 0;
  let usdWallet = 0;

  async function send<T>(who: Who, method: string, url: string, body?: unknown) {
    const res = await app.request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Cookie: cookies[who], ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    });
    return { status: res.status, body: (await res.json()) as Json<T> };
  }
  const base = () => `/api/workspaces/${ws}`;
  const today = toDateKey(new Date());

  beforeAll(async () => {
    const db = getDb()!;
    for (const who of ['owner', 'member'] as Who[]) {
      const created = await createUserWithDefaultWorkspace(db, {
        name: `Uji ${who}`,
        email: `vitest-biz-${who}-${stamp}@example.test`,
        passwordHash: null,
      });
      ids[who] = created.user.id;
      cookies[who] = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, created.user.id)}`;
    }
    ws = (await send<WorkspaceSummary>('owner', 'POST', '/api/workspaces', { name: 'Studio Uji', type: 'business', primaryCurrency: 'IDR' }))
      .body.data.id;
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: ids.member, role: 'member' });
    wallet = (
      await send<WorkspaceWallet>('owner', 'POST', `${base()}/wallets`, {
        name: 'Rekening Usaha',
        kind: 'bank',
        currency: 'IDR',
        visibilityMode: 'workspace_only',
      })
    ).body.data.id;
    usdWallet = (
      await send<WorkspaceWallet>('owner', 'POST', `${base()}/wallets`, {
        name: 'PayPal',
        kind: 'ewallet',
        currency: 'USD',
        visibilityMode: 'workspace_only',
      })
    ).body.data.id;
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

  it('tracks invoice payments via linked income and computes project & client profit', async () => {
    const client = await send<ClientItem>('owner', 'POST', `${base()}/clients`, {
      name: 'PT Maju Jaya',
      email: 'Finance@MajuJaya.test',
      company: 'PT Maju Jaya',
    });
    expect(client.status).toBe(201);
    expect(client.body.data.email).toBe('finance@majujaya.test');
    expect((await send('member', 'POST', `${base()}/clients`, { name: 'Coba' })).status).toBe(403);

    const project = await send<ProjectItem>('owner', 'POST', `${base()}/projects`, {
      name: 'Website Company Profile',
      clientId: client.body.data.id,
      budgetMinor: 2_000_000,
    });
    expect(project.status).toBe(201);
    const projectId = project.body.data.id;

    const invoice = await send<InvoiceItem>('owner', 'POST', `${base()}/invoices`, {
      title: 'DP 50% Website',
      amountMinor: 5_000_000,
      clientId: client.body.data.id,
      projectId,
      issuedAt: today,
      dueDate: today,
      status: 'sent',
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.number).toBe(`INV-${today.slice(0, 7).replace('-', '')}-001`);
    expect(invoice.body.data.status).toBe('sent');
    const invoiceId = invoice.body.data.id;

    // Pembayaran sebagian oleh member (mencatat transaksi). Project diwarisi dari invoice.
    const pay1 = await send<TransactionDetail>('member', 'POST', `${base()}/transactions`, {
      type: 'income',
      walletId: wallet,
      amountMinor: 2_000_000,
      title: 'Pembayaran DP',
      invoiceId,
    });
    expect(pay1.status).toBe(201);
    expect(pay1.body.data).toMatchObject({ project: { id: projectId }, invoice: { id: invoiceId } });

    let inv = (await send<InvoiceItem[]>('owner', 'GET', `${base()}/invoices`)).body.data.find((i) => i.id === invoiceId)!;
    expect(inv).toMatchObject({ paidMinor: 2_000_000, status: 'partial', paymentCount: 1 });

    // Pelunasan dari dompet USD (dikonversi ke IDR) → lunas.
    const pay2 = await send<TransactionDetail>('owner', 'POST', `${base()}/transactions`, {
      type: 'income',
      walletId: usdWallet,
      amountMinor: 20_000, // $200
      exchangeRate: '15000',
      title: 'Pelunasan',
      invoiceId,
    });
    expect(pay2.status).toBe(201);
    inv = (await send<InvoiceItem[]>('owner', 'GET', `${base()}/invoices`)).body.data.find((i) => i.id === invoiceId)!;
    expect(inv).toMatchObject({ paidMinor: 5_000_000, status: 'paid' });

    // Hapus pembayaran → kembali sebagian.
    expect((await send('owner', 'DELETE', `${base()}/transactions/${pay2.body.data.id}`)).status).toBe(200);
    inv = (await send<InvoiceItem[]>('owner', 'GET', `${base()}/invoices`)).body.data.find((i) => i.id === invoiceId)!;
    expect(inv).toMatchObject({ paidMinor: 2_000_000, status: 'partial' });

    // Edit pembayaran ke nominal penuh → lunas.
    await send('member', 'PATCH', `${base()}/transactions/${pay1.body.data.id}`, {
      type: 'income',
      walletId: wallet,
      amountMinor: 5_000_000,
      title: 'Pembayaran penuh',
      invoiceId,
    });
    inv = (await send<InvoiceItem[]>('owner', 'GET', `${base()}/invoices`)).body.data.find((i) => i.id === invoiceId)!;
    expect(inv.status).toBe('paid');

    // Biaya project.
    await send('owner', 'POST', `${base()}/transactions`, {
      type: 'expense',
      walletId: wallet,
      amountMinor: 750_000,
      title: 'Hosting & domain',
      projectId,
    });

    const projects = (await send<ProjectItem[]>('member', 'GET', `${base()}/projects`)).body.data;
    expect(projects.find((p) => p.id === projectId)).toMatchObject({
      incomeMinor: 5_000_000,
      expenseMinor: 750_000,
      profitMinor: 4_250_000,
      client: { name: 'PT Maju Jaya' },
    });

    const clients = (await send<ClientItem[]>('member', 'GET', `${base()}/clients`)).body.data;
    expect(clients.find((c) => c.id === client.body.data.id)).toMatchObject({
      projectCount: 1,
      invoicedMinor: 5_000_000,
      paidMinor: 5_000_000,
      outstandingMinor: 0,
      profitMinor: 4_250_000,
    });

    const list = (await send<TransactionPage>('owner', 'GET', `${base()}/transactions`)).body.data;
    expect(list.items.find((t) => t.title === 'Hosting & domain')?.project?.name).toBe('Website Company Profile');
  });

  it('validates links, numbers and roles', async () => {
    const foreign = await send('owner', 'POST', `${base()}/transactions`, {
      type: 'income',
      walletId: wallet,
      amountMinor: 1,
      title: 'x',
      invoiceId: 999_999_999,
    });
    expect(foreign.body.error.code).toBe('INVOICE_NOT_FOUND');
    expect(
      (await send('owner', 'POST', `${base()}/transactions`, { type: 'expense', walletId: wallet, amountMinor: 1, title: 'x', projectId: 999_999_999 }))
        .body.error.code
    ).toBe('PROJECT_NOT_FOUND');

    const custom = await send<InvoiceItem>('owner', 'POST', `${base()}/invoices`, {
      number: 'MJ-2026-01',
      title: 'Maintenance',
      amountMinor: 500_000,
      issuedAt: today,
    });
    expect(custom.body.data).toMatchObject({ number: 'MJ-2026-01', status: 'draft' });
    const dup = await send('owner', 'POST', `${base()}/invoices`, { number: 'MJ-2026-01', title: 'Lagi', amountMinor: 1, issuedAt: today });
    expect(dup.body.error.code).toBe('INVOICE_NUMBER_TAKEN');
    expect((await send('member', 'DELETE', `${base()}/invoices/${custom.body.data.id}`)).status).toBe(403);

    // Hapus invoice yang sudah dibayar: transaksi pembayaran tetap ada, hanya dilepas.
    const pay = await send<TransactionDetail>('owner', 'POST', `${base()}/transactions`, {
      type: 'income',
      walletId: wallet,
      amountMinor: 500_000,
      title: 'Bayar maintenance',
      invoiceId: custom.body.data.id,
    });
    expect((await send('owner', 'DELETE', `${base()}/invoices/${custom.body.data.id}`)).status).toBe(200);
    const after = await send<TransactionDetail>('owner', 'GET', `${base()}/transactions/${pay.body.data.id}`);
    expect(after.body.data.invoice).toBeNull();

    // Mata uang utama terkunci setelah ada data bisnis.
    expect((await send('owner', 'PATCH', base(), { primaryCurrency: 'USD' })).body.error.code).toBe('CURRENCY_LOCKED');
  });
});
