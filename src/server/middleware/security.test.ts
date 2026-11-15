import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { resetRateLimits } from '@server/middleware/security';

describe('security hardening', () => {
  afterEach(() => resetRateLimits());

  it('sends security headers including a strict CSP', async () => {
    const res = await createApp().request('/api/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://*.googleusercontent.com');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('rejects state-changing requests coming from another site', async () => {
    const app = createApp();
    const evil = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: { code: string } }).error.code).toBe('CSRF_REJECTED');

    const sameSite = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(sameSite.status).toBe(200);

    // GET lintas situs (mis. tautan) tetap boleh.
    expect((await app.request('/api/health', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(200);
  });

  it('rate-limits brute force on invite tokens with 429 + Retry-After', async () => {
    const app = createApp({ rateLimit: true });
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) {
      statuses.push((await app.request(`/api/invites/${'a'.repeat(47)}${i % 10}`)).status);
    }
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true);
    const limited = await app.request(`/api/invites/${'b'.repeat(48)}`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Endpoint lain tidak ikut terkunci oleh bucket undangan.
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('rejects oversized JSON bodies and returns JSON for unknown API routes', async () => {
    const app = createApp();
    const big = await app.request('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(300 * 1024) },
      body: 'x'.repeat(300 * 1024),
    });
    expect(big.status).toBe(413);

    const missing = await app.request('/api/tidak-ada');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
