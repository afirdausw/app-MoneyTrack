import { z } from 'zod';
import { MAX_AMOUNT_MINOR } from '@shared/utils/money';
import { dateKeySchema } from '@shared/validation/planning';

const idSchema = z.coerce.number().int().positive();
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((v) => (v ? v : null));

export const clientSchema = z.object({
  name: z
    .string({ required_error: 'Nama klien wajib diisi' })
    .trim()
    .min(2, 'Nama klien minimal 2 karakter')
    .max(140, 'Nama klien maksimal 140 karakter'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(191)
    .email('Format email tidak valid')
    .or(z.literal(''))
    .nullish()
    .transform((v) => (v ? v : null)),
  phone: optionalText(40, 'Nomor telepon maksimal 40 karakter'),
  company: optionalText(140, 'Nama perusahaan maksimal 140 karakter'),
  notes: optionalText(1000, 'Catatan maksimal 1000 karakter'),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const projectSchema = z.object({
  name: z
    .string({ required_error: 'Nama project wajib diisi' })
    .trim()
    .min(2, 'Nama project minimal 2 karakter')
    .max(160, 'Nama project maksimal 160 karakter'),
  clientId: idSchema.nullish().transform((v) => v ?? null),
  status: z.enum(['active', 'completed', 'paused']).default('active'),
  budgetMinor: z.number().int().min(0, 'Anggaran tidak boleh negatif').max(MAX_AMOUNT_MINOR).default(0),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const invoiceSchema = z
  .object({
    /** Kosong = nomor otomatis `INV-YYYYMM-NNN`. */
    number: z
      .string()
      .trim()
      .max(60, 'Nomor invoice maksimal 60 karakter')
      .regex(/^[A-Za-z0-9/._-]*$/, 'Nomor invoice hanya boleh huruf, angka, / . _ -')
      .nullish()
      .transform((v) => (v ? v : null)),
    title: z
      .string({ required_error: 'Judul invoice wajib diisi' })
      .trim()
      .min(2, 'Judul minimal 2 karakter')
      .max(160, 'Judul maksimal 160 karakter'),
    amountMinor: z
      .number({ invalid_type_error: 'Nominal wajib diisi' })
      .int('Nominal tidak valid')
      .positive('Nominal harus lebih dari 0')
      .max(MAX_AMOUNT_MINOR, 'Nominal terlalu besar'),
    clientId: idSchema.nullish().transform((v) => v ?? null),
    projectId: idSchema.nullish().transform((v) => v ?? null),
    issuedAt: dateKeySchema,
    dueDate: dateKeySchema.nullish().transform((v) => v ?? null),
    /** Hanya status manual; `partial`/`paid` mengikuti pembayaran. */
    status: z.enum(['draft', 'sent']).default('draft'),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issuedAt, {
    path: ['dueDate'],
    message: 'Jatuh tempo tidak boleh sebelum tanggal terbit',
  });
export type InvoiceInput = z.infer<typeof invoiceSchema>;
