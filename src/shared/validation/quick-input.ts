import { z } from 'zod';

export const quickInputSchema = z.object({
  input: z
    .string()
    .trim()
    .min(1, 'Teks transaksi wajib diisi')
    .max(200, 'Teks transaksi maksimal 200 karakter'),
});

export type QuickInputFormValues = z.infer<typeof quickInputSchema>;
