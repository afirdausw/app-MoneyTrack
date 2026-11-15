import { useMemo } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { AuthProvidersPayload } from '@shared/types/domain';

interface AuthScreenProps {
  providers: AuthProvidersPayload;
  /** true bila /api/auth/providers tidak bisa dihubungi (server API belum berjalan). */
  apiOffline?: boolean;
}

const OAUTH_ERROR_LABELS: Record<string, string> = {
  google_not_configured: 'Google OAuth belum dikonfigurasi di file .env.',
  oauth_cancelled: 'Login Google dibatalkan atau sesi verifikasi kadaluarsa.',
  oauth_email_unverified: 'Email akun Google belum terverifikasi.',
  oauth_token_failed: 'Gagal menukar kode otorisasi Google.',
  oauth_token_missing: 'Google tidak mengembalikan access token.',
  oauth_profile_failed: 'Gagal mengambil profil akun Google.',
  oauth_unexpected: 'Terjadi kesalahan saat masuk menggunakan Google.',
  db_unavailable: 'Database belum siap untuk memproses login.',
};

export function AuthScreen({ providers, apiOffline = false }: AuthScreenProps) {
  const errorMessage = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('auth_error');
    if (!code) return null;
    window.history.replaceState({}, '', window.location.pathname);
    return OAUTH_ERROR_LABELS[code] ?? 'Autentikasi Google gagal. Silakan coba lagi.';
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <img src="/icon.svg" alt="MoneyTrack" className="h-14 w-14 rounded-2xl shadow-sm" />
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">MoneyTrack</h1>
          <p className="mt-1 text-sm text-slate-500">
            Catatan keuangan Pribadi, Pasangan/Komunitas, dan Bisnis dalam satu akun.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="space-y-1 text-center">
            <h2 className="text-base font-semibold text-slate-900">Masuk atau Daftar</h2>
            <p className="text-xs text-slate-500">
              Cukup satu klik dengan Google—Workspace Pribadi otomatis dibuatkan untuk akun baru.
            </p>
          </div>

          {errorMessage ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
              {errorMessage}
            </div>
          ) : null}

          {apiOffline ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-900">
              <p className="font-semibold">Server API (port 3001) tidak dapat dihubungi.</p>
              <p className="mt-1">
                Jalankan <code className="rounded bg-rose-100 px-1">npm run dev</code> (API + Web
                sekaligus), bukan hanya <code className="rounded bg-rose-100 px-1">vite</code>,
                lalu muat ulang halaman ini.
              </p>
            </div>
          ) : providers.googleEnabled ? (
            <a
              href="/api/auth/google"
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                <GoogleBadge />
              </span>
              <span>Masuk / Daftar dengan Google</span>
              <ArrowRight className="h-4 w-4" />
            </a>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                disabled
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
              >
                <GoogleBadge />
                <span>Masuk / Daftar dengan Google</span>
              </button>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <p className="font-semibold">Konfigurasi Google OAuth di .env belum diisi:</p>
                <p className="mt-1">
                  Isi <code className="rounded bg-amber-100 px-1">GOOGLE_CLIENT_ID</code> &{' '}
                  <code className="rounded bg-amber-100 px-1">GOOGLE_CLIENT_SECRET</code>, lalu
                  daftarkan Redirect URI berikut di Google Cloud Console:
                </p>
                <code className="mt-1.5 block rounded-lg bg-white px-2.5 py-1.5 text-[11px] break-all text-slate-800">
                  {providers.redirectUri}
                </code>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
            <span>Sesi login diamankan dengan cookie HttpOnly</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GoogleBadge() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}
