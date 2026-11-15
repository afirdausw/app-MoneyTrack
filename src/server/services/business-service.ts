import { and, asc, count, desc, eq, inArray, isNotNull, like, ne, sql } from 'drizzle-orm';
import { clients, invoices, projects, transactions } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import { recordAudit } from '@server/services/audit-service';
import type { Actor } from '@server/services/transaction-service';
import type { DbTransaction } from '@server/services/workspace-service';
import type { ClientItem, CurrencyCode, InvoiceItem, ProjectItem } from '@shared/types/domain';
import { type StoredInvoiceStatus, effectiveInvoiceStatus, nextInvoiceNumber, statusAfterPayment } from '@shared/utils/invoice';
import { dateKeyToDate, toDateKey } from '@shared/utils/schedule';
import type { ClientInput, InvoiceInput, ProjectInput } from '@shared/validation/business';

export type BusinessErrorCode =
  | 'CLIENT_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NUMBER_TAKEN';
export type BizResult<T> = { ok: true; value: T } | { ok: false; code: BusinessErrorCode };

function isDuplicate(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

async function belongs(
  db: DbClient | DbTransaction,
  table: typeof clients | typeof projects | typeof invoices,
  workspaceId: number,
  id: number
): Promise<boolean> {
  const rows = await (db as DbClient)
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
    .limit(1);
  return rows.length > 0;
}

// ---------- Klien ----------

export async function listClients(db: DbClient, workspaceId: number): Promise<ClientItem[]> {
  const [rows, projectCounts, invoiceTotals, profit] = await Promise.all([
    db.select().from(clients).where(eq(clients.workspaceId, workspaceId)).orderBy(asc(clients.name)),
    db
      .select({ clientId: projects.clientId, total: count() })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), isNotNull(projects.clientId)))
      .groupBy(projects.clientId),
    db
      .select({
        clientId: invoices.clientId,
        amount: sql<string>`coalesce(sum(${invoices.amountMinor}), 0)`,
        paid: sql<string>`coalesce(sum(${invoices.paidMinor}), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), isNotNull(invoices.clientId), ne(invoices.status, 'draft')))
      .groupBy(invoices.clientId),
    // Profit klien: transaksi yang ditautkan ke project klien atau invoice klien.
    db
      .select({
        clientId: sql<number>`coalesce(${projects.clientId}, ${invoices.clientId})`.mapWith(Number),
        type: transactions.type,
        total: sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`,
      })
      .from(transactions)
      .leftJoin(projects, eq(transactions.projectId, projects.id))
      .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
      .where(and(eq(transactions.workspaceId, workspaceId), ne(transactions.type, 'transfer')))
      .groupBy(sql`coalesce(${projects.clientId}, ${invoices.clientId})`, transactions.type),
  ]);

  return rows.map((c) => {
    const inv = invoiceTotals.find((i) => i.clientId === c.id);
    const invoiced = Number(inv?.amount ?? 0);
    const paid = Number(inv?.paid ?? 0);
    const sumType = (type: string) => Number(profit.find((p) => p.clientId === c.id && p.type === type)?.total ?? 0);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      notes: c.notes,
      projectCount: projectCounts.find((p) => p.clientId === c.id)?.total ?? 0,
      invoicedMinor: invoiced,
      paidMinor: paid,
      outstandingMinor: Math.max(0, invoiced - paid),
      profitMinor: sumType('income') - sumType('expense'),
    };
  });
}

export async function createClient(db: DbClient, workspaceId: number, input: ClientInput): Promise<number> {
  const [result] = await db.insert(clients).values({ ...input, workspaceId });
  return Number(result.insertId);
}

export async function updateClient(
  db: DbClient,
  workspaceId: number,
  clientId: number,
  input: ClientInput
): Promise<BizResult<true>> {
  if (!(await belongs(db, clients, workspaceId, clientId))) return { ok: false, code: 'CLIENT_NOT_FOUND' };
  await db.update(clients).set(input).where(eq(clients.id, clientId));
  return { ok: true, value: true };
}

/** Project & invoice klien tetap ada (client_id → NULL lewat FK). */
export async function deleteClient(db: DbClient, workspaceId: number, clientId: number): Promise<BizResult<true>> {
  if (!(await belongs(db, clients, workspaceId, clientId))) return { ok: false, code: 'CLIENT_NOT_FOUND' };
  await db.delete(clients).where(eq(clients.id, clientId));
  return { ok: true, value: true };
}

// ---------- Project ----------

export async function listProjects(db: DbClient, workspaceId: number): Promise<ProjectItem[]> {
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        budgetMinor: projects.budgetMinor,
        createdAt: projects.createdAt,
        clientId: clients.id,
        clientName: clients.name,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.status), desc(projects.id)),
    db
      .select({
        projectId: transactions.projectId,
        type: transactions.type,
        total: sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), isNotNull(transactions.projectId), ne(transactions.type, 'transfer')))
      .groupBy(transactions.projectId, transactions.type),
  ]);

  return rows.map((p) => {
    const sumType = (type: string) => Number(totals.find((t) => t.projectId === p.id && t.type === type)?.total ?? 0);
    const income = sumType('income');
    const expense = sumType('expense');
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      budgetMinor: p.budgetMinor,
      client: p.clientId !== null && p.clientName !== null ? { id: p.clientId, name: p.clientName } : null,
      incomeMinor: income,
      expenseMinor: expense,
      profitMinor: income - expense,
      createdAt: p.createdAt.toISOString(),
    };
  });
}

async function checkClient(db: DbClient, workspaceId: number, clientId: number | null): Promise<boolean> {
  return clientId === null || belongs(db, clients, workspaceId, clientId);
}

export async function createProject(db: DbClient, workspaceId: number, input: ProjectInput): Promise<BizResult<number>> {
  if (!(await checkClient(db, workspaceId, input.clientId))) return { ok: false, code: 'CLIENT_NOT_FOUND' };
  const [result] = await db.insert(projects).values({ ...input, workspaceId });
  return { ok: true, value: Number(result.insertId) };
}

export async function updateProject(
  db: DbClient,
  workspaceId: number,
  projectId: number,
  input: ProjectInput
): Promise<BizResult<true>> {
  if (!(await belongs(db, projects, workspaceId, projectId))) return { ok: false, code: 'PROJECT_NOT_FOUND' };
  if (!(await checkClient(db, workspaceId, input.clientId))) return { ok: false, code: 'CLIENT_NOT_FOUND' };
  await db.update(projects).set(input).where(eq(projects.id, projectId));
  return { ok: true, value: true };
}

/** Transaksi project tetap ada, hanya dilepas dari project (kolom tanpa FK, jadi dikosongkan manual). */
export async function deleteProject(db: DbClient, workspaceId: number, projectId: number): Promise<BizResult<true>> {
  if (!(await belongs(db, projects, workspaceId, projectId))) return { ok: false, code: 'PROJECT_NOT_FOUND' };
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ projectId: null })
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.projectId, projectId)));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
  return { ok: true, value: true };
}

// ---------- Invoice ----------

export async function listInvoices(db: DbClient, workspaceId: number): Promise<InvoiceItem[]> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.invoiceNumber,
      title: invoices.title,
      amountMinor: invoices.amountMinor,
      paidMinor: invoices.paidMinor,
      currency: invoices.currencyCode,
      status: invoices.status,
      issuedAt: invoices.issuedAt,
      dueDate: invoices.dueDate,
      clientId: clients.id,
      clientName: clients.name,
      projectId: projects.id,
      projectName: projects.name,
      paymentCount: sql<number>`(select count(*) from ${transactions} where ${transactions.invoiceId} = ${invoices.id})`.mapWith(
        Number
      ),
    })
    .from(invoices)
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .leftJoin(projects, eq(invoices.projectId, projects.id))
    .where(eq(invoices.workspaceId, workspaceId))
    .orderBy(desc(invoices.issuedAt), desc(invoices.id));

  const today = toDateKey(new Date());
  return rows.map((r) => {
    const dueDate = r.dueDate ? toDateKey(r.dueDate) : null;
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      amountMinor: r.amountMinor,
      paidMinor: r.paidMinor,
      currency: r.currency as CurrencyCode,
      status: effectiveInvoiceStatus(
        { status: r.status as StoredInvoiceStatus, paidMinor: r.paidMinor, amountMinor: r.amountMinor, dueDate },
        today
      ),
      issuedAt: toDateKey(r.issuedAt),
      dueDate,
      client: r.clientId !== null && r.clientName !== null ? { id: r.clientId, name: r.clientName } : null,
      project: r.projectId !== null && r.projectName !== null ? { id: r.projectId, name: r.projectName } : null,
      paymentCount: r.paymentCount,
    };
  });
}

async function checkInvoiceLinks(db: DbClient, workspaceId: number, input: InvoiceInput): Promise<BusinessErrorCode | null> {
  if (!(await checkClient(db, workspaceId, input.clientId))) return 'CLIENT_NOT_FOUND';
  if (input.projectId !== null && !(await belongs(db, projects, workspaceId, input.projectId))) return 'PROJECT_NOT_FOUND';
  return null;
}

async function generateNumber(db: DbClient, workspaceId: number, issuedAt: string): Promise<string> {
  const monthKey = issuedAt.slice(0, 7);
  const prefix = `INV-${monthKey.replace('-', '')}-`;
  const existing = await db
    .select({ number: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), like(invoices.invoiceNumber, `${prefix}%`)));
  return nextInvoiceNumber(monthKey, existing.map((e) => e.number));
}

export async function createInvoice(db: DbClient, actor: Actor, input: InvoiceInput): Promise<BizResult<number>> {
  const workspaceId = actor.workspace.id;
  const linkError = await checkInvoiceLinks(db, workspaceId, input);
  if (linkError) return { ok: false, code: linkError };

  // Nomor otomatis dicoba ulang sekali bila bentrok (dua invoice dibuat bersamaan).
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = input.number ?? (await generateNumber(db, workspaceId, input.issuedAt));
    try {
      const id = await db.transaction(async (tx) => {
        const [result] = await tx.insert(invoices).values({
          workspaceId,
          clientId: input.clientId,
          projectId: input.projectId,
          invoiceNumber: number,
          title: input.title,
          amountMinor: input.amountMinor,
          paidMinor: 0,
          currencyCode: actor.workspace.primaryCurrency,
          status: input.status,
          issuedAt: dateKeyToDate(input.issuedAt),
          dueDate: input.dueDate ? dateKeyToDate(input.dueDate) : null,
        });
        const invoiceId = Number(result.insertId);
        await recordAudit(tx, {
          workspaceId,
          actorUserId: actor.userId,
          entityType: 'invoice',
          entityId: invoiceId,
          action: 'create',
          metadata: { number, title: input.title, amountMinor: input.amountMinor, currency: actor.workspace.primaryCurrency },
        });
        return invoiceId;
      });
      return { ok: true, value: id };
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      if (input.number) return { ok: false, code: 'INVOICE_NUMBER_TAKEN' };
    }
  }
  return { ok: false, code: 'INVOICE_NUMBER_TAKEN' };
}

export async function updateInvoice(
  db: DbClient,
  actor: Actor,
  invoiceId: number,
  input: InvoiceInput
): Promise<BizResult<true>> {
  const workspaceId = actor.workspace.id;
  const rows = await db
    .select({ paidMinor: invoices.paidMinor, number: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
    .limit(1);
  const current = rows[0];
  if (!current) return { ok: false, code: 'INVOICE_NOT_FOUND' };
  const linkError = await checkInvoiceLinks(db, workspaceId, input);
  if (linkError) return { ok: false, code: linkError };

  try {
    await db
      .update(invoices)
      .set({
        invoiceNumber: input.number ?? current.number,
        title: input.title,
        amountMinor: input.amountMinor,
        clientId: input.clientId,
        projectId: input.projectId,
        issuedAt: dateKeyToDate(input.issuedAt),
        dueDate: input.dueDate ? dateKeyToDate(input.dueDate) : null,
        // Nominal bisa berubah → status lunas/sebagian dihitung ulang dari pembayaran yang ada.
        status: statusAfterPayment(input.status, current.paidMinor, input.amountMinor),
      })
      .where(eq(invoices.id, invoiceId));
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, code: 'INVOICE_NUMBER_TAKEN' };
    throw err;
  }
  return { ok: true, value: true };
}

/** Transaksi pembayaran tetap ada (dilepas dari invoice). */
export async function deleteInvoice(db: DbClient, actor: Actor, invoiceId: number): Promise<BizResult<true>> {
  const workspaceId = actor.workspace.id;
  const rows = await db
    .select({ number: invoices.invoiceNumber, title: invoices.title })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
    .limit(1);
  if (!rows[0]) return { ok: false, code: 'INVOICE_NOT_FOUND' };
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ invoiceId: null })
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.invoiceId, invoiceId)));
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'delete',
      metadata: { number: rows[0]!.number, title: rows[0]!.title },
    });
  });
  return { ok: true, value: true };
}

/**
 * Validasi tautan project/invoice sebuah transaksi. Invoice tanpa project eksplisit mewarisi project invoice.
 */
export async function resolveBusinessLinks(
  db: DbClient,
  workspaceId: number,
  links: { projectId?: number | null; invoiceId?: number | null }
): Promise<BizResult<{ projectId: number | null; invoiceId: number | null }>> {
  let projectId = links.projectId ?? null;
  const invoiceId = links.invoiceId ?? null;
  if (projectId !== null && !(await belongs(db, projects, workspaceId, projectId))) {
    return { ok: false, code: 'PROJECT_NOT_FOUND' };
  }
  if (invoiceId !== null) {
    const rows = await db
      .select({ projectId: invoices.projectId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .limit(1);
    if (!rows[0]) return { ok: false, code: 'INVOICE_NOT_FOUND' };
    projectId ??= rows[0].projectId;
  }
  return { ok: true, value: { projectId, invoiceId } };
}

/**
 * Hitung ulang `paid_minor` & status invoice dari transaksi pemasukan yang tertaut.
 * Dipanggil di dalam DB transaction yang sama dengan perubahan transaksi.
 */
export async function recomputeInvoices(tx: DbTransaction, invoiceIds: Array<number | null | undefined>): Promise<void> {
  const ids = [...new Set(invoiceIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return;

  const current = await tx
    .select({ id: invoices.id, amountMinor: invoices.amountMinor, status: invoices.status })
    .from(invoices)
    .where(inArray(invoices.id, ids))
    .for('update');
  const sums = await tx
    .select({
      invoiceId: transactions.invoiceId,
      total: sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(and(inArray(transactions.invoiceId, ids), eq(transactions.type, 'income')))
    .groupBy(transactions.invoiceId);

  for (const inv of current) {
    const paid = Number(sums.find((s) => s.invoiceId === inv.id)?.total ?? 0);
    await tx
      .update(invoices)
      .set({ paidMinor: paid, status: statusAfterPayment(inv.status as StoredInvoiceStatus, paid, inv.amountMinor) })
      .where(eq(invoices.id, inv.id));
  }
}

/** Data bisnis bernominal mata uang Workspace (untuk mengunci mata uang utama). */
export async function workspaceHasBusinessData(db: DbClient, workspaceId: number): Promise<boolean> {
  const [inv, proj] = await Promise.all([
    db.select({ id: invoices.id }).from(invoices).where(eq(invoices.workspaceId, workspaceId)).limit(1),
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), ne(projects.budgetMinor, 0)))
      .limit(1),
  ]);
  return inv.length > 0 || proj.length > 0;
}
