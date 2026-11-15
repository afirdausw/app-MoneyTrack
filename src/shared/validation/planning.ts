import { z } from 'zod';
import { MAX_AMOUNT_MINOR } from '@shared/utils/money';
import { RECURRING_FREQUENCIES, isValidDateKey } from '@shared/utils/schedule';
import { APPEARANCE_COLORS } from '@shared/utils/appearance';
import { appearanceIconSchema } from '@shared/validation/appearance';
import { monthKeySchema } from '@shared/validation/finance';

const idSchema = z.coerce.number().int().positive();
const positiveAmount = (label: string) =>
  z
    .number({ invalid_type_error: `${label} wajib diisi` })
    .int(`${label} tidak valid`)
    .positive(`${label} harus lebih dari 0`)
    .max(MAX_AMOUNT_MINOR, `${label} terlalu besar`);

export const dateKeySchema = z.string().refine(isValidDateKey, 'Tanggal tidak valid (YYYY-MM-DD)');

/** Palet warna kategori yang ditawarkan di UI (server menerima hex apa pun). */
export const CATEGORY_COLORS = APPEARANCE_COLORS;

const categoryName = z
  .string({ required_error: 'Nama kategori wajib diisi' })
  .trim()
  .min(2, 'Nama kategori minimal 2 karakter')
  .max(80, 'Nama kategori maksimal 80 karakter');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus format hex #RRGGBB');

export const createCategorySchema = z.object({
  name: categoryName,
  type: z.enum(['income', 'expense'], { errorMap: () => ({ message: 'Pilih jenis kategori' }) }),
  color: hexColor.default('#64748b'),
  icon: appearanceIconSchema.default('tag'),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({ name: categoryName.optional(), color: hexColor.optional(), icon: appearanceIconSchema.optional() })
  .refine((v) => v.name !== undefined || v.color !== undefined || v.icon !== undefined, {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/** `limitMinor: null` menghapus budget kategori pada bulan tersebut. */
export const setBudgetSchema = z.object({
  month: monthKeySchema,
  categoryId: idSchema,
  limitMinor: positiveAmount('Batas budget').nullable(),
});
export type SetBudgetInput = z.infer<typeof setBudgetSchema>;

export const copyBudgetSchema = z.object({ fromMonth: monthKeySchema, toMonth: monthKeySchema });

const goalName = z
  .string({ required_error: 'Nama target wajib diisi' })
  .trim()
  .min(2, 'Nama target minimal 2 karakter')
  .max(120, 'Nama target maksimal 120 karakter');

export const createGoalSchema = z.object({
  name: goalName,
  targetMinor: positiveAmount('Target'),
  initialMinor: z.number().int().min(0, 'Saldo awal tidak boleh negatif').max(MAX_AMOUNT_MINOR).default(0),
  deadline: dateKeySchema.nullish().transform((v) => v ?? null),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z
  .object({
    name: goalName.optional(),
    targetMinor: positiveAmount('Target').optional(),
    deadline: dateKeySchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.targetMinor !== undefined || v.deadline !== undefined, {
    message: 'Tidak ada perubahan yang dikirim',
  });
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

/** Positif = setor, negatif = tarik dana dari target. */
export const goalContributionSchema = z.object({
  amountMinor: z
    .number({ invalid_type_error: 'Nominal wajib diisi' })
    .int('Nominal tidak valid')
    .refine((v) => v !== 0, 'Nominal tidak boleh 0')
    .refine((v) => Math.abs(v) <= MAX_AMOUNT_MINOR, 'Nominal terlalu besar'),
  note: z
    .string()
    .trim()
    .max(200, 'Catatan maksimal 200 karakter')
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type GoalContributionInput = z.infer<typeof goalContributionSchema>;

export const recurringBillSchema = z.object({
  title: z
    .string({ required_error: 'Nama tagihan wajib diisi' })
    .trim()
    .min(2, 'Nama tagihan minimal 2 karakter')
    .max(140, 'Nama tagihan maksimal 140 karakter'),
  type: z.enum(['income', 'expense']).default('expense'),
  amountMinor: positiveAmount('Nominal'),
  walletId: idSchema.nullish().transform((v) => v ?? null),
  categoryId: idSchema.nullish().transform((v) => v ?? null),
  frequency: z.enum(RECURRING_FREQUENCIES, { errorMap: () => ({ message: 'Pilih frekuensi' }) }),
  nextDueDate: dateKeySchema,
  isActive: z.boolean().default(true),
});
export type RecurringBillInput = z.infer<typeof recurringBillSchema>;
