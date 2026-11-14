import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { users, workspaces } from '@server/db/schema';
import { SESSION_COOKIE_NAME } from '@server/lib/security';
import {
  createSessionForUser,
  createUserWithDefaultWorkspace,
} from '@server/services/auth-service';
import type {
  ApiError,
  ApiSuccess,
  AuthProvidersPayload,
  AuthSessionPayload,
} from '@shared/types/domain';

describe('auth routes (Google-only minimal)', () => {
  const app = createApp({ serveStaticClient: false });
  const testEmail = `vitest-google-${Date.now()}@example.test`;
  let createdUserId: number | null = null;

  afterAll(async () => {
    const db = getDb();
    if (db && createdUserId !== null) {
      await db.delete(workspaces).where(eq(workspaces.createdByUserId, createdUserId));
      await db.delete(users).where(eq(users.id, createdUserId));
    }
    await closeDb();
  });

  it('GET /api/auth/providers reports google OAuth config and redirectUri', async () => {
    const res = await app.request('/api/auth/providers');
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiSuccess<AuthProvidersPayload>;
    expect(json.ok).toBe(true);
    expect(typeof json.data.googleEnabled).toBe('boolean');
    expect(json.data.redirectUri).toContain('/api/auth/google/callback');
  });

  it('GET /api/auth/me rejects unauthenticated requests', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiError;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/auth/google/callback rejects missing or mismatched OAuth state', async () => {
    const res = await app.request('/api/auth/google/callback?code=fake&state=wrong');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?auth_error=oauth_cancelled');
  });

  it.skipIf(!env.DATABASE_URL)(
    'provisions Google user + default workspace and validates /me and /logout',
    async () => {
      const db = getDb()!;
      const created = await createUserWithDefaultWorkspace(db, {
        name: 'Pengguna Google Uji',
        email: testEmail,
        passwordHash: null,
        googleId: `google-sub-${Date.now()}`,
      });
      createdUserId = created.user.id;
      expect(created.workspaces).toHaveLength(1);
      expect(created.workspaces[0]?.name).toBe('Keuangan Pribadi');

      const rawToken = await createSessionForUser(db, createdUserId);
      const cookieHeader = `${SESSION_COOKIE_NAME}=${rawToken}`;

      const meRes = await app.request('/api/auth/me', {
        headers: { Cookie: cookieHeader },
      });
      expect(meRes.status).toBe(200);
      const meJson = (await meRes.json()) as ApiSuccess<AuthSessionPayload>;
      expect(meJson.data.user.email).toBe(testEmail);
      expect(meJson.data.workspaces[0]?.role).toBe('owner');

      const outRes = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      });
      expect(outRes.status).toBe(200);

      const meAfterLogout = await app.request('/api/auth/me', {
        headers: { Cookie: cookieHeader },
      });
      expect(meAfterLogout.status).toBe(401);
    }
  );
});
