import { inflateRawSync } from 'node:zlib';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { auditLogs, users, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import { buildCsv } from '@server/lib/xlsx';
import { createSessionForUser, createUserWithDefaultWorkspace } from '@server/services/auth-service';
import type { ApiError, CategoryItem, ReportSummary, TrendPoint, WorkspaceWallet } from '@shared/types/domain';
import { toDateKey } from '@shared/utils/schedule';

const app = createApp({ serveStaticClient: false });

/** Bongkar ZIP (XLSX) memakai central directory → map nama file → isi teks. */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(ptr + 10);
    const compressed = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(start, start + compressed);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

describe('csv builder', () => {
  it('escapes quotes/commas and neutralizes spreadsheet formulas', () => {
    const csv = buildCsv([{ header: 'Keterangan' }, { header: 'Nominal' }], [
      ['Makan, "enak"', 25000],
      ['=HYPERLINK("http://x")', -5],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Makan, ""enak"""');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(',-5');
  });
});

describe.skipIf(!env.DATABASE_URL)('report routes', () => {
  const stamp = Date.now();
  let userId = 0;
  let cookie = '';
  let ws = 0;
  const now = new Date();
  const thisMonth = toDateKey(now).slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
  const firstOfThisMonth = `${thisMonth}-01`;
  const today = toDateKey(now);

  async function send<T>(method: string, url: string, body?: unknown) {
    const res = await app.request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    });
    return res;
  }
  const json = async <T>(res: Response) => (await res.json()) as { ok: boolean; data: T; error: ApiError['error'] };

  beforeAll(async () => {
    const db = getDb()!;
    const created = await createUserWithDefaultWorkspace(db, {
      name: 'Uji Laporan',
      email: `vitest-report-${stamp}@example.test`,
      passwordHash: null,
    });
    userId = created.user.id;
    ws = created.workspaces[0]!.id;
    cookie = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, userId)}`;

    const wallet = (await json<WorkspaceWallet>(
      await send('POST', `/api/workspaces/${ws}/wallets`, {
        name: 'BCA Laporan',
        kind: 'bank',
        currency: 'IDR',
        visibilityMode: 'workspace_only',
      })
    )).data;
    const usd = (await json<WorkspaceWallet>(
      await send('POST', `/api/workspaces/${ws}/wallets`, {
        name: 'Wise',
        kind: 'ewallet',
        currency: 'USD',
        visibilityMode: 'workspace_only',
      })
    )).data;
    const cats = (await json<CategoryItem[]>(await send('GET', `/api/workspaces/${ws}/categories`))).data;
    const food = cats.find((c) => c.name === 'Makanan & Minuman')!;
    const salary = cats.find((c) => c.type === 'income')!;

    const tx = (body: Record<string, unknown>) => send('POST', `/api/workspaces/${ws}/transactions`, body);
    await tx({ type: 'income', walletId: wallet.id, categoryId: salary.id, amountMinor: 10_000_000, title: 'Gaji' });
    await tx({ type: 'expense', walletId: wallet.id, categoryId: food.id, amountMinor: 250_000, title: 'Makan, "enak"' });
    await tx({ type: 'expense', walletId: usd.id, amountMinor: 1250, exchangeRate: '16000', title: 'Hosting' });
    // Bulan lalu.
    await tx({
      type: 'expense',
      walletId: wallet.id,
      categoryId: food.id,
      amountMinor: 100_000,
      title: 'Bulan lalu',
      occurredAt: lastMonthDate.toISOString(),
    });
  });

  afterAll(async () => {
    const db = getDb();
    if (db && userId) {
      await db.delete(workspaces).where(inArray(workspaces.createdByUserId, [userId]));
      await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, [userId]));
      await db.delete(users).where(inArray(users.id, [userId]));
    }
    await closeDb();
  });

  it('summarizes a period by category and wallet (converted to workspace currency)', async () => {
    const res = await send('GET', `/api/workspaces/${ws}/reports/summary?from=${firstOfThisMonth}&to=${today}`);
    const summary = (await json<ReportSummary>(res)).data;
    expect(summary).toMatchObject({
      incomeMinor: 10_000_000,
      expenseMinor: 250_000 + 200_000, // $12.50 × 16.000 = Rp200.000
      netMinor: 10_000_000 - 450_000,
      transactionCount: 3,
    });
    expect(summary.categories.find((c) => c.name === 'Makanan & Minuman')).toMatchObject({ totalMinor: 250_000, count: 1 });
    expect(summary.categories.find((c) => c.name === 'Tanpa kategori')?.totalMinor).toBe(200_000);
    expect(summary.wallets.map((w) => w.name)).toEqual(['BCA Laporan', 'Wise']);

    const bad = await send('GET', `/api/workspaces/${ws}/reports/summary?from=2026-01-01&to=2027-06-01`);
    expect((await json(bad)).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a monthly trend including empty months', async () => {
    const res = await send('GET', `/api/workspaces/${ws}/reports/trend?end=${thisMonth}&months=3`);
    const trend = (await json<TrendPoint[]>(res)).data;
    expect(trend).toHaveLength(3);
    expect(trend[2]).toMatchObject({ month: thisMonth, incomeMinor: 10_000_000, expenseMinor: 450_000 });
    expect(trend[1]!.expenseMinor).toBe(100_000);
    expect(trend[0]).toMatchObject({ incomeMinor: 0, expenseMinor: 0 });
  });

  it('exports a valid XLSX with transactions and a category summary', async () => {
    const res = await send('GET', `/api/workspaces/${ws}/reports/export?from=${firstOfThisMonth}&to=${today}&format=xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="moneytrack-keuangan-pribadi-.*\.xlsx"/);
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const files = unzip(Buffer.from(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
    );
    expect(files.get('xl/workbook.xml')).toContain('name="Ringkasan Kategori"');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('Makan, &quot;enak&quot;');
    expect(sheet).toContain('<v>-250000</v>'); // pengeluaran negatif
    expect(sheet).toContain('<v>-12.5</v>'); // nominal asli USD
    expect(sheet).toContain('<v>-200000</v>'); // dikonversi ke IDR
    expect(sheet).not.toContain('Bulan lalu');
  });

  it('searches transactions by keyword and converted amount range', async () => {
    const search = async (params: string) =>
      (await json<{ items: Array<{ title: string }> }>(await send('GET', `/api/workspaces/${ws}/transactions?${params}`))).data.items.map(
        (t) => t.title
      );
    expect(await search('q=enak')).toEqual(['Makan, "enak"']);
    expect(await search('q=GAJI')).toEqual(['Gaji']); // tidak peka huruf besar/kecil
    // "%" dicari apa adanya, bukan wildcard yang mencocokkan semua.
    expect(await search('q=%25')).toEqual([]);
    // Rentang nominal memakai nilai terkonversi: $12.50 = Rp200.000 ikut, Rp250.000 tidak.
    expect((await search('minAmount=150000&maxAmount=220000')).sort()).toEqual(['Hosting']);
    const bad = await send('GET', `/api/workspaces/${ws}/transactions?minAmount=5&maxAmount=1`);
    expect(bad.status).toBe(400);
  });

  it('exports CSV for the same period', async () => {
    const res = await send('GET', `/api/workspaces/${ws}/reports/export?from=${firstOfThisMonth}&to=${today}&format=csv`);
    const text = await res.text();
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(text.split('\r\n')[0]).toContain('Tanggal,Jenis,Keterangan');
    expect(text).toContain('"Makan, ""enak"""');
  });
});
