import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { requireWorkspaceRole } from '@server/middleware/workspace';
import {
  type PlanningErrorCode,
  addGoalContribution,
  copyBudgets,
  createCategory,
  createGoal,
  createRecurringBill,
  deleteCategory,
  deleteGoal,
  deleteRecurringBill,
  getBudgetOverview,
  listCategories,
  listGoalContributions,
  listGoals,
  listRecurringBills,
  setBudget,
  skipRecurringBill,
  updateCategory,
  updateGoal,
  updateRecurringBill,
} from '@server/services/planning-service';
import type { Actor } from '@server/services/transaction-service';
import type {
  BudgetOverview,
  CategoryItem,
  GoalContribution,
  GoalItem,
  RecurringBillItem,
} from '@shared/types/domain';
import { monthKeySchema } from '@shared/validation/finance';
import {
  copyBudgetSchema,
  createCategorySchema,
  createGoalSchema,
  goalContributionSchema,
  recurringBillSchema,
  setBudgetSchema,
  updateCategorySchema,
  updateGoalSchema,
} from '@shared/validation/planning';

/**
 * Kategori, budget, target tabungan & tagihan rutin di bawah `/api/workspaces/:wsId`.
 * Baca: min. viewer. Kelola: min. admin (matriks role di docs/03).
 */
export const planningRoutes = new Hono<AppEnv>();

const ERRORS: Record<PlanningErrorCode, [ContentfulStatusCode, string]> = {
  CATEGORY_NOT_FOUND: [404, 'Kategori tidak ditemukan.'],
  CATEGORY_EXISTS: [409, 'Nama kategori sudah dipakai untuk jenis yang sama.'],
  CATEGORY_NOT_EXPENSE: [400, 'Budget hanya untuk kategori pengeluaran.'],
  CATEGORY_INVALID: [400, 'Kategori tidak cocok dengan jenis tagihan.'],
  GOAL_NOT_FOUND: [404, 'Target tabungan tidak ditemukan.'],
  GOAL_NEGATIVE: [409, 'Penarikan melebihi dana yang terkumpul.'],
  RECURRING_NOT_FOUND: [404, 'Tagihan rutin tidak ditemukan.'],
  RECURRING_INACTIVE: [409, 'Tagihan rutin sedang nonaktif.'],
  WALLET_NOT_LINKED: [400, 'Dompet tidak tertaut ke Workspace ini.'],
};

function fail(c: Context, code: PlanningErrorCode) {
  const [status, message] = ERRORS[code];
  return jsonError(c, status, code, message);
}

function actorOf(c: Context<AppEnv>): Actor {
  return { userId: c.get('authUser').id, workspace: c.get('workspace') };
}

function idParam(c: Context, name: string): number | null {
  const id = Number(c.req.param(name));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function parseJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Input tidak valid'),
    };
  }
  return { ok: true, data: parsed.data };
}

const notFoundId = (c: Context) => jsonError(c, 400, 'VALIDATION_ERROR', 'ID tidak valid.');

// ---------- Kategori ----------

planningRoutes.get('/categories', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<CategoryItem[]>(c, await listCategories(db, c.get('workspace').id));
});

planningRoutes.post('/categories', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, createCategorySchema);
  if (!parsed.ok) return parsed.response;
  const result = await createCategory(db, c.get('workspace').id, parsed.data);
  return result.ok ? jsonOk<CategoryItem>(c, result.value, 201) : fail(c, result.code);
});

planningRoutes.patch('/categories/:categoryId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'categoryId');
  if (!id) return notFoundId(c);
  const parsed = await parseJson(c, updateCategorySchema);
  if (!parsed.ok) return parsed.response;
  const result = await updateCategory(db, c.get('workspace').id, id, parsed.data);
  return result.ok ? jsonOk(c, { id, ...parsed.data }) : fail(c, result.code);
});

planningRoutes.delete('/categories/:categoryId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'categoryId');
  if (!id) return notFoundId(c);
  const result = await deleteCategory(db, c.get('workspace').id, id);
  return result.ok ? jsonOk(c, { deleted: true, id }) : fail(c, result.code);
});

// ---------- Budget ----------

planningRoutes.get('/budgets', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const month = monthKeySchema.safeParse(c.req.query('month'));
  if (!month.success) return jsonError(c, 400, 'VALIDATION_ERROR', 'Parameter month harus berformat YYYY-MM.');
  const ws = c.get('workspace');
  return jsonOk<BudgetOverview>(c, await getBudgetOverview(db, ws.id, ws.primaryCurrency, month.data));
});

planningRoutes.put('/budgets', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, setBudgetSchema);
  if (!parsed.ok) return parsed.response;
  const result = await setBudget(db, c.get('workspace').id, parsed.data);
  return result.ok ? jsonOk(c, parsed.data) : fail(c, result.code);
});

planningRoutes.post('/budgets/copy', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, copyBudgetSchema);
  if (!parsed.ok) return parsed.response;
  const copied = await copyBudgets(db, c.get('workspace').id, parsed.data.fromMonth, parsed.data.toMonth);
  return jsonOk(c, { copied });
});

// ---------- Target tabungan ----------

planningRoutes.get('/goals', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const ws = c.get('workspace');
  return jsonOk<GoalItem[]>(c, await listGoals(db, ws.id, ws.primaryCurrency));
});

planningRoutes.post('/goals', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, createGoalSchema);
  if (!parsed.ok) return parsed.response;
  return jsonOk<GoalItem>(c, await createGoal(db, actorOf(c), parsed.data), 201);
});

planningRoutes.patch('/goals/:goalId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'goalId');
  if (!id) return notFoundId(c);
  const parsed = await parseJson(c, updateGoalSchema);
  if (!parsed.ok) return parsed.response;
  const result = await updateGoal(db, actorOf(c), id, parsed.data);
  return result.ok ? jsonOk<GoalItem>(c, result.value) : fail(c, result.code);
});

planningRoutes.delete('/goals/:goalId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'goalId');
  if (!id) return notFoundId(c);
  const result = await deleteGoal(db, actorOf(c), id);
  return result.ok ? jsonOk(c, { deleted: true, id }) : fail(c, result.code);
});

planningRoutes.get('/goals/:goalId/contributions', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'goalId');
  if (!id) return notFoundId(c);
  const result = await listGoalContributions(db, c.get('workspace').id, id);
  return result.ok ? jsonOk<GoalContribution[]>(c, result.value) : fail(c, result.code);
});

planningRoutes.post('/goals/:goalId/contributions', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'goalId');
  if (!id) return notFoundId(c);
  const parsed = await parseJson(c, goalContributionSchema);
  if (!parsed.ok) return parsed.response;
  const result = await addGoalContribution(db, actorOf(c), id, parsed.data);
  return result.ok ? jsonOk<GoalItem>(c, result.value, 201) : fail(c, result.code);
});

// ---------- Tagihan rutin ----------

planningRoutes.get('/recurring', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<RecurringBillItem[]>(c, await listRecurringBills(db, c.get('workspace').id));
});

planningRoutes.post('/recurring', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, recurringBillSchema);
  if (!parsed.ok) return parsed.response;
  const result = await createRecurringBill(db, actorOf(c), parsed.data);
  return result.ok ? jsonOk<RecurringBillItem>(c, result.value, 201) : fail(c, result.code);
});

planningRoutes.patch('/recurring/:billId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'billId');
  if (!id) return notFoundId(c);
  const parsed = await parseJson(c, recurringBillSchema);
  if (!parsed.ok) return parsed.response;
  const result = await updateRecurringBill(db, actorOf(c), id, parsed.data);
  return result.ok ? jsonOk<RecurringBillItem>(c, result.value) : fail(c, result.code);
});

planningRoutes.delete('/recurring/:billId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'billId');
  if (!id) return notFoundId(c);
  const result = await deleteRecurringBill(db, actorOf(c), id);
  return result.ok ? jsonOk(c, { deleted: true, id }) : fail(c, result.code);
});

/** Lewati satu periode tanpa mencatat transaksi (mis. tagihan bulan ini dibebaskan). */
planningRoutes.post('/recurring/:billId/skip', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'billId');
  if (!id) return notFoundId(c);
  const result = await skipRecurringBill(db, actorOf(c), id);
  return result.ok ? jsonOk<RecurringBillItem>(c, result.value) : fail(c, result.code);
});
