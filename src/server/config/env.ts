import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional().default(''),
  SESSION_SECRET: z.string().default('dev-only-secret-change-in-production'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  UPLOAD_DIR: z.string().default('./uploads/receipts'),
  MAX_RECEIPT_SIZE_MB: z.coerce.number().positive().default(5),
});

export const env = envSchema.parse(process.env);
