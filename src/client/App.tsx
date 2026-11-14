import { useEffect, useState } from 'react';
import {
  BellRing,
  Briefcase,
  CheckCircle2,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  PiggyBank,
  Plus,
  Receipt,
  Split,
  Wallet,
} from 'lucide-react';
import { AuthScreen } from '@client/components/AuthScreen';
import { QuickInputTester } from '@client/components/QuickInputTester';
import { WorkspaceSwitcher } from '@client/components/WorkspaceSwitcher';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import type {
  AuthProvidersPayload,
  AuthSessionPayload,
  HealthStatus,
  WorkspaceType,
} from '@shared/types/domain';
import { formatMoney } from '@shared/utils/currency';

const MODE_HIGHLIGHTS: Record<
  WorkspaceType,
  { title: string; subtitle: string; cards: Array<{ label: string; value: string; note: string }> }
> = {
  personal: {
    title: 'Ringkasan Pribadi',
    subtitle: 'Budget bulanan, target menabung, dan pengingat tagihan rutin 1-klik.',
    cards: [
      { label: 'Total Dompet Tertaut', value: formatMoney(0, 'IDR'), note: 'Siap ditambah di Langkah 2' },
      { label: 'Kategori Bawaan', value: '8 Kategori', note: 'Otomatis dibuat saat registrasi' },
      { label: 'Tagihan Jatuh Tempo', value: '0 Pengingat', note: 'Konfirmasi 1-klik siap' },
    ],
  },
  shared: {
    title: 'Kas Bersama & Split Bill',
    subtitle: 'Hak akses bertingkat, Audit Log, dan settlement utang-piutang antar anggota.',
    cards: [
      { label: 'Kas Bersama Aktif', value: formatMoney(0, 'IDR'), note: 'Transparansi per tautan dompet' },
      { label: 'Status Split Bill', value: formatMoney(0, 'IDR'), note: 'Belum ada tagihan patungan' },
      { label: 'Audit Log', value: 'Aktif', note: 'Tercatat per aktor & waktu' },
    ],
  },
  business: {
    title: 'Arus Kas & Project Bisnis',
    subtitle: 'Profit per project/klien, multi-currency wallet, dan status invoice.',
    cards: [
      { label: 'Profit Bersih Bulan Ini', value: formatMoney(0, 'IDR'), note: 'Omzet dikurangi operasional' },
      { label: 'Project Aktif', value: '0 Project', note: 'Siap ditambah di Fase 5' },
      { label: 'Piutang Belum Lunas', value: formatMoney(0, 'IDR'), note: 'Belum ada invoice' },
    ],
  },
};

export function App() {
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [providers, setProviders] = useState<AuthProvidersPayload>({
    googleEnabled: false,
    redirectUri: 'http://localhost:5173/api/auth/google/callback',
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [apiOffline, setApiOffline] = useState(false);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const [healthRes, providersRes, meRes] = await Promise.allSettled([
        apiFetch<HealthStatus>('/api/health'),
        apiFetch<AuthProvidersPayload>('/api/auth/providers'),
        apiFetch<AuthSessionPayload>('/api/auth/me'),
      ]);

      if (!active) return;

      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
      } else {
        setHealthError('Server API belum terhubung');
      }

      if (providersRes.status === 'fulfilled') {
        setProviders(providersRes.value);
      } else {
        setApiOffline(true);
      }

      if (meRes.status === 'fulfilled') {
        setSession(meRes.value);
        setActiveWorkspaceId(meRes.value.workspaces[0]?.id ?? null);
      } else if (meRes.reason instanceof ApiRequestError && meRes.reason.status === 401) {
        setSession(null);
      }

      setAuthChecking(false);
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession(null);
    setActiveWorkspaceId(null);
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
        Memuat sesi MoneyTrack...
      </div>
    );
  }

  if (!session) {
    return <AuthScreen providers={providers} apiOffline={apiOffline} />;
  }

  const activeWorkspace =
    session.workspaces.find((item) => item.id === activeWorkspaceId) ?? session.workspaces[0];
  const modeType: WorkspaceType = activeWorkspace?.type ?? 'personal';
  const modeView = MODE_HIGHLIGHTS[modeType];

  return (
    <div className="min-h-screen bg-slate-50 pb-20 md:flex md:pb-0">
      {/* Sidebar Desktop */}
      <aside className="hidden w-72 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-5 md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-1">
            <img src="/icon.svg" alt="MoneyTrack" className="h-9 w-9 rounded-xl" />
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900">MoneyTrack</h1>
              <p className="text-xs text-slate-500">Multi-Mode TypeScript</p>
            </div>
          </div>

          {activeWorkspace ? (
            <WorkspaceSwitcher
              workspaces={session.workspaces}
              activeId={activeWorkspace.id}
              onSelect={setActiveWorkspaceId}
            />
          ) : null}

          <nav className="space-y-1">
            <p className="px-2 pb-1 text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Modul MVP
            </p>
            {[
              { icon: LayoutDashboard, label: 'Dashboard', active: true },
              { icon: Wallet, label: 'Dompet Lintas Ruang', active: false },
              { icon: PiggyBank, label: 'Budget & Goals', active: false },
              { icon: BellRing, label: 'Tagihan Rutin', active: false },
              { icon: Split, label: 'Split Bill & Settlement', active: false },
              { icon: FolderKanban, label: 'Project & Tagihan', active: false },
              { icon: Receipt, label: 'Arsip Struk Privat', active: false },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium ${
                    item.active ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{session.user.name}</p>
            <p className="truncate text-slate-500">{session.user.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 font-medium text-slate-700 transition hover:bg-slate-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 md:hidden">
              <img src="/icon.svg" alt="MoneyTrack" className="h-8 w-8 rounded-lg" />
              <div className="min-w-0">
                <h1 className="truncate text-sm font-bold text-slate-900">
                  {activeWorkspace?.name ?? 'MoneyTrack'}
                </h1>
                <p className="truncate text-[11px] text-slate-500">{session.user.name}</p>
              </div>
            </div>

            <div className="hidden md:block">
              <h2 className="text-base font-bold text-slate-900">{modeView.title}</h2>
              <p className="text-xs text-slate-500">{modeView.subtitle}</p>
            </div>

            <div className="flex items-center gap-2">
              {health ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">API OK · DB:</span>{' '}
                  {health.database === 'connected' ? 'MySQL Aktif' : 'Cek DB'}
                </span>
              ) : (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                  {healthError ?? 'Menghubungkan...'}
                </span>
              )}

              <button
                type="button"
                onClick={handleLogout}
                title="Keluar"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 md:hidden"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
          {/* Switcher khusus layar Mobile */}
          {activeWorkspace ? (
            <div className="md:hidden">
              <WorkspaceSwitcher
                workspaces={session.workspaces}
                activeId={activeWorkspace.id}
                onSelect={setActiveWorkspaceId}
              />
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-3">
            {modeView.cards.map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
              >
                <p className="text-xs font-medium text-slate-500">{card.label}</p>
                <p className="mt-1.5 text-xl font-bold tracking-tight text-slate-900">{card.value}</p>
                <p className="mt-1 text-xs text-teal-700">{card.note}</p>
              </div>
            ))}
          </section>

          <QuickInputTester />

          <section className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-sm text-slate-600 sm:p-5">
            <div className="flex items-start gap-3">
              <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <div className="space-y-1">
                <h3 className="font-semibold text-slate-900">
                  Sesi Login Aktif — {session.user.name}
                </h3>
                <p className="text-xs leading-relaxed text-slate-600">
                  Autentikasi session cookie <code className="rounded bg-slate-100 px-1 py-0.5">HttpOnly</code>{' '}
                  sudah tersimpan di MariaDB, dan Workspace awal{' '}
                  <strong>{activeWorkspace?.name ?? 'Keuangan Pribadi'}</strong> sudah siap.
                  Langkah selanjutnya (1B) akan menambahkan pembuatan Workspace baru (`Shared` /
                  `Business`) dan sistem invite anggota.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Bottom Nav Mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-slate-200 bg-white px-2 py-2 md:hidden">
        <button type="button" className="flex flex-col items-center gap-0.5 text-[11px] font-semibold text-teal-700">
          <LayoutDashboard className="h-5 w-5" />
          <span>Beranda</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5 text-[11px] text-slate-500">
          <Wallet className="h-5 w-5" />
          <span>Dompet</span>
        </button>
        <button
          type="button"
          aria-label="Catat Cepat"
          className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg"
        >
          <Plus className="h-6 w-6" />
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5 text-[11px] text-slate-500">
          <Split className="h-5 w-5" />
          <span>Shared</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-0.5 text-[11px] text-slate-500">
          <Briefcase className="h-5 w-5" />
          <span>Bisnis</span>
        </button>
      </nav>
    </div>
  );
}
