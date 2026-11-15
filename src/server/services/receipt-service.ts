import { and, count, eq } from 'drizzle-orm';
import { receipts, transactions } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import { type ReceiptMime, deleteStoredFiles, saveReceiptFile } from '@server/lib/storage';
import { type Actor, receiptUrl } from '@server/services/transaction-service';
import type { ReceiptItem } from '@shared/types/domain';
import { canEditTransaction } from '@shared/utils/permissions';

export const MAX_RECEIPTS_PER_TRANSACTION = 5;

export type ReceiptResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'TRANSACTION_NOT_FOUND' | 'RECEIPT_NOT_FOUND' | 'FORBIDDEN' | 'RECEIPT_LIMIT' };

async function findEditableTransaction(db: DbClient, actor: Actor, transactionId: number) {
  const rows = await db
    .select({ id: transactions.id, createdByUserId: transactions.createdByUserId })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, actor.workspace.id)))
    .limit(1);
  const tx = rows[0];
  if (!tx) return { ok: false as const, code: 'TRANSACTION_NOT_FOUND' as const };
  if (!canEditTransaction(actor.workspace.role, tx.createdByUserId === actor.userId)) {
    return { ok: false as const, code: 'FORBIDDEN' as const };
  }
  return { ok: true as const };
}

export async function addReceipt(
  db: DbClient,
  actor: Actor,
  transactionId: number,
  file: { mime: ReceiptMime; bytes: Uint8Array }
): Promise<ReceiptResult<ReceiptItem>> {
  const check = await findEditableTransaction(db, actor, transactionId);
  if (!check.ok) return check;

  const [existing] = await db
    .select({ total: count() })
    .from(receipts)
    .where(eq(receipts.transactionId, transactionId));
  if ((existing?.total ?? 0) >= MAX_RECEIPTS_PER_TRANSACTION) return { ok: false, code: 'RECEIPT_LIMIT' };

  const storagePath = await saveReceiptFile(actor.workspace.id, file.mime, file.bytes);
  try {
    const [result] = await db.insert(receipts).values({
      transactionId,
      workspaceId: actor.workspace.id,
      uploadedByUserId: actor.userId,
      storagePath,
      mimeType: file.mime,
      sizeBytes: file.bytes.byteLength,
    });
    const id = Number(result.insertId);
    return {
      ok: true,
      value: {
        id,
        mimeType: file.mime,
        sizeBytes: file.bytes.byteLength,
        createdAt: new Date().toISOString(),
        url: receiptUrl(actor.workspace.id, id),
      },
    };
  } catch (err) {
    await deleteStoredFiles([storagePath]);
    throw err;
  }
}

/** Metadata struk di Workspace ini (untuk diunduh oleh anggota mana pun, min. viewer). */
export async function findReceipt(db: DbClient, workspaceId: number, receiptId: number) {
  const rows = await db
    .select({
      id: receipts.id,
      transactionId: receipts.transactionId,
      storagePath: receipts.storagePath,
      mimeType: receipts.mimeType,
    })
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function removeReceipt(
  db: DbClient,
  actor: Actor,
  receiptId: number
): Promise<ReceiptResult<true>> {
  const receipt = await findReceipt(db, actor.workspace.id, receiptId);
  if (!receipt) return { ok: false, code: 'RECEIPT_NOT_FOUND' };

  const check = await findEditableTransaction(db, actor, receipt.transactionId);
  if (!check.ok) return check;

  await db.delete(receipts).where(eq(receipts.id, receiptId));
  await deleteStoredFiles([receipt.storagePath]);
  return { ok: true, value: true };
}
