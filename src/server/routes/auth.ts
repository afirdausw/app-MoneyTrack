import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { env } from '@server/config/env';
import { users } from '@server/db/schema';
import { type AppEnv, jsonOk, requireDb } from '@server/lib/http';
import {
  SESSION_COOKIE_NAME,
  clearOAuthStateCookie,
  clearSessionCookie,
  generateRandomToken,
  readOAuthStateCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from '@server/lib/security';
import { requireAuth } from '@server/middleware/auth';
import {
  createSessionForUser,
  createUserWithDefaultWorkspace,
  deleteSessionByRawToken,
  getUserWorkspaces,
} from '@server/services/auth-service';
import type { AuthProvidersPayload, AuthSessionPayload } from '@shared/types/domain';

function isGoogleEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function getGoogleRedirectUri(): string {
  return env.GOOGLE_REDIRECT_URI || `${env.APP_URL}/api/auth/google/callback`;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/providers', (c) => {
  return jsonOk<AuthProvidersPayload>(c, {
    googleEnabled: isGoogleEnabled(),
    redirectUri: getGoogleRedirectUri(),
  });
});

authRoutes.post('/logout', async (c) => {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    const db = requireDb(c);
    if (!(db instanceof Response)) {
      await deleteSessionByRawToken(db, rawToken).catch(() => undefined);
    }
  }
  clearSessionCookie(c);
  return jsonOk(c, { loggedOut: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) return db;

  const authUser = c.get('authUser');
  const workspaces = await getUserWorkspaces(db, authUser.id);

  return jsonOk<AuthSessionPayload>(c, {
    user: authUser,
    workspaces,
  });
});

authRoutes.get('/google', (c) => {
  if (!isGoogleEnabled()) {
    return c.redirect('/?auth_error=google_not_configured');
  }

  const state = generateRandomToken(24);
  setOAuthStateCookie(c, state);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRoutes.get('/google/callback', async (c) => {
  const db = requireDb(c);
  if (db instanceof Response) {
    return c.redirect('/?auth_error=db_unavailable');
  }

  const expectedState = readOAuthStateCookie(c);
  clearOAuthStateCookie(c);

  const code = c.req.query('code');
  const state = c.req.query('state');
  const oauthErr = c.req.query('error');

  if (oauthErr || !code || !state || !expectedState || state !== expectedState) {
    console.warn('[auth/google] callback ditolak:', {
      googleError: oauthErr ?? null,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasStateCookie: Boolean(expectedState),
      stateMatches: Boolean(state && expectedState && state === expectedState),
    });
    return c.redirect('/?auth_error=oauth_cancelled');
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: getGoogleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      // Body error Google (mis. redirect_uri_mismatch / invalid_client) tidak berisi secret.
      console.error('[auth/google] tukar token gagal:', tokenRes.status, await tokenRes.text());
      return c.redirect('/?auth_error=oauth_token_failed');
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      return c.redirect('/?auth_error=oauth_token_missing');
    }

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    if (!profileRes.ok) {
      console.error('[auth/google] ambil profil gagal:', profileRes.status);
      return c.redirect('/?auth_error=oauth_profile_failed');
    }

    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.sub || !profile.email || !profile.email_verified) {
      return c.redirect('/?auth_error=oauth_email_unverified');
    }

    const normalizedEmail = profile.email.trim().toLowerCase();
    const displayName = profile.name?.trim() || normalizedEmail.split('@')[0] || 'Pengguna';

    let userId: number;
    const byGoogle = await db
      .select()
      .from(users)
      .where(eq(users.googleId, profile.sub))
      .limit(1);

    if (byGoogle[0]) {
      userId = byGoogle[0].id;
    } else {
      const byEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (byEmail[0]) {
        userId = byEmail[0].id;
        await db
          .update(users)
          .set({
            googleId: profile.sub,
            avatarUrl: byEmail[0].avatarUrl ?? profile.picture ?? null,
          })
          .where(eq(users.id, userId));
      } else {
        const created = await createUserWithDefaultWorkspace(db, {
          name: displayName,
          email: normalizedEmail,
          passwordHash: null,
          googleId: profile.sub,
          avatarUrl: profile.picture ?? null,
        });
        userId = created.user.id;
      }
    }

    const rawToken = await createSessionForUser(db, userId);
    setSessionCookie(c, rawToken);
    return c.redirect('/');
  } catch (err) {
    console.error('[auth/google] error tak terduga:', err);
    return c.redirect('/?auth_error=oauth_unexpected');
  }
});
