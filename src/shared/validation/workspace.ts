import { z } from 'zod';
import { CURRENCY_CODES, WORKSPACE_TYPES } from '@shared/types/domain';
import { appearanceColorSchema, appearanceIconSchema } from '@shared/validation/appearance';

const workspaceNameSchema = z
  .string({ required_error: 'Nama Workspace wajib diisi' })
  .trim()
  .min(2, 'Nama Workspace minimal 2 karakter')
  .max(120, 'Nama Workspace maksimal 120 karakter');

const currencySchema = z.enum(CURRENCY_CODES, {
  errorMap: () => ({ message: 'Mata uang tidak didukung' }),
});

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  type: z.enum(WORKSPACE_TYPES, {
    errorMap: () => ({ message: 'Pilih mode Workspace' }),
  }),
  primaryCurrency: currencySchema,
  /** null/tidak diisi = ikon & warna bawaan sesuai mode. */
  icon: appearanceIconSchema.nullish(),
  color: appearanceColorSchema.nullish(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: workspaceNameSchema.optional(),
    primaryCurrency: currencySchema.optional(),
    /** null mengembalikan ke bawaan mode. */
    icon: appearanceIconSchema.nullable().optional(),
    color: appearanceColorSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  });

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
