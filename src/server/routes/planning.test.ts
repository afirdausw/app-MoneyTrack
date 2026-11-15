import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { auditLogs, recurringBills, users, wallets, workspaceMembers, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import { createSessionForUser, createUserWithDefaultWorkspace } from '@server/services/auth-service';
import type {
  ApiError,
  BudgetOverview,
  CategoryItem,
  GoalContribution,
  GoalItem,
  RecurringBillItem,
  TransactionDetail,
  WorkspaceOverview,
  WorkspaceWallet,
} from '@shared/types/domain';
import { advanceDateKey, toDateKey } from '@shared/utils/schedule';

const app = createApp({ serveStaticClient: false });

type Json<T> = { ok: boolean; data: T; error: ApiError['error'] };
type Who = 'owner' | 'member';

function monthKey(date = new Date()): string {
  return toDateKey(date).slice(0, 7);
}

describe.skipIf(!env.DATABASE_URL)('planning routes (kategori, budget, target, tagihan rutin)', () => {
  const stamp = Date.now();
  const ids = {} as Record<Who, number>;
  const cookies = {} as Record<Who, string>;
  let ws = 0;
  let walletId = 0;

  async function json<T>(who: Who, url: string, init: RequestInit = {}) {
    const res = await app.request(url, {
      ...init,
      headers: {
        Cookie: cookies[who],
        ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return { status: res.status, body: (await res.json()) as Json<T> };
  }
  const send = <T>(who: Who, method: string, url: string, body?: unknown) =>
    json<T>(who, url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const base = () => `/api/workspaces/${ws}`;

  beforeAll(async () => {
    const db = getDb()!;
    for (const who of ['owner', 'member'] as Who[]) {
      const created = await createUserWithDefaultWorkspace(db, {
        name: `Uji ${who}`,
        email: `vitest-plan-${who}-${stamp}@example.test`,
        passwordHash: null,
      });
      ids[who] = created.user.id;
      cookies[who] = `${SESSION_COOKIE_NAME}=${await createSessionForUser(db, created.user.id)}`;
      if (who === 'owner') ws = created.workspaces[0]!.id;
    }
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: ids.member, role: 'member' });
    const wallet = await send<WorkspaceWallet>('owner', 'POST', `${base()}/wallets`, {
      name: 'BCA Rencana',
      kind: 'bank',
      currency: 'IDR',
      openingBalanceMinor: 5_000_000,
      visibilityMode: 'workspace_only',
    });
    walletId = wallet.body.data.id;
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

  it('manages custom categories (admin only, unique names per type)', async () => {
    const created = await send<CategoryItem>('owner', 'POST', `${base()}/categories`, {
      name: 'Langganan Digital',
      type: 'expense',
      color: '#8b5cf6',
    });
    expect(created.status).toBe(201);

    const dup = await send('owner', 'POST', `${base()}/categories`, { name: 'langganan digital', type: 'expense' });
    expect(dup.body.error.code).toBe('CATEGORY_EXISTS');
    // Nama sama boleh untuk jenis berbeda.
    expect((await send('owner', 'POST', `${base()}/categories`, { name: 'Langganan Digital', type: 'income' })).status).toBe(201);

    expect((await send('member', 'POST', `${base()}/categories`, { name: 'Coba', type: 'expense' })).status).toBe(403);
    expect((await send('member', 'GET', `${base()}/categories`)).status).toBe(200);

    const renamed = await send('owner', 'PATCH', `${base()}/categories/${created.body.data.id}`, { name: 'Streaming' });
    expect(renamed.status).toBe(200);
    expect((await send('owner', 'DELETE', `${base()}/categories/${created.body.data.id}`)).status).toBe(200);
  });

  it('computes budget usage per category and flags alerts on the overview', async () => {
    const month = monthKey();
    const categories = (await send<CategoryItem[]>('owner', 'GET', `${base()}/categories`)).body.data;
    const food = categories.find((c) => c.name === 'Makanan & Minuman')!;
    const transport = categories.find((c) => c.name === 'Transportasi')!;
    const income = categories.find((c) => c.type === 'income')!;

    expect((await send('owner', 'PUT', `${base()}/budgets`, { month, categoryId: food.id, limitMinor: 100_000 })).status).toBe(200);
    // Upsert: menimpa batas lama.
    await send('owner', 'PUT', `${base()}/budgets`, { month, categoryId: food.id, limitMinor: 200_000 });
    await send('owner', 'PUT', `${base()}/budgets`, { month, categoryId: transport.id, limitMinor: 500_000 });
    const notExpense = await send('owner', 'PUT', `${base()}/budgets`, { month, categoryId: income.id, limitMinor: 1 });
    expect(notExpense.body.error.code).toBe('CATEGORY_NOT_EXPENSE');
    expect((await send('member', 'PUT', `${base()}/budgets`, { month, categoryId: food.id, limitMinor: 1 })).status).toBe(403);

    for (const [categoryId, amountMinor] of [
      [food.id, 120_000],
      [food.id, 50_000],
      [transport.id, 30_000],
      [null, 10_000],
    ] as const) {
      await send('owner', 'POST', `${base()}/transactions`, {
        type: 'expense',
        walletId,
        categoryId,
        amountMinor,
        title: 'Belanja uji',
      });
    }

    const budget = (await send<BudgetOverview>('member', 'GET', `${base()}/budgets?month=${month}`)).body.data;
    expect(budget.items.find((i) => i.categoryId === food.id)).toMatchObject({ limitMinor: 200_000, spentMinor: 170_000 });
    expect(budget).toMatchObject({
      totalLimitMinor: 700_000,
      totalBudgetedSpentMinor: 200_000,
      unbudgetedSpentMinor: 10_000,
    });

    const overview = (await send<WorkspaceOverview>('owner', 'GET', `${base()}/overview?month=${month}`)).body.data;
    expect(overview.budgetAlerts.map((a) => a.categoryId)).toEqual([food.id]);

    // Hapus batas (limitMinor null) lalu salin dari bulan ini ke bulan depan.
    await send('owner', 'PUT', `${base()}/budgets`, { month, categoryId: transport.id, limitMinor: null });
    const next = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
    const copy = await send<{ copied: number }>('owner', 'POST', `${base()}/budgets/copy`, { fromMonth: month, toMonth: next });
    expect(copy.body.data.copied).toBe(1);
    expect((await send<{ copied: number }>('owner', 'POST', `${base()}/budgets/copy`, { fromMonth: month, toMonth: next })).body.data.copied).toBe(0);
  });

  it('tracks goal contributions atomically with history and blocks over-withdrawal', async () => {
    const created = await send<GoalItem>('owner', 'POST', `${base()}/goals`, {
      name: 'Dana Darurat',
      targetMinor: 12_000_000,
      initialMinor: 2_000_000,
      deadline: advanceDateKey(toDateKey(new Date()), 'yearly'),
    });
    expect(created.status).toBe(201);
    const goal = created.body.data;
    expect(goal.currentMinor).toBe(2_000_000);
    expect(goal.monthlyNeededMinor).toBeGreaterThan(0);

    const deposit = await send<GoalItem>('owner', 'POST', `${base()}/goals/${goal.id}/contributions`, {
      amountMinor: 500_000,
      note: 'Gajian',
    });
    expect(deposit.body.data.currentMinor).toBe(2_500_000);

    const tooMuch = await send('owner', 'POST', `${base()}/goals/${goal.id}/contributions`, { amountMinor: -3_000_000 });
    expect(tooMuch.body.error.code).toBe('GOAL_NEGATIVE');
    const withdraw = await send<GoalItem>('owner', 'POST', `${base()}/goals/${goal.id}/contributions`, { amountMinor: -500_000 });
    expect(withdraw.body.data.currentMinor).toBe(2_000_000);

    expect((await send('member', 'POST', `${base()}/goals/${goal.id}/contributions`, { amountMinor: 1 })).status).toBe(403);

    const history = (await send<GoalContribution[]>('member', 'GET', `${base()}/goals/${goal.id}/contributions`)).body.data;
    expect(history.map((h) => h.amountMinor)).toEqual([-500_000, 500_000, 2_000_000]);
    expect(history[1]).toMatchObject({ note: 'Gajian', actorName: 'Uji owner' });

    const noDeadline = await send<GoalItem>('owner', 'PATCH', `${base()}/goals/${goal.id}`, { deadline: null });
    expect(noDeadline.body.data).toMatchObject({ deadline: null, monthlyNeededMinor: null });
    expect((await send('owner', 'DELETE', `${base()}/goals/${goal.id}`)).status).toBe(200);
  });

  it('pays recurring bills in one click: records the transaction and advances the due date atomically', async () => {
    const today = toDateKey(new Date());
    const categories = (await send<CategoryItem[]>('owner', 'GET', `${base()}/categories`)).body.data;
    const bills = categories.find((c) => c.name === 'Tagihan & Utilitas')!;

    const created = await send<RecurringBillItem>('owner', 'POST', `${base()}/recurring`, {
      title: 'Internet Rumah',
      type: 'expense',
      amountMinor: 350_000,
      walletId,
      categoryId: bills.id,
      frequency: 'monthly',
      nextDueDate: today,
    });
    expect(created.status).toBe(201);
    const bill = created.body.data;
    expect(bill).toMatchObject({ dueStatus: 'due_today', currency: 'IDR', wallet: { id: walletId } });
    expect((await send('member', 'POST', `${base()}/recurring`, { ...bill, nextDueDate: today })).status).toBe(403);

    const overview = (await send<WorkspaceOverview>('owner', 'GET', `${base()}/overview?month=${monthKey()}`)).body.data;
    expect(overview.dueBills.map((b) => b.id)).toContain(bill.id);

    // Jenis transaksi harus sama; kegagalan tidak boleh memajukan jatuh tempo.
    const mismatch = await send('member', 'POST', `${base()}/transactions`, {
      type: 'income',
      walletId,
      amountMinor: 350_000,
      title: 'x',
      recurringBillId: bill.id,
    });
    expect(mismatch.body.error.code).toBe('RECURRING_TYPE_MISMATCH');
    const afterMismatch = await getDb()!.select({ d: recurringBills.nextDueDate }).from(recurringBills).where(eq(recurringBills.id, bill.id));
    expect(toDateKey(afterMismatch[0]!.d)).toBe(today);

    // Member boleh membayar (mencatat transaksi), nominal bisa berbeda dari tagihan.
    const paid = await send<TransactionDetail>('member', 'POST', `${base()}/transactions`, {
      type: 'expense',
      walletId,
      categoryId: bills.id,
      amountMinor: 365_000,
      title: 'Internet Rumah',
      recurringBillId: bill.id,
    });
    expect(paid.status).toBe(201);
    const list = (await send<RecurringBillItem[]>('owner', 'GET', `${base()}/recurring`)).body.data;
    const advanced = list.find((b) => b.id === bill.id)!;
    expect(advanced.nextDueDate).toBe(advanceDateKey(today, 'monthly'));
    expect(advanced.dueStatus === 'upcoming' || advanced.dueStatus === 'due_soon').toBe(true);

    const skipped = await send<RecurringBillItem>('owner', 'POST', `${base()}/recurring/${bill.id}/skip`);
    expect(skipped.body.data.nextDueDate).toBe(advanceDateKey(advanceDateKey(today, 'monthly'), 'monthly'));
    expect((await send('member', 'POST', `${base()}/recurring/${bill.id}/skip`)).status).toBe(403);

    const inactive = await send<RecurringBillItem>('owner', 'PATCH', `${base()}/recurring/${bill.id}`, {
      title: 'Internet Rumah',
      type: 'expense',
      amountMinor: 350_000,
      walletId,
      categoryId: bills.id,
      frequency: 'monthly',
      nextDueDate: today,
      isActive: false,
    });
    expect(inactive.body.data.isActive).toBe(false);
    const payInactive = await send('owner', 'POST', `${base()}/transactions`, {
      type: 'expense',
      walletId,
      amountMinor: 1,
      title: 'x',
      recurringBillId: bill.id,
    });
    expect(payInactive.body.error.code).toBe('RECURRING_INACTIVE');

    // Hapus tagihan: transaksi pembayaran lama tetap ada.
    expect((await send('owner', 'DELETE', `${base()}/recurring/${bill.id}`)).status).toBe(200);
    expect((await send('owner', 'GET', `${base()}/transactions/${paid.body.data.id}`)).status).toBe(200);
  });

  it('rejects bills on wallets not linked to the workspace', async () => {
    const db = getDb()!;
    const [foreign] = await db.insert(wallets).values({ ownerUserId: ids.member, name: 'Dompet Lain' });
    const res = await send('owner', 'POST', `${base()}/recurring`, {
      title: 'Listrik',
      amountMinor: 1,
      walletId: Number(foreign.insertId),
      frequency: 'monthly',
      nextDueDate: toDateKey(new Date()),
    });
    expect(res.body.error.code).toBe('WALLET_NOT_LINKED');
  });
});
