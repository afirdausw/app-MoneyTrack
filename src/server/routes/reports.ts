import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { buildCsv, buildXlsx } from '@server/lib/xlsx';
import { requireWorkspaceRole } from '@server/middleware/workspace';
import { exportSheets, reportSummary, reportTrend } from '@server/services/report-service';
import type { ReportSummary, TrendPoint } from '@shared/types/domain';
import { daysBetween } from '@shared/utils/schedule';
import { monthKeySchema } from '@shared/validation/finance';
import { dateKeySchema } from '@shared/validation/planning';

/** Laporan & ekspor di bawah `/api/workspaces/:wsId/reports` (min. viewer). */
export const reportRoutes = new Hono<AppEnv>();

/** Maksimal 1 tahun per laporan/ekspor agar query & file tetap ringan di shared hosting. */
const MAX_RANGE_DAYS = 366;

const rangeSchema = z
  .object({ from: dateKeySchema, to: dateKeySchema })
  .refine((v) => v.from <= v.to, { message: 'Tanggal awal harus sebelum tanggal akhir' })
  .refine((v) => daysBetween(v.from, v.to) < MAX_RANGE_DAYS, { message: 'Rentang laporan maksimal 1 tahun' });

reportRoutes.get('/reports/summary', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const range = rangeSchema.safeParse(c.req.query());
  if (!range.success) return jsonError(c, 400, 'VALIDATION_ERROR', range.error.issues[0]?.message ?? 'Periode tidak valid');
  return jsonOk<ReportSummary>(c, await reportSummary(db, c.get('workspace'), range.data.from, range.data.to));
});

reportRoutes.get('/reports/trend', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const query = z
    .object({ end: monthKeySchema, months: z.coerce.number().int().min(2).max(24).default(6) })
    .safeParse(c.req.query());
  if (!query.success) return jsonError(c, 400, 'VALIDATION_ERROR', query.error.issues[0]?.message ?? 'Parameter tidak valid');
  return jsonOk<TrendPoint[]>(c, await reportTrend(db, c.get('workspace').id, query.data.end, query.data.months));
});

reportRoutes.get('/reports/export', requireWorkspaceRole('viewer'), async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;
  const parsed = rangeSchema
    .and(z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') }))
    .safeParse(c.req.query());
  if (!parsed.success) return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Parameter tidak valid');

  const workspace = c.get('workspace');
  const { from, to, format } = parsed.data;
  const sheets = await exportSheets(db, workspace, from, to);
  const slug = workspace.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'workspace';
  const filename = `moneytrack-${slug}-${from}_${to}.${format}`;

  const headers = {
    'Content-Disposition': `attachment; filename="${filename}"`,
    // Berisi data keuangan: jangan disimpan di cache perantara.
    'Cache-Control': 'private, no-store',
  };
  if (format === 'csv') {
    return c.body(buildCsv(sheets.transactions.columns, sheets.transactions.rows), 200, {
      ...headers,
      'Content-Type': 'text/csv; charset=utf-8',
    });
  }
  const file = buildXlsx([sheets.transactions, sheets.summary]);
  return c.body(new Uint8Array(file), 200, {
    ...headers,
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
});
