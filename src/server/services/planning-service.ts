import { and, asc, desc, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  auditLogs,
  budgets,
  categories,
  goals,
  recurringBills,
  transactions,
  users,
  wallets,
} from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import { monthRange } from '@server/lib/dates';
import type { Actor } from '@server/services/transaction-service';
import type { DbTransaction } from '@server/services/workspace-service';
import { findLinkedWallet } from '@server/services/wallet-service';
import type {
  BudgetItem,
  BudgetOverview,
  CategoryItem,
  CurrencyCode,
  GoalContribution,
  GoalItem,
  RecurringBillItem,
} from '@shared/types/domain';
import { budgetStatus } from '@shared/utils/budget';
import {
  type RecurringFrequency,
  advanceDateKey,
  dateKeyToDate,
  daysBetween,
  dueStatus,
  monthsUntil,
  toDateKey,
} from '@shared/utils/schedule';
import type {
  CreateCategoryInput,
  CreateGoalInput,
  GoalContributionInput,
  RecurringBillInput,
  SetBudgetInput,
  UpdateCategoryInput,
  UpdateGoalInput,
} from '@shared/validation/planning';

export type PlanningErrorCode =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_EXISTS'
  | 'CATEGORY_NOT_EXPENSE'
  | 'GOAL_NOT_FOUND'
  | 'GOAL_NEGATIVE'
  | 'RECURRING_NOT_FOUND'
  | 'RECURRING_INACTIVE'
  | 'WALLET_NOT_LINKED'
  | 'CATEGORY_INVALID';

export type PlanResult<T> = { ok: true; value: T } | { ok: false; code: PlanningErrorCode };

// ---------- Kategori ----------

export async function listCategories(db: DbClient, workspaceId: number): Promise<CategoryItem[]> {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      type: categories.type,
      color: categories.color,
      icon: categories.icon,
    })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))
    .orderBy(asc(categories.type), asc(categories.id));
}

async function nameTaken(
  db: DbClient,
  workspaceId: number,
  type: 'income' | 'expense',
  name: string,
  exceptId?: number
): Promise<boolean> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, workspaceId),
        eq(categories.type, type),
        sql`lower(${categories.name}) = ${name.toLowerCase()}`,
        exceptId ? ne(categories.id, exceptId) : undefined
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function createCategory(
  db: DbClient,
  workspaceId: number,
  input: CreateCategoryInput
): Promise<PlanResult<CategoryItem>> {
  if (await nameTaken(db, workspaceId, input.type, input.name)) return { ok: false, code: 'CATEGORY_EXISTS' };
  const [result] = await db.insert(categories).values({
    workspaceId,
    name: input.name,
    type: input.type,
    color: input.color,
    icon: input.icon,
    isDefault: false,
  });
  return {
    ok: true,
    value: { id: Number(result.insertId), name: input.name, type: input.type, color: input.color, icon: input.icon },
  };
}

async function findCategory(db: DbClient, workspaceId: number, categoryId: number) {
  const rows = await db
    .select({ id: categories.id, type: categories.type, name: categories.name, color: categories.color })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateCategory(
  db: DbClient,
  workspaceId: number,
  categoryId: number,
  input: UpdateCategoryInput
): Promise<PlanResult<true>> {
  const category = await findCategory(db, workspaceId, categoryId);
  if (!category) return { ok: false, code: 'CATEGORY_NOT_FOUND' };
  if (input.name && (await nameTaken(db, workspaceId, category.type, input.name, categoryId))) {
    return { ok: false, code: 'CATEGORY_EXISTS' };
  }
  await db
    .update(categories)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
    })
    .where(eq(categories.id, categoryId));
  return { ok: true, value: true };
}

/** Transaksi lama tetap ada (kategori jadi kosong lewat FK SET NULL); budget kategori ikut terhapus. */
export async function deleteCategory(db: DbClient, workspaceId: number, categoryId: number): Promise<PlanResult<true>> {
  const category = await findCategory(db, workspaceId, categoryId);
  if (!category) return { ok: false, code: 'CATEGORY_NOT_FOUND' };
  await db.delete(categories).where(eq(categories.id, categoryId));
  return { ok: true, value: true };
}

// ---------- Budget ----------

export async function getBudgetOverview(
  db: DbClient,
  workspaceId: number,
  currency: CurrencyCode,
  monthKey: string
): Promise<BudgetOverview> {
  const { from, to } = monthRange(monthKey);
  const [expenseCategories, limits, spending] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, color: categories.color, icon: categories.icon })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.type, 'expense')))
      .orderBy(asc(categories.id)),
    db
      .select({ categoryId: budgets.categoryId, limitMinor: budgets.limitMinor })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, workspaceId), eq(budgets.monthKey, monthKey))),
    db
      .select({
        categoryId: transactions.categoryId,
        total: sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.type, 'expense'),
          gte(transactions.occurredAt, from),
          lt(transactions.occurredAt, to)
        )
      )
      .groupBy(transactions.categoryId),
  ]);

  const limitBy = new Map(limits.map((l) => [l.categoryId, l.limitMinor]));
  const spentBy = new Map(spending.map((s) => [s.categoryId, Number(s.total)]));

  const items: BudgetItem[] = expenseCategories.map((cat) => ({
    categoryId: cat.id,
    name: cat.name,
    color: cat.color,
    icon: cat.icon,
    limitMinor: limitBy.get(cat.id) ?? null,
    spentMinor: spentBy.get(cat.id) ?? 0,
  }));

  const budgeted = items.filter((i) => i.limitMinor !== null);
  const totalSpent = [...spentBy.values()].reduce((a, b) => a + b, 0);
  const budgetedSpent = budgeted.reduce((a, i) => a + i.spentMinor, 0);

  return {
    month: monthKey,
    currency,
    items,
    totalLimitMinor: budgeted.reduce((a, i) => a + (i.limitMinor ?? 0), 0),
    totalBudgetedSpentMinor: budgetedSpent,
    unbudgetedSpentMinor: totalSpent - budgetedSpent,
  };
}

export async function setBudget(db: DbClient, workspaceId: number, input: SetBudgetInput): Promise<PlanResult<true>> {
  const category = await findCategory(db, workspaceId, input.categoryId);
  if (!category) return { ok: false, code: 'CATEGORY_NOT_FOUND' };
  if (category.type !== 'expense') return { ok: false, code: 'CATEGORY_NOT_EXPENSE' };

  const where = and(
    eq(budgets.workspaceId, workspaceId),
    eq(budgets.categoryId, input.categoryId),
    eq(budgets.monthKey, input.month)
  );
  if (input.limitMinor === null) {
    await db.delete(budgets).where(where);
  } else {
    await db
      .insert(budgets)
      .values({ workspaceId, categoryId: input.categoryId, monthKey: input.month, limitMinor: input.limitMinor })
      .onDuplicateKeyUpdate({ set: { limitMinor: input.limitMinor } });
  }
  return { ok: true, value: true };
}

/** Salin batas budget dari bulan lain; kategori yang sudah punya budget di bulan tujuan tidak ditimpa. */
export async function copyBudgets(db: DbClient, workspaceId: number, fromMonth: string, toMonth: string): Promise<number> {
  const source = await db
    .select({ categoryId: budgets.categoryId, limitMinor: budgets.limitMinor })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, workspaceId), eq(budgets.monthKey, fromMonth)));
  const existing = new Set(
    (
      await db
        .select({ categoryId: budgets.categoryId })
        .from(budgets)
        .where(and(eq(budgets.workspaceId, workspaceId), eq(budgets.monthKey, toMonth)))
    ).map((b) => b.categoryId)
  );
  const toInsert = source.filter((s) => !existing.has(s.categoryId));
  if (toInsert.length > 0) {
    await db.insert(budgets).values(toInsert.map((s) => ({ ...s, workspaceId, monthKey: toMonth })));
  }
  return toInsert.length;
}

/** Budget bulan ini yang sudah ≥ ambang peringatan (untuk kartu dashboard). */
export async function budgetAlerts(db: DbClient, workspaceId: number, currency: CurrencyCode, monthKey: string) {
  const overview = await getBudgetOverview(db, workspaceId, currency, monthKey);
  return overview.items
    .filter((i) => ['warning', 'over'].includes(budgetStatus(i.spentMinor, i.limitMinor)))
    .sort((a, b) => b.spentMinor / (b.limitMinor ?? 1) - a.spentMinor / (a.limitMinor ?? 1));
}

// ---------- Target tabungan ----------

function toGoalItem(
  row: typeof goals.$inferSelect,
  currency: CurrencyCode,
  todayKey: string
): GoalItem {
  const deadline = row.deadlineAt ? toDateKey(row.deadlineAt) : null;
  const remaining = row.targetMinor - row.currentMinor;
  return {
    id: row.id,
    name: row.name,
    currency,
    targetMinor: row.targetMinor,
    currentMinor: row.currentMinor,
    deadline,
    monthlyNeededMinor: deadline && remaining > 0 ? Math.ceil(remaining / monthsUntil(todayKey, deadline)) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listGoals(db: DbClient, workspaceId: number, currency: CurrencyCode): Promise<GoalItem[]> {
  const rows = await db.select().from(goals).where(eq(goals.workspaceId, workspaceId)).orderBy(asc(goals.id));
  const today = toDateKey(new Date());
  return rows.map((row) => toGoalItem(row, currency, today));
}

const GOAL_CONTRIBUTION_ENTITY = 'goal_contribution';

async function writeContribution(
  tx: DbTransaction,
  actor: Actor,
  goal: { id: number; name: string },
  amountMinor: number,
  note: string | null
) {
  await tx.insert(auditLogs).values({
    workspaceId: actor.workspace.id,
    actorUserId: actor.userId,
    entityType: GOAL_CONTRIBUTION_ENTITY,
    entityId: goal.id,
    action: 'create',
    metadataJson: JSON.stringify({
      amountMinor,
      note,
      goalName: goal.name,
      currency: actor.workspace.primaryCurrency,
    }),
  });
}

export async function createGoal(db: DbClient, actor: Actor, input: CreateGoalInput): Promise<GoalItem> {
  const id = await db.transaction(async (tx) => {
    const [result] = await tx.insert(goals).values({
      workspaceId: actor.workspace.id,
      name: input.name,
      targetMinor: input.targetMinor,
      currentMinor: input.initialMinor,
      deadlineAt: input.deadline ? dateKeyToDate(input.deadline) : null,
    });
    const goalId = Number(result.insertId);
    if (input.initialMinor > 0) {
      await writeContribution(tx, actor, { id: goalId, name: input.name }, input.initialMinor, 'Saldo awal');
    }
    return goalId;
  });
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return toGoalItem(rows[0]!, actor.workspace.primaryCurrency, toDateKey(new Date()));
}

async function findGoal(db: DbClient, workspaceId: number, goalId: number) {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateGoal(
  db: DbClient,
  actor: Actor,
  goalId: number,
  input: UpdateGoalInput
): Promise<PlanResult<GoalItem>> {
  if (!(await findGoal(db, actor.workspace.id, goalId))) return { ok: false, code: 'GOAL_NOT_FOUND' };
  await db
    .update(goals)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.targetMinor !== undefined ? { targetMinor: input.targetMinor } : {}),
      ...(input.deadline !== undefined ? { deadlineAt: input.deadline ? dateKeyToDate(input.deadline) : null } : {}),
    })
    .where(eq(goals.id, goalId));
  const row = (await findGoal(db, actor.workspace.id, goalId))!;
  return { ok: true, value: toGoalItem(row, actor.workspace.primaryCurrency, toDateKey(new Date())) };
}

export async function deleteGoal(db: DbClient, actor: Actor, goalId: number): Promise<PlanResult<true>> {
  if (!(await findGoal(db, actor.workspace.id, goalId))) return { ok: false, code: 'GOAL_NOT_FOUND' };
  await db.transaction(async (tx) => {
    await tx.delete(goals).where(eq(goals.id, goalId));
    await tx
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, actor.workspace.id),
          eq(auditLogs.entityType, GOAL_CONTRIBUTION_ENTITY),
          eq(auditLogs.entityId, goalId)
        )
      );
  });
  return { ok: true, value: true };
}

/** Setor (+) / tarik (−) dana target secara atomik; saldo target tidak boleh negatif. */
export async function addGoalContribution(
  db: DbClient,
  actor: Actor,
  goalId: number,
  input: GoalContributionInput
): Promise<PlanResult<GoalItem>> {
  const result = await db.transaction(async (tx): Promise<PlanResult<true>> => {
    const rows = await tx
      .select({ currentMinor: goals.currentMinor, name: goals.name })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.workspaceId, actor.workspace.id)))
      .limit(1)
      .for('update');
    const goal = rows[0];
    if (!goal) return { ok: false, code: 'GOAL_NOT_FOUND' };
    if (goal.currentMinor + input.amountMinor < 0) return { ok: false, code: 'GOAL_NEGATIVE' };

    await tx
      .update(goals)
      .set({ currentMinor: sql`${goals.currentMinor} + ${input.amountMinor}` })
      .where(eq(goals.id, goalId));
    await writeContribution(tx, actor, { id: goalId, name: goal.name }, input.amountMinor, input.note);
    return { ok: true, value: true };
  });
  if (!result.ok) return result;

  const row = (await findGoal(db, actor.workspace.id, goalId))!;
  return { ok: true, value: toGoalItem(row, actor.workspace.primaryCurrency, toDateKey(new Date())) };
}

export async function listGoalContributions(
  db: DbClient,
  workspaceId: number,
  goalId: number
): Promise<PlanResult<GoalContribution[]>> {
  if (!(await findGoal(db, workspaceId, goalId))) return { ok: false, code: 'GOAL_NOT_FOUND' };
  const rows = await db
    .select({
      id: auditLogs.id,
      metadataJson: auditLogs.metadataJson,
      actorName: users.name,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.entityType, GOAL_CONTRIBUTION_ENTITY),
        eq(auditLogs.entityId, goalId)
      )
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(50);

  return {
    ok: true,
    value: rows.map((row) => {
      const meta = JSON.parse(row.metadataJson ?? '{}') as { amountMinor?: number; note?: string | null };
      return {
        id: row.id,
        amountMinor: meta.amountMinor ?? 0,
        note: meta.note ?? null,
        actorName: row.actorName,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  };
}

// ---------- Tagihan rutin ----------

const billColumns = {
  id: recurringBills.id,
  title: recurringBills.title,
  type: recurringBills.type,
  amountMinor: recurringBills.amountMinor,
  currency: recurringBills.currencyCode,
  frequency: recurringBills.frequency,
  nextDueDate: recurringBills.nextDueDate,
  isActive: recurringBills.isActive,
  walletId: wallets.id,
  walletName: wallets.name,
  categoryId: categories.id,
  categoryName: categories.name,
  categoryColor: categories.color,
};

function billQuery(db: DbClient) {
  return db
    .select(billColumns)
    .from(recurringBills)
    .leftJoin(wallets, eq(recurringBills.walletId, wallets.id))
    .leftJoin(categories, eq(recurringBills.categoryId, categories.id));
}

type BillRow = Awaited<ReturnType<ReturnType<typeof billQuery>['execute']>>[number];

function toBillItem(row: BillRow, todayKey: string): RecurringBillItem {
  const next = toDateKey(row.nextDueDate);
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    amountMinor: row.amountMinor,
    currency: row.currency as CurrencyCode,
    frequency: row.frequency,
    nextDueDate: next,
    isActive: row.isActive,
    wallet: row.walletId !== null && row.walletName !== null ? { id: row.walletId, name: row.walletName } : null,
    category:
      row.categoryId !== null
        ? { id: row.categoryId, name: row.categoryName ?? '', color: row.categoryColor ?? '#64748b' }
        : null,
    dueStatus: dueStatus(next, todayKey),
    daysUntilDue: daysBetween(todayKey, next),
  };
}

export async function listRecurringBills(db: DbClient, workspaceId: number): Promise<RecurringBillItem[]> {
  const rows = await billQuery(db)
    .where(eq(recurringBills.workspaceId, workspaceId))
    .orderBy(asc(recurringBills.nextDueDate), asc(recurringBills.id));
  const today = toDateKey(new Date());
  return rows.map((row) => toBillItem(row, today));
}

/** Tagihan aktif yang terlambat atau jatuh tempo ≤ 7 hari. */
export async function dueRecurringBills(db: DbClient, workspaceId: number): Promise<RecurringBillItem[]> {
  return (await listRecurringBills(db, workspaceId)).filter((b) => b.isActive && b.dueStatus !== 'upcoming');
}

async function getBill(db: DbClient, workspaceId: number, billId: number): Promise<RecurringBillItem | null> {
  const rows = await billQuery(db)
    .where(and(eq(recurringBills.id, billId), eq(recurringBills.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ? toBillItem(rows[0], toDateKey(new Date())) : null;
}

/** Validasi dompet & kategori tagihan; mata uang mengikuti dompet (atau mata uang Workspace bila tanpa dompet). */
async function resolveBillValues(db: DbClient, actor: Actor, input: RecurringBillInput) {
  let currency: CurrencyCode = actor.workspace.primaryCurrency;
  if (input.walletId) {
    const wallet = await findLinkedWallet(db, actor.workspace.id, input.walletId);
    if (!wallet) return { ok: false as const, code: 'WALLET_NOT_LINKED' as const };
    currency = wallet.currency;
  }
  if (input.categoryId) {
    const category = await findCategory(db, actor.workspace.id, input.categoryId);
    if (!category || category.type !== input.type) return { ok: false as const, code: 'CATEGORY_INVALID' as const };
  }
  return {
    ok: true as const,
    values: {
      title: input.title,
      type: input.type,
      amountMinor: input.amountMinor,
      currencyCode: currency,
      walletId: input.walletId,
      categoryId: input.categoryId,
      frequency: input.frequency,
      nextDueDate: dateKeyToDate(input.nextDueDate),
      isActive: input.isActive,
    },
  };
}

export async function createRecurringBill(
  db: DbClient,
  actor: Actor,
  input: RecurringBillInput
): Promise<PlanResult<RecurringBillItem>> {
  const resolved = await resolveBillValues(db, actor, input);
  if (!resolved.ok) return resolved;
  const [result] = await db.insert(recurringBills).values({ ...resolved.values, workspaceId: actor.workspace.id });
  return { ok: true, value: (await getBill(db, actor.workspace.id, Number(result.insertId)))! };
}

export async function updateRecurringBill(
  db: DbClient,
  actor: Actor,
  billId: number,
  input: RecurringBillInput
): Promise<PlanResult<RecurringBillItem>> {
  if (!(await getBill(db, actor.workspace.id, billId))) return { ok: false, code: 'RECURRING_NOT_FOUND' };
  const resolved = await resolveBillValues(db, actor, input);
  if (!resolved.ok) return resolved;
  await db.update(recurringBills).set(resolved.values).where(eq(recurringBills.id, billId));
  return { ok: true, value: (await getBill(db, actor.workspace.id, billId))! };
}

export async function deleteRecurringBill(db: DbClient, actor: Actor, billId: number): Promise<PlanResult<true>> {
  if (!(await getBill(db, actor.workspace.id, billId))) return { ok: false, code: 'RECURRING_NOT_FOUND' };
  // Transaksi yang pernah dibayar dari tagihan ini tetap ada (recurring_bill_id → NULL lewat FK).
  await db.delete(recurringBills).where(eq(recurringBills.id, billId));
  return { ok: true, value: true };
}

/**
 * Kunci tagihan di dalam DB transaction lalu majukan `next_due_date` satu periode.
 * Dipakai oleh "Lewati" dan oleh pembuatan transaksi Bayar 1-Klik.
 */
export async function advanceBillInTx(
  tx: DbTransaction,
  workspaceId: number,
  billId: number
): Promise<PlanResult<{ type: 'income' | 'expense' }>> {
  const rows = await tx
    .select({
      nextDueDate: recurringBills.nextDueDate,
      frequency: recurringBills.frequency,
      isActive: recurringBills.isActive,
      type: recurringBills.type,
    })
    .from(recurringBills)
    .where(and(eq(recurringBills.id, billId), eq(recurringBills.workspaceId, workspaceId)))
    .limit(1)
    .for('update');
  const bill = rows[0];
  if (!bill) return { ok: false, code: 'RECURRING_NOT_FOUND' };
  if (!bill.isActive) return { ok: false, code: 'RECURRING_INACTIVE' };

  const next = advanceDateKey(toDateKey(bill.nextDueDate), bill.frequency as RecurringFrequency);
  await tx
    .update(recurringBills)
    .set({ nextDueDate: dateKeyToDate(next) })
    .where(eq(recurringBills.id, billId));
  return { ok: true, value: { type: bill.type } };
}

export async function skipRecurringBill(db: DbClient, actor: Actor, billId: number): Promise<PlanResult<RecurringBillItem>> {
  const result = await db.transaction((tx) => advanceBillInTx(tx, actor.workspace.id, billId));
  if (!result.ok) return result;
  return { ok: true, value: (await getBill(db, actor.workspace.id, billId))! };
}

/** true bila Workspace sudah punya data keuangan bernominal (dipakai untuk mengunci mata uang utama). */
export async function workspaceHasPlanningData(db: DbClient, workspaceId: number): Promise<boolean> {
  const checks = await Promise.all([
    db.select({ id: budgets.id }).from(budgets).where(eq(budgets.workspaceId, workspaceId)).limit(1),
    db.select({ id: goals.id }).from(goals).where(eq(goals.workspaceId, workspaceId)).limit(1),
    db
      .select({ id: recurringBills.id })
      .from(recurringBills)
      .where(and(eq(recurringBills.workspaceId, workspaceId), isNull(recurringBills.walletId)))
      .limit(1),
  ]);
  return checks.some((rows) => rows.length > 0);
}
