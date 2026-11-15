import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { env } from '@server/config/env';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { deleteStoredFiles, readStoredFile, sniffImageType } from '@server/lib/storage';
import { requireWorkspaceRole } from '@server/middleware/workspace';
import { recordAudit } from '@server/services/audit-service';
import { budgetAlerts, dueRecurringBills } from '@server/services/planning-service';
import { addReceipt, findReceipt, removeReceipt } from '@server/services/receipt-service';
import {
  type Actor,
  type TransactionErrorCode,
  createTransaction,
  deleteTransaction,
  getTransactionDetail,
  getWorkspaceOverview,
  listTransactions,
  updateTransaction,
} from '@server/services/transaction-service';
import {
  createWalletInWorkspace,
  findLinkedWallet,
  findOwnedWallet,
  linkWallet,
  listWorkspaceWallets,
  unlinkWallet,
  updateWalletLink,
  walletHasTransactions,
} from '@server/services/wallet-service';
import type {
  ReceiptItem,
  TransactionDetail,
  TransactionPage,
  WorkspaceOverview,
  WorkspaceWallet,
} from '@shared/types/domain';
import { canManageWorkspace } from '@shared/utils/permissions';
import {
  createWalletSchema,
  linkWalletSchema,
  monthKeySchema,
  transactionInputSchema,
  transactionQuerySchema,
  updateWalletLinkSchema,
} from '@shared/validation/finance';
import type { z } from 'zod';

/**
 * Route keuangan di bawah `/api/workspaces/:wsId`. Dipasang dari `workspaceRoutes`
 * (yang sudah menjalankan `requireAuth`), jadi di sini cukup cek role Workspace.
 */
export const financeRoutes = new Hono<AppEnv>();

const ERRORS: Record<TransactionErrorCode | 'RECEIPT_NOT_FOUND' | 'RECEIPT_LIMIT', [ContentfulStatusCode, string]> = {
  WALLET_NOT_LINKED: [400, 'Dompet tidak tertaut ke Workspace ini.'],
  TARGET_WALLET_NOT_LINKED: [400, 'Dompet tujuan tidak tertaut ke Workspace ini.'],
  TRANSFER_CURRENCY_MISMATCH: [400, 'Transfer antar mata uang berbeda belum didukung.'],
  CATEGORY_INVALID: [400, 'Kategori tidak cocok dengan jenis transaksi atau Workspace.'],
  EXCHANGE_RATE_REQUIRED: [400, 'Isi kurs karena mata uang dompet berbeda dari mata uang Workspace.'],
  TRANSACTION_NOT_FOUND: [404, 'Transaksi tidak ditemukan.'],
  RECEIPT_NOT_FOUND: [404, 'Struk tidak ditemukan.'],
  RECEIPT_LIMIT: [409, 'Maksimal 5 foto struk per transaksi.'],
  RECURRING_NOT_FOUND: [404, 'Tagihan rutin tidak ditemukan.'],
  RECURRING_INACTIVE: [409, 'Tagihan rutin sedang nonaktif.'],
  RECURRING_TYPE_MISMATCH: [400, 'Jenis transaksi harus sama dengan jenis tagihan rutin.'],
  PROJECT_NOT_FOUND: [400, 'Project tidak ditemukan di Workspace ini.'],
  INVOICE_NOT_FOUND: [400, 'Invoice tidak ditemukan di Workspace ini.'],
  FORBIDDEN: [403, 'Kamu hanya bisa mengubah transaksi milikmu sendiri.'],
};

function fail(c: Context, code: keyof typeof ERRORS) {
  const [status, message] = ERRORS[code];
  return jsonError(c, status, code, message);
}

function actorOf(c: Context<AppEnv>): Actor {
  return { userId: c.get('authUser').id, workspace: c.get('workspace') };
}

function parsePositiveId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function parseJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Input tidak valid'),
    };
  }
  return { ok: true, data: parsed.data };
}

// ---------- Dompet ----------

financeRoutes.get('/wallets', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<WorkspaceWallet[]>(c, await listWorkspaceWallets(db, c.get('workspace').id, c.get('authUser').id));
});

financeRoutes.post('/wallets', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, createWalletSchema);
  if (!parsed.ok) return parsed.response;

  const walletId = await createWalletInWorkspace(db, c.get('workspace').id, c.get('authUser').id, parsed.data);
  const list = await listWorkspaceWallets(db, c.get('workspace').id, c.get('authUser').id);
  return jsonOk<WorkspaceWallet>(c, list.find((w) => w.id === walletId)!, 201);
});

financeRoutes.post('/wallets/link', requireWorkspaceRole('admin'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, linkWalletSchema);
  if (!parsed.ok) return parsed.response;

  const workspaceId = c.get('workspace').id;
  const userId = c.get('authUser').id;
  if (!(await findOwnedWallet(db, parsed.data.walletId, userId))) {
    return jsonError(c, 404, 'WALLET_NOT_FOUND', 'Dompet tidak ditemukan di daftar dompetmu.');
  }
  if (await findLinkedWallet(db, workspaceId, parsed.data.walletId)) {
    return jsonError(c, 409, 'WALLET_ALREADY_LINKED', 'Dompet ini sudah tertaut ke Workspace ini.');
  }

  await linkWallet(db, workspaceId, parsed.data.walletId, userId, parsed.data.visibilityMode);
  const list = await listWorkspaceWallets(db, workspaceId, userId);
  const linkedWallet = list.find((w) => w.id === parsed.data.walletId)!;
  await recordAudit(db, {
    workspaceId,
    actorUserId: userId,
    entityType: 'wallet',
    entityId: linkedWallet.id,
    action: 'create',
    metadata: { event: 'linked', walletName: linkedWallet.name, visibilityMode: parsed.data.visibilityMode },
  });
  return jsonOk<WorkspaceWallet>(c, linkedWallet, 201);
});

financeRoutes.patch('/wallets/:walletId', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const walletId = parsePositiveId(c.req.param('walletId'));
  if (!walletId) return jsonError(c, 400, 'VALIDATION_ERROR', 'ID dompet tidak valid.');
  const parsed = await parseJson(c, updateWalletLinkSchema);
  if (!parsed.ok) return parsed.response;

  const workspaceId = c.get('workspace').id;
  const linked = await findLinkedWallet(db, workspaceId, walletId);
  if (!linked) return jsonError(c, 404, 'WALLET_NOT_FOUND', 'Dompet tidak tertaut ke Workspace ini.');

  // Visibilitas menentukan apakah riwayat transaksi pemilik ikut terbuka — hanya pemilik dompet yang boleh mengubah.
  if (linked.ownerUserId !== c.get('authUser').id) {
    return jsonError(c, 403, 'FORBIDDEN', 'Hanya pemilik dompet yang bisa mengubah visibilitasnya.');
  }

  await updateWalletLink(db, workspaceId, walletId, parsed.data.visibilityMode);
  await recordAudit(db, {
    workspaceId,
    actorUserId: c.get('authUser').id,
    entityType: 'wallet',
    entityId: walletId,
    action: 'update',
    metadata: { event: 'visibility', walletName: linked.name, visibilityMode: parsed.data.visibilityMode },
  });
  return jsonOk(c, { id: walletId, visibilityMode: parsed.data.visibilityMode });
});

financeRoutes.delete('/wallets/:walletId', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const walletId = parsePositiveId(c.req.param('walletId'));
  if (!walletId) return jsonError(c, 400, 'VALIDATION_ERROR', 'ID dompet tidak valid.');

  const workspace = c.get('workspace');
  const linked = await findLinkedWallet(db, workspace.id, walletId);
  if (!linked) return jsonError(c, 404, 'WALLET_NOT_FOUND', 'Dompet tidak tertaut ke Workspace ini.');

  const isOwner = linked.ownerUserId === c.get('authUser').id;
  if (!isOwner && !canManageWorkspace(workspace.role)) {
    return jsonError(c, 403, 'FORBIDDEN', 'Hanya admin Workspace atau pemilik dompet yang bisa melepas tautan.');
  }
  if (await walletHasTransactions(db, walletId, workspace.id)) {
    return jsonError(
      c,
      409,
      'WALLET_IN_USE',
      'Dompet sudah dipakai transaksi di Workspace ini. Hapus transaksinya dulu sebelum melepas tautan.'
    );
  }

  await unlinkWallet(db, workspace.id, walletId);
  await recordAudit(db, {
    workspaceId: workspace.id,
    actorUserId: c.get('authUser').id,
    entityType: 'wallet',
    entityId: walletId,
    action: 'delete',
    metadata: { event: 'unlinked', walletName: linked.name },
  });
  return jsonOk(c, { unlinked: true, id: walletId });
});

// ---------- Transaksi ----------

financeRoutes.get('/overview', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const month = monthKeySchema.safeParse(c.req.query('month'));
  if (!month.success) return jsonError(c, 400, 'VALIDATION_ERROR', 'Parameter month harus berformat YYYY-MM.');

  const actor = actorOf(c);
  const balances = await listWorkspaceWallets(db, actor.workspace.id, actor.userId);
  const [overview, dueBills, alerts] = await Promise.all([
    getWorkspaceOverview(db, actor, month.data, balances),
    dueRecurringBills(db, actor.workspace.id),
    budgetAlerts(db, actor.workspace.id, actor.workspace.primaryCurrency, month.data),
  ]);
  return jsonOk<WorkspaceOverview>(c, { ...overview, dueBills, budgetAlerts: alerts });
});

financeRoutes.get('/transactions', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const query = transactionQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', query.error.issues[0]?.message ?? 'Filter tidak valid');
  }
  return jsonOk<TransactionPage>(c, await listTransactions(db, actorOf(c), query.data));
});

financeRoutes.get('/transactions/:txId', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const txId = parsePositiveId(c.req.param('txId'));
  if (!txId) return fail(c, 'TRANSACTION_NOT_FOUND');
  const detail = await getTransactionDetail(db, actorOf(c), txId);
  return detail ? jsonOk<TransactionDetail>(c, detail) : fail(c, 'TRANSACTION_NOT_FOUND');
});

financeRoutes.post('/transactions', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = await parseJson(c, transactionInputSchema);
  if (!parsed.ok) return parsed.response;

  const actor = actorOf(c);
  const result = await createTransaction(db, actor, parsed.data);
  if (!result.ok) return fail(c, result.code);
  return jsonOk<TransactionDetail>(c, (await getTransactionDetail(db, actor, result.value))!, 201);
});

financeRoutes.patch('/transactions/:txId', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const txId = parsePositiveId(c.req.param('txId'));
  if (!txId) return fail(c, 'TRANSACTION_NOT_FOUND');
  const parsed = await parseJson(c, transactionInputSchema);
  if (!parsed.ok) return parsed.response;

  const actor = actorOf(c);
  const result = await updateTransaction(db, actor, txId, parsed.data);
  if (!result.ok) return fail(c, result.code);
  return jsonOk<TransactionDetail>(c, (await getTransactionDetail(db, actor, txId))!);
});

financeRoutes.delete('/transactions/:txId', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const txId = parsePositiveId(c.req.param('txId'));
  if (!txId) return fail(c, 'TRANSACTION_NOT_FOUND');

  const result = await deleteTransaction(db, actorOf(c), txId);
  if (!result.ok) return fail(c, result.code);
  await deleteStoredFiles(result.value);
  return jsonOk(c, { deleted: true, id: txId });
});

// ---------- Struk ----------

const maxReceiptBytes = env.MAX_RECEIPT_SIZE_MB * 1024 * 1024;

financeRoutes.post(
  '/transactions/:txId/receipts',
  requireWorkspaceRole('member'),
  bodyLimit({
    // Sedikit ruang ekstra untuk overhead multipart.
    maxSize: maxReceiptBytes + 64 * 1024,
    onError: (c) =>
      jsonError(c, 413, 'FILE_TOO_LARGE', `Ukuran foto struk maksimal ${env.MAX_RECEIPT_SIZE_MB} MB.`),
  }),
  async (c) => {
    const db = requireDb(c);
    if (db instanceof Response) return db;
    const txId = parsePositiveId(c.req.param('txId'));
    if (!txId) return fail(c, 'TRANSACTION_NOT_FOUND');

    const body = await c.req.parseBody().catch(() => null);
    const file = body?.file;
    if (!(file instanceof File)) {
      return jsonError(c, 400, 'VALIDATION_ERROR', 'Lampirkan file foto struk pada field "file".');
    }
    if (file.size > maxReceiptBytes) {
      return jsonError(c, 413, 'FILE_TOO_LARGE', `Ukuran foto struk maksimal ${env.MAX_RECEIPT_SIZE_MB} MB.`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageType(bytes);
    if (!mime) {
      return jsonError(c, 415, 'UNSUPPORTED_FILE', 'Format struk harus JPG, PNG, atau WebP.');
    }

    const result = await addReceipt(db, actorOf(c), txId, { mime, bytes });
    if (!result.ok) return fail(c, result.code);
    return jsonOk<ReceiptItem>(c, result.value, 201);
  }
);

financeRoutes.get('/receipts/:receiptId', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const receiptId = parsePositiveId(c.req.param('receiptId'));
  if (!receiptId) return fail(c, 'RECEIPT_NOT_FOUND');

  const receipt = await findReceipt(db, c.get('workspace').id, receiptId);
  if (!receipt) return fail(c, 'RECEIPT_NOT_FOUND');

  const data = await readStoredFile(receipt.storagePath).catch(() => null);
  if (!data) return fail(c, 'RECEIPT_NOT_FOUND');

  return c.body(new Uint8Array(data), 200, {
    'Content-Type': receipt.mimeType,
    'Content-Length': String(data.byteLength),
    'Content-Disposition': `inline; filename="struk-${receipt.id}"`,
    // Struk adalah dokumen keuangan privat: jangan disimpan di cache browser/perangkat bersama.
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
});

financeRoutes.delete('/receipts/:receiptId', requireWorkspaceRole('member'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const receiptId = parsePositiveId(c.req.param('receiptId'));
  if (!receiptId) return fail(c, 'RECEIPT_NOT_FOUND');

  const result = await removeReceipt(db, actorOf(c), receiptId);
  if (!result.ok) return fail(c, result.code);
  return jsonOk(c, { deleted: true, id: receiptId });
});
