import { z } from 'zod';
import {
  CURRENCY_CODES,
  TRANSACTION_TYPES,
  WALLET_KINDS,
  WALLET_VISIBILITY_MODES,
} from '@shared/types/domain';
import { MAX_AMOUNT_MINOR, isValidRate } from '@shared/utils/money';
import { appearanceColorSchema, appearanceIconSchema } from '@shared/validation/appearance';

const idSchema = z.coerce.number().int().positive();

const walletNameSchema = z
  .string({ required_error: 'Nama dompet wajib diisi' })
  .trim()
  .min(2, 'Nama dompet minimal 2 karakter')
  .max(100, 'Nama dompet maksimal 100 karakter');

const visibilitySchema = z.enum(WALLET_VISIBILITY_MODES, {
  errorMap: () => ({ message: 'Pilih mode visibilitas dompet' }),
});

export const createWalletSchema = z.object({
  name: walletNameSchema,
  kind: z.enum(WALLET_KINDS, { errorMap: () => ({ message: 'Pilih jenis dompet' }) }),
  currency: z.enum(CURRENCY_CODES, { errorMap: () => ({ message: 'Mata uang tidak didukung' }) }),
  openingBalanceMinor: z
    .number()
    .int('Saldo awal tidak valid')
    .min(-MAX_AMOUNT_MINOR, 'Saldo awal terlalu kecil')
    .max(MAX_AMOUNT_MINOR, 'Saldo awal terlalu besar')
    .default(0),
  visibilityMode: visibilitySchema,
  /** null/tidak diisi = ikon & warna bawaan sesuai jenis dompet. */
  icon: appearanceIconSchema.nullish(),
  color: appearanceColorSchema.nullish(),
});
export type CreateWalletInput = z.input<typeof createWalletSchema>;

export const updateWalletSchema = z
  .object({
    name: walletNameSchema.optional(),
    kind: z.enum(WALLET_KINDS).optional(),
    /** null mengembalikan ke bawaan jenis dompet. */
    icon: appearanceIconSchema.nullable().optional(),
    color: appearanceColorSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>;

export const linkWalletSchema = z.object({
  walletId: idSchema,
  visibilityMode: visibilitySchema,
});

export const updateWalletLinkSchema = z.object({ visibilityMode: visibilitySchema });

export const transactionInputSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES, { errorMap: () => ({ message: 'Pilih jenis transaksi' }) }),
    walletId: idSchema,
    transferTargetWalletId: idSchema.nullish(),
    categoryId: idSchema.nullish(),
    amountMinor: z
      .number({ invalid_type_error: 'Nominal wajib diisi' })
      .int('Nominal tidak valid')
      .positive('Nominal harus lebih dari 0')
      .max(MAX_AMOUNT_MINOR, 'Nominal terlalu besar'),
    title: z
      .string({ required_error: 'Keterangan wajib diisi' })
      .trim()
      .min(1, 'Keterangan wajib diisi')
      .max(160, 'Keterangan maksimal 160 karakter'),
    notes: z
      .string()
      .trim()
      .max(1000, 'Catatan maksimal 1000 karakter')
      .nullish()
      .transform((v) => (v ? v : null)),
    occurredAt: z.string().datetime({ offset: true, message: 'Tanggal tidak valid' }).optional(),
    /** Wajib bila mata uang dompet ≠ mata uang utama Workspace: 1 unit mata uang dompet = ? mata uang Workspace. */
    exchangeRate: z
      .string()
      .trim()
      .refine(isValidRate, 'Kurs harus angka positif (maks. 6 desimal)')
      .optional(),
    /** Diisi saat transaksi adalah pembayaran tagihan rutin (Bayar 1-Klik); hanya dipakai saat membuat. */
    recurringBillId: idSchema.nullish(),
    /** Mode bisnis: hitung transaksi ini ke project tertentu (pemasukan/pengeluaran). */
    projectId: idSchema.nullish(),
    /** Mode bisnis: pemasukan ini adalah pembayaran invoice. */
    invoiceId: idSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.invoiceId && value.type !== 'income') {
      ctx.addIssue({ code: 'custom', path: ['invoiceId'], message: 'Pembayaran invoice harus berupa pemasukan' });
    }
    if (value.type === 'transfer' && value.projectId) {
      ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'Transfer tidak dihitung ke project' });
    }
    if (value.type === 'transfer') {
      if (!value.transferTargetWalletId) {
        ctx.addIssue({ code: 'custom', path: ['transferTargetWalletId'], message: 'Pilih dompet tujuan' });
      } else if (value.transferTargetWalletId === value.walletId) {
        ctx.addIssue({
          code: 'custom',
          path: ['transferTargetWalletId'],
          message: 'Dompet tujuan harus berbeda dari dompet asal',
        });
      }
      if (value.categoryId) {
        ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Transfer tidak memakai kategori' });
      }
      if (value.recurringBillId) {
        ctx.addIssue({ code: 'custom', path: ['recurringBillId'], message: 'Tagihan rutin bukan transfer' });
      }
    } else if (value.transferTargetWalletId) {
      ctx.addIssue({
        code: 'custom',
        path: ['transferTargetWalletId'],
        message: 'Dompet tujuan hanya untuk transfer',
      });
    }
  });
export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const transactionQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  walletId: idSchema.optional(),
  categoryId: idSchema.optional(),
  /** Kata kunci pada keterangan/catatan. */
  q: z.string().trim().max(100, 'Kata kunci maksimal 100 karakter').optional(),
  /** Rentang nominal dalam mata uang Workspace (minor unit, dibandingkan dengan nominal terkonversi). */
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().min(0).optional(),
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
  .refine((v) => v.minAmount === undefined || v.maxAmount === undefined || v.minAmount <= v.maxAmount, {
    message: 'Nominal minimum tidak boleh lebih besar dari maksimum',
  });
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

/** `YYYY-MM` */
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format bulan YYYY-MM');
