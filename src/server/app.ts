import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { env } from '@server/config/env';
import { checkDatabaseHealth } from '@server/db';
import { jsonError, jsonOk } from '@server/lib/http';
import { jsonBodyLimit, originGuard, rateLimit, securityHeaders } from '@server/middleware/security';
import { authRoutes } from '@server/routes/auth';
import { inviteRoutes } from '@server/routes/invites';
import { walletRoutes } from '@server/routes/wallets';
import { workspaceRoutes } from '@server/routes/workspaces';
import type { HealthStatus, QuickParseResult } from '@shared/types/domain';
import { parseQuickInput } from '@shared/utils/quick-parser';
import { quickInputSchema } from '@shared/validation/quick-input';

export interface CreateAppOptions {
  serveStaticClient?: boolean;
  /** Default aktif kecuali saat test (agar ratusan request test tidak terkena limit). */
  rateLimit?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const limitsEnabled = options.rateLimit ?? env.NODE_ENV !== 'test';

  app.use('*', securityHeaders);
  app.use('/api/*', originGuard);
  app.use('/api/*', jsonBodyLimit(256 * 1024));

  if (limitsEnabled) {
    // Batas umum per IP, plus batas ketat untuk login, token undangan (mencegah penebakan), dan upload.
    const strictLimits = [
      { pattern: /^\/api\/auth\/google(\/|$)/, limiter: rateLimit({ name: 'auth', windowMs: 10 * 60_000, max: 30 }) },
      { pattern: /^\/api\/invites\//, limiter: rateLimit({ name: 'invite', windowMs: 10 * 60_000, max: 60 }) },
      {
        pattern: /^\/api\/workspaces\/\d+\/transactions\/\d+\/receipts$/,
        limiter: rateLimit({ name: 'upload', windowMs: 10 * 60_000, max: 60 }),
      },
    ];
    app.use('/api/*', rateLimit({ name: 'api', windowMs: 60_000, max: 600 }));
    app.use('/api/*', async (c, next) => {
      const rule = strictLimits.find((r) => r.pattern.test(c.req.path));
      return rule ? rule.limiter(c, next) : next();
    });
  }

  app.route('/api/auth', authRoutes);
  app.route('/api/workspaces', workspaceRoutes);
  app.route('/api/invites', inviteRoutes);
  app.route('/api/wallets', walletRoutes);

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

  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? jsonError(c, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan')
      : c.text('Tidak ditemukan', 404)
  );

  // Error tak terduga: catat di server, kirim pesan umum tanpa detail internal ke klien.
  app.onError((err, c) => {
    console.error('[api] error tak terduga:', c.req.method, c.req.path, err);
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan di server. Coba lagi.');
  });

  const distClientDir = path.resolve(process.cwd(), 'dist/client');
  const distIndexPath = path.join(distClientDir, 'index.html');

  if (options.serveStaticClient && fs.existsSync(distIndexPath)) {
    app.use(
      '/*',
      serveStatic({
        root: './dist/client',
        onFound: (filePath, c) => {
          // Aset ber-hash Vite aman di-cache lama; service worker & manifest harus selalu dicek ulang.
          // Normalisasi pemisah path (Windows memakai backslash).
          const normalized = filePath.split('\\').join('/');
          if (normalized.includes('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable');
          else if (/sw\.js$|manifest\.webmanifest$|index\.html$/.test(normalized)) c.header('Cache-Control', 'no-cache');
        },
      })
    );
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) {
        return jsonError(c, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan');
      }
      const html = fs.readFileSync(distIndexPath, 'utf-8');
      c.header('Cache-Control', 'no-cache');
      return c.html(html);
    });
  }

  return app;
}
