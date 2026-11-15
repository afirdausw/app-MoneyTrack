import { ArrowRight, Briefcase, User, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GoogleBadge } from '@client/components/AuthScreen';
import { MODE_LABEL, ROLE_LABEL } from '@client/lib/labels';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import type {
  AcceptInvitePayload,
  AuthUser,
  InvitePreview,
  WorkspaceSummary,
  WorkspaceType,
} from '@shared/types/domain';

interface InviteScreenProps {
  token: string;
  /** null = belum login. */
  user: AuthUser | null;
  googleEnabled: boolean;
  /** Dipanggil setelah bergabung, atau bila user ternyata sudah anggota (Workspace langsung dibuka). */
  onJoined: (workspace: WorkspaceSummary) => void;
  onDismiss: () => void;
}

const MODE_ICON: Record<WorkspaceType, typeof User> = {
  personal: User,
  shared: Users,
  business: Briefcase,
};

const STATUS_MESSAGE: Record<Exclude<InvitePreview['status'], 'pending'>, string> = {
  expired: 'Undangan ini sudah kedaluwarsa. Minta link baru ke admin Workspace.',
  used: 'Undangan ini sudah dipakai. Minta link baru bila kamu belum bergabung.',
};

export function InviteScreen({
  token,
  user,
  googleEnabled,
  onJoined,
  onDismiss,
}: InviteScreenProps) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<InvitePreview>(`/api/invites/${token}`)
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof ApiRequestError
            ? { code: err.code, message: err.message }
            : { code: 'REQUEST_FAILED', message: 'Gagal memuat undangan.' }
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const result = await apiFetch<AcceptInvitePayload>(`/api/invites/${token}/accept`, {
        method: 'POST',
      });
      onJoined(result.workspace);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? { code: err.code, message: err.message }
          : { code: 'REQUEST_FAILED', message: 'Gagal bergabung ke Workspace.' }
      );
      setJoining(false);
    }
  }

  const Icon = preview ? MODE_ICON[preview.workspaceType] : Users;
  const blockedStatus = preview && preview.status !== 'pending' ? STATUS_MESSAGE[preview.status] : null;
  const emailMismatch = Boolean(
    user && preview?.email && preview.email.toLowerCase() !== user.email.toLowerCase()
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <img src="/icon.svg" alt="MoneyTrack" className="h-12 w-12 rounded-2xl shadow-sm" />
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-900">Undangan Workspace</h1>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          {preview ? (
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs text-slate-500">
                  <strong className="text-slate-700">{preview.invitedByName}</strong> mengundangmu ke
                </p>
                <p className="truncate text-base font-semibold text-slate-900">{preview.workspaceName}</p>
                <p className="text-xs text-slate-500">
                  Mode {MODE_LABEL[preview.workspaceType]} · sebagai{' '}
                  <strong className="text-slate-700">{ROLE_LABEL[preview.role]}</strong>
                </p>
                {preview.email ? (
                  <p className="text-xs text-slate-500">Khusus untuk {preview.email}</p>
                ) : null}
              </div>
            </div>
          ) : !error ? (
            <p className="text-center text-sm text-slate-500">Memuat undangan...</p>
          ) : null}

          {blockedStatus ? <Notice tone="amber">{blockedStatus}</Notice> : null}
          {emailMismatch && !blockedStatus ? (
            <Notice tone="amber">
              Kamu masuk sebagai <strong>{user?.email}</strong>, sedangkan undangan ini untuk{' '}
              <strong>{preview?.email}</strong>. Keluar lalu masuk dengan akun yang diundang.
            </Notice>
          ) : null}
          {error ? <Notice tone="rose">{error.message}</Notice> : null}

          {preview && !blockedStatus && !error ? (
            user ? (
              <button
                type="button"
                onClick={join}
                disabled={joining || emailMismatch}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joining ? 'Bergabung...' : `Gabung sebagai ${user.name}`}
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : googleEnabled ? (
              <a
                href="/api/auth/google"
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                  <GoogleBadge />
                </span>
                Masuk dengan Google untuk bergabung
              </a>
            ) : (
              <Notice tone="amber">Login Google belum dikonfigurasi di server.</Notice>
            )
          ) : null}

          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-xl px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            {user ? 'Kembali ke beranda' : 'Nanti saja'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'amber' | 'rose'; children: React.ReactNode }) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-rose-200 bg-rose-50 text-rose-800';
  return (
    <div role="alert" className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${toneClass}`}>
      {children}
    </div>
  );
}
