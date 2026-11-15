import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { requireWorkspaceRole } from '@server/middleware/workspace';
import {
  type BusinessErrorCode,
  createClient,
  createInvoice,
  createProject,
  deleteClient,
  deleteInvoice,
  deleteProject,
  listClients,
  listInvoices,
  listProjects,
  updateClient,
  updateInvoice,
  updateProject,
} from '@server/services/business-service';
import type { Actor } from '@server/services/transaction-service';
import type { ClientItem, InvoiceItem, ProjectItem } from '@shared/types/domain';
import { clientSchema, invoiceSchema, projectSchema } from '@shared/validation/business';

/**
 * Mode bisnis: klien, project, invoice di bawah `/api/workspaces/:wsId`.
 * Baca: min. viewer. Kelola: min. admin. Pembayaran invoice dicatat lewat transaksi (`invoiceId`).
 */
export const businessRoutes = new Hono<AppEnv>();

const ERRORS: Record<BusinessErrorCode, [ContentfulStatusCode, string]> = {
  CLIENT_NOT_FOUND: [404, 'Klien tidak ditemukan.'],
  PROJECT_NOT_FOUND: [404, 'Project tidak ditemukan.'],
  INVOICE_NOT_FOUND: [404, 'Invoice tidak ditemukan.'],
  INVOICE_NUMBER_TAKEN: [409, 'Nomor invoice sudah dipakai di Workspace ini.'],
};

function fail(c: Context, code: BusinessErrorCode) {
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

const invalidId = (c: Context) => jsonError(c, 400, 'VALIDATION_ERROR', 'ID tidak valid.');

// ---------- Klien ----------

businessRoutes.get('/clients', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<ClientItem[]>(c, await listClients(db, c.get('workspace').id));
});

businessRoutes.post('/clients', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, clientSchema);
  if (!parsed.ok) return parsed.response;
  const wsId = c.get('workspace').id;
  const id = await createClient(db, wsId, parsed.data);
  return jsonOk<ClientItem>(c, (await listClients(db, wsId)).find((x) => x.id === id)!, 201);
});

businessRoutes.patch('/clients/:clientId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'clientId');
  if (!id) return invalidId(c);
  const parsed = await parseJson(c, clientSchema);
  if (!parsed.ok) return parsed.response;
  const result = await updateClient(db, c.get('workspace').id, id, parsed.data);
  return result.ok ? jsonOk(c, { id }) : fail(c, result.code);
});

businessRoutes.delete('/clients/:clientId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'clientId');
  if (!id) return invalidId(c);
  const result = await deleteClient(db, c.get('workspace').id, id);
  return result.ok ? jsonOk(c, { deleted: true, id }) : fail(c, result.code);
});

// ---------- Project ----------

businessRoutes.get('/projects', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<ProjectItem[]>(c, await listProjects(db, c.get('workspace').id));
});

businessRoutes.post('/projects', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, projectSchema);
  if (!parsed.ok) return parsed.response;
  const wsId = c.get('workspace').id;
  const result = await createProject(db, wsId, parsed.data);
  if (!result.ok) return fail(c, result.code);
  return jsonOk<ProjectItem>(c, (await listProjects(db, wsId)).find((p) => p.id === result.value)!, 201);
});

businessRoutes.patch('/projects/:projectId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'projectId');
  if (!id) return invalidId(c);
  const parsed = await parseJson(c, projectSchema);
  if (!parsed.ok) return parsed.response;
  const result = await updateProject(db, c.get('workspace').id, id, parsed.data);
  return result.ok ? jsonOk(c, { id }) : fail(c, result.code);
});

businessRoutes.delete('/projects/:projectId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'projectId');
  if (!id) return invalidId(c);
  const result = await deleteProject(db, c.get('workspace').id, id);
  return result.ok ? jsonOk(c, { deleted: true, id }) : fail(c, result.code);
});

// ---------- Invoice ----------

businessRoutes.get('/invoices', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<InvoiceItem[]>(c, await listInvoices(db, c.get('workspace').id));
});

businessRoutes.post('/invoices', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, invoiceSchema);
  if (!parsed.ok) return parsed.response;
  const actor = actorOf(c);
  const result = await createInvoice(db, actor, parsed.data);
  if (!result.ok) return fail(c, result.code);
  return jsonOk<InvoiceItem>(c, (await listInvoices(db, actor.workspace.id)).find((i) => i.id === result.value)!, 201);
});

businessRoutes.patch('/invoices/:invoiceId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'invoiceId');
  if (!id) return invalidId(c);
  const parsed = await parseJson(c, invoiceSchema);
  if (!parsed.ok) return parsed.response;
  const actor = actorOf(c);
  const result = await updateInvoice(db, actor, id, parsed.data);
  if (!result.ok) return fail(c, result.code);
  return jsonOk<InvoiceItem>(c, (await listInvoices(db, actor.workspace.id)).find((i) => i.id === id)!);
});

businessRoutes.delete('/invoices/:invoiceId', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const id = idParam(c, 'invoiceId');
  if (!id) return invalidId(c);
  const result = await deleteInvoice(db, actorOf(c), id);
  return result.ok ? jsonOk(c, { deleted: true, id }) : fail(c, result.code);
});
