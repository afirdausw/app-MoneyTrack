import 'dotenv/config';
import { z } from 'zod';

const DEV_SESSION_SECRET = 'dev-only-secret-change-in-production';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    APP_URL: z.string().url().default('http://localhost:5173'),
    DATABASE_URL: z.string().optional().default(''),
    SESSION_SECRET: z.string().default(DEV_SESSION_SECRET),
    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
    GOOGLE_REDIRECT_URI: z.string().optional().default(''),
    UPLOAD_DIR: z.string().default('./uploads/receipts'),
    MAX_RECEIPT_SIZE_MB: z.coerce.number().positive().default(5),
    /** `true` bila server berada di belakang reverse proxy tepercaya (memakai `X-Forwarded-For` untuk IP). */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((value, ctx) => {
    // Jangan jalan di produksi dengan secret bawaan/pendek: hash sesi & token undangan jadi bisa ditebak.
    if (value.NODE_ENV === 'production' && (value.SESSION_SECRET === DEV_SESSION_SECRET || value.SESSION_SECRET.length < 32)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET wajib diisi string acak minimal 32 karakter di produksi.',
      });
    }
  });

export const env = envSchema.parse(process.env);
