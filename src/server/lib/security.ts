import crypto from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '@server/config/env';

export const SESSION_COOKIE_NAME = 'mt_session';
export const OAUTH_STATE_COOKIE_NAME = 'mt_oauth_state';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 hari

export function generateRandomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(`${rawToken}:${env.SESSION_SECRET}`).digest('hex');
}

/** Hash token undangan sebelum disimpan — DB hanya menyimpan hash, bukan token aslinya. */
export function hashInviteToken(rawToken: string): string {
  return crypto
    .createHash('sha256')
    .update(`invite:${rawToken}:${env.SESSION_SECRET}`)
    .digest('hex');
}

function isSecureCookie(): boolean {
  return env.APP_URL.startsWith('https://');
}

export function setSessionCookie(c: Context, rawToken: string): void {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: isSecureCookie(),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

export function setOAuthStateCookie(c: Context, state: string): void {
  setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 10,
    secure: isSecureCookie(),
  });
}

export function readOAuthStateCookie(c: Context): string | undefined {
  return getCookie(c, OAUTH_STATE_COOKIE_NAME);
}

export function clearOAuthStateCookie(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: '/' });
}
