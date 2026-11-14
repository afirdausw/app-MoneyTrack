import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { closeDb } from '@server/db';
import type { ApiSuccess, HealthStatus, QuickParseResult } from '@shared/types/domain';

describe('API app endpoints', () => {
  const app = createApp({ serveStaticClient: false });

  afterAll(async () => {
    await closeDb();
  });

  it('GET /api/health responds with status ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiSuccess<HealthStatus>;
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe('ok');
    expect(json.data.app).toBe('MoneyTracking API');
  });

  it('POST /api/utils/parse-quick-input parses quick transaction text', async () => {
    const res = await app.request('/api/utils/parse-quick-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'kopi susu 22rb gopay' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiSuccess<QuickParseResult>;
    expect(json.ok).toBe(true);
    expect(json.data.amount).toBe(22000);
    expect(json.data.walletHint).toBe('gopay');
    expect(json.data.type).toBe('expense');
  });

  it('POST /api/utils/parse-quick-input rejects empty payload', async () => {
    const res = await app.request('/api/utils/parse-quick-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
