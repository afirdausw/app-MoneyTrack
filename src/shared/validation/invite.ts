import { z } from 'zod';
import { INVITABLE_ROLES } from '@shared/types/domain';

export const INVITE_EXPIRY_OPTIONS = [1, 7, 30] as const;

export const createInviteSchema = z.object({
  role: z.enum(INVITABLE_ROLES, {
    errorMap: () => ({ message: 'Pilih role untuk anggota baru' }),
  }),
  /** Kosong = link bebas (siapa pun yang memegang link bisa bergabung). */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(191, 'Email terlalu panjang')
    .email('Format email tidak valid')
    .or(z.literal(''))
    .optional()
    .transform((value) => (value ? value : undefined)),
  expiresInDays: z.coerce
    .number()
    .int()
    .refine((value) => (INVITE_EXPIRY_OPTIONS as readonly number[]).includes(value), {
      message: 'Masa berlaku undangan tidak valid',
    })
    .default(7),
});

export type CreateInviteInput = z.input<typeof createInviteSchema>;
export type CreateInviteData = z.output<typeof createInviteSchema>;

/** Token undangan: hex acak dari `generateRandomToken(24)`. */
export const INVITE_TOKEN_PATTERN = /^[a-f0-9]{48}$/;
