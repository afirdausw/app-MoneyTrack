import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { env } from '@server/config/env';
import { jsonError } from '@server/lib/http';

/**
 * Header keamanan untuk semua respons. CSP mengizinkan hanya aset dari origin sendiri,
 * foto profil Google (lh3.googleusercontent.com), dan blob/data untuk pratinjau struk.
 * `style-src 'unsafe-inline'` diperlukan untuk atribut `style` (warna kategori, progress bar).
 */
export const securityHeaders: MiddlewareHandler = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  referrerPolicy: 'strict-origin-when-cross-origin',
  // Kamera tetap diizinkan untuk foto struk.
  permissionsPolicy: { camera: ['self'], microphone: [], geolocation: [], payment: [] },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: env.APP_URL.startsWith('https://') ? 'max-age=15552000; includeSubDomains' : false,
});

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function allowedOrigins(c: Context): Set<string> {
  const origins = new Set<string>([new URL(env.APP_URL).origin]);
  // Origin server itu sendiri (mis. produksi satu proses di domain lain dari APP_URL dev).
  const host = c.req.header('host');
  if (host) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  return origins;
}

/**
 * Lapisan CSRF kedua (selain cookie `SameSite=Lax`): tolak request pengubah data yang jelas berasal
 * dari situs lain berdasarkan header `Origin` / `Sec-Fetch-Site`. Request tanpa header tersebut
 * (klien non-browser, test) tetap diizinkan karena tidak membawa cookie lintas situs.
 */
export const originGuard: MiddlewareHandler = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const fetchSite = c.req.header('sec-fetch-site');
    const origin = c.req.header('origin');
    const crossSite = fetchSite === 'cross-site' || (origin !== undefined && !allowedOrigins(c).has(origin));
    if (crossSite) {
      return jsonError(c, 403, 'CSRF_REJECTED', 'Permintaan dari situs lain ditolak.');
    }
  }
  await next();
};

/** IP klien: dari `X-Forwarded-For` hanya bila server di belakang proxy tepercaya (`TRUST_PROXY=true`). */
export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // `app.request()` di test tidak punya socket.
    return 'unknown';
  }
}

interface RateLimitOptions {
  /** Nama bucket agar batas tiap grup endpoint terpisah. */
  name: string;
  windowMs: number;
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/**
 * Rate limit fixed-window per IP, disimpan di memori (cukup untuk satu proses Node).
 * Melampaui batas → 429 `RATE_LIMITED` + header `Retry-After`.
 */
export function rateLimit({ name, windowMs, max }: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    sweep(now);
    const key = `${name}:${clientIp(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    c.header('RateLimit-Limit', String(max));
    c.header('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return jsonError(c, 429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.');
    }
    await next();
  };
}

/** Kosongkan semua bucket (dipakai test). */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Batas ukuran body JSON/teks untuk semua API (upload struk punya batas sendiri yang lebih besar).
 * Dicek dari `Content-Length`; body tanpa header tersebut tetap dibatasi parser JSON di route.
 */
export function jsonBodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const isUpload = c.req.method === 'POST' && /\/receipts$/.test(c.req.path);
    const length = Number(c.req.header('content-length') ?? 0);
    if (!isUpload && length > maxBytes) {
      return jsonError(c, 413, 'PAYLOAD_TOO_LARGE', 'Data yang dikirim terlalu besar.');
    }
    await next();
  };
}
