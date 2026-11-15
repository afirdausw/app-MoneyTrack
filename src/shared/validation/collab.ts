import { z } from 'zod';
import { MAX_AMOUNT_MINOR } from '@shared/utils/money';

const idSchema = z.coerce.number().int().positive();

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer'], { errorMap: () => ({ message: 'Pilih role yang valid' }) }),
});

export const createSplitSchema = z
  .object({
    title: z
      .string({ required_error: 'Keterangan wajib diisi' })
      .trim()
      .min(2, 'Keterangan minimal 2 karakter')
      .max(160, 'Keterangan maksimal 160 karakter'),
    totalMinor: z
      .number({ invalid_type_error: 'Total wajib diisi' })
      .int('Total tidak valid')
      .positive('Total harus lebih dari 0')
      .max(MAX_AMOUNT_MINOR, 'Total terlalu besar'),
    paidByUserId: idSchema,
    occurredAt: z.string().datetime({ offset: true, message: 'Tanggal tidak valid' }).optional(),
    mode: z.enum(['equal', 'custom']),
    /** Mode `equal`: cukup `userId`. Mode `custom`: `owedMinor` wajib dan jumlahnya harus = total. */
    participants: z
      .array(z.object({ userId: idSchema, owedMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR).optional() }))
      .min(1, 'Pilih minimal satu peserta'),
  })
  .superRefine((value, ctx) => {
    const ids = value.participants.map((p) => p.userId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['participants'], message: 'Peserta tidak boleh dobel' });
    }
    if (ids.length === 1 && ids[0] === value.paidByUserId) {
      ctx.addIssue({ code: 'custom', path: ['participants'], message: 'Tambahkan peserta selain pembayar' });
    }
    if (value.mode === 'custom') {
      if (value.participants.some((p) => p.owedMinor === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['participants'], message: 'Isi nominal tiap peserta' });
        return;
      }
      const sum = value.participants.reduce((acc, p) => acc + (p.owedMinor ?? 0), 0);
      if (sum !== value.totalMinor) {
        ctx.addIssue({ code: 'custom', path: ['participants'], message: 'Jumlah porsi peserta harus sama dengan total' });
      }
    }
  });
export type CreateSplitInput = z.infer<typeof createSplitSchema>;

export const settlePairSchema = z
  .object({ fromUserId: idSchema, toUserId: idSchema })
  .refine((v) => v.fromUserId !== v.toUserId, { message: 'Pengirim dan penerima harus berbeda' });

export const auditQuerySchema = z.object({
  entityType: z
    .enum(['transaction', 'member', 'split', 'wallet', 'workspace', 'goal_contribution', 'invoice'])
    .optional(),
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
