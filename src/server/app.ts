import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { checkDatabaseHealth } from '@server/db';
import { jsonError, jsonOk } from '@server/lib/http';
import { authRoutes } from '@server/routes/auth';
import type { HealthStatus, QuickParseResult } from '@shared/types/domain';
import { parseQuickInput } from '@shared/utils/quick-parser';
import { quickInputSchema } from '@shared/validation/quick-input';

export interface CreateAppOptions {
  serveStaticClient?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  app.route('/api/auth', authRoutes);

  app.get('/api/health', async (c) => {
    const db = await checkDatabaseHealth();
    return jsonOk<HealthStatus>(c, {
      status: 'ok',
      app: 'MoneyTracking API',
      timestamp: new Date().toISOString(),
      database: db.status,
      databaseMessage: db.message,
    });
  });

  app.post('/api/utils/parse-quick-input', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = quickInputSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Input tidak valid'
      );
    }

    return jsonOk<QuickParseResult>(c, parseQuickInput(parsed.data.input));
  });

  const distClientDir = path.resolve(process.cwd(), 'dist/client');
  const distIndexPath = path.join(distClientDir, 'index.html');

  if (options.serveStaticClient && fs.existsSync(distIndexPath)) {
    app.use('/*', serveStatic({ root: './dist/client' }));
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) {
        return jsonError(c, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan');
      }
      const html = fs.readFileSync(distIndexPath, 'utf-8');
      return c.html(html);
    });
  }

  return app;
}
