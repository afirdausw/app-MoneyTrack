import path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '@server/app';
import { env } from '@server/config/env';

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isRunningBuiltServer = entryPath.endsWith(path.join('dist', 'server', 'index.js'));
const serveStaticClient = isRunningBuiltServer || process.env.NODE_ENV === 'production';

const app = createApp({ serveStaticClient });

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(
      `[MoneyTracking API] berjalan di http://localhost:${info.port} (static: ${serveStaticClient ? 'aktif' : 'dev-proxy'})`
    );
  }
);
