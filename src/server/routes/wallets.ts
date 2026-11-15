import { Hono } from 'hono';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { requireAuth } from '@server/middleware/auth';
import {
  deleteWallet,
  findOwnedWallet,
  listMyWallets,
  updateWallet,
  walletHasTransactions,
} from '@server/services/wallet-service';
import type { MyWallet } from '@shared/types/domain';
import { updateWalletSchema } from '@shared/validation/finance';

/** Dompet milik user aktif (lintas Workspace): `/api/wallets`. */
export const walletRoutes = new Hono<AppEnv>();

walletRoutes.use('*', requireAuth);

walletRoutes.get('/', async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  return jsonOk<MyWallet[]>(c, await listMyWallets(db, c.get('authUser').id));
});

walletRoutes.patch('/:walletId', async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const walletId = Number(c.req.param('walletId'));
  if (!Number.isSafeInteger(walletId) || walletId <= 0) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'ID dompet tidak valid.');
  }
  const parsed = updateWalletSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Input tidak valid');
  }
  if (!(await findOwnedWallet(db, walletId, c.get('authUser').id))) {
    return jsonError(c, 404, 'WALLET_NOT_FOUND', 'Dompet tidak ditemukan.');
  }
  await updateWallet(db, walletId, parsed.data);
  return jsonOk(c, { id: walletId, ...parsed.data });
});

walletRoutes.delete('/:walletId', async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const walletId = Number(c.req.param('walletId'));
  if (!Number.isSafeInteger(walletId) || walletId <= 0) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'ID dompet tidak valid.');
  }
  if (!(await findOwnedWallet(db, walletId, c.get('authUser').id))) {
    return jsonError(c, 404, 'WALLET_NOT_FOUND', 'Dompet tidak ditemukan.');
  }
  if (await walletHasTransactions(db, walletId)) {
    return jsonError(c, 409, 'WALLET_IN_USE', 'Dompet sudah memiliki transaksi sehingga tidak bisa dihapus.');
  }
  await deleteWallet(db, walletId);
  return jsonOk(c, { deleted: true, id: walletId });
});
