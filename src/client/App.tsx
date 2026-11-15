import { useEffect, useState } from 'react';
import { AppShell } from '@client/AppShell';
import { AuthScreen } from '@client/components/AuthScreen';
import { InviteScreen } from '@client/components/InviteScreen';
import { WorkspaceDialog, type WorkspaceDialogMode } from '@client/components/WorkspaceDialog';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import type {
  AuthProvidersPayload,
  AuthSessionPayload,
  HealthStatus,
  WorkspaceSummary,
} from '@shared/types/domain';
import { INVITE_TOKEN_PATTERN } from '@shared/validation/invite';

const ACTIVE_WORKSPACE_KEY = 'mt_active_workspace';

function readStoredWorkspaceId(): number | null {
  try {
    const value = Number(window.localStorage.getItem(ACTIVE_WORKSPACE_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function storeWorkspaceId(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    else window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(id));
  } catch {
    // localStorage bisa diblokir (mode privat) — pilihan Workspace cukup tidak diingat.
  }
}

const PENDING_INVITE_KEY = 'mt_pending_invite';

/**
 * Token dari URL `/invite/<token>`, atau token yang disimpan sebelum user diarahkan ke login Google
 * (callback OAuth selalu kembali ke `/`, jadi token perlu diingat sementara).
 */
function resolveInviteToken(): string | null {
  const fromPath = /^\/invite\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null;
  try {
    if (fromPath && INVITE_TOKEN_PATTERN.test(fromPath)) {
      window.localStorage.setItem(PENDING_INVITE_KEY, fromPath);
      return fromPath;
    }
    const pending = window.localStorage.getItem(PENDING_INVITE_KEY);
    return pending && INVITE_TOKEN_PATTERN.test(pending) ? pending : null;
  } catch {
    return fromPath && INVITE_TOKEN_PATTERN.test(fromPath) ? fromPath : null;
  }
}

function clearPendingInvite(): void {
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // abaikan — lihat storeWorkspaceId
  }
  if (window.location.pathname.startsWith('/invite/')) {
    window.history.replaceState({}, '', '/');
  }
}

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
  // `dialog` tetap terisi selama animasi tutup; `dialogOpen` yang memicu animasinya.
  const [dialog, setDialog] = useState<WorkspaceDialogMode | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(resolveInviteToken);

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
        const storedId = readStoredWorkspaceId();
        const hasStored = meRes.value.workspaces.some((ws) => ws.id === storedId);
        setActiveWorkspaceId(hasStored ? storedId : (meRes.value.workspaces[0]?.id ?? null));
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
    storeWorkspaceId(null);
  }

  function finishInvite() {
    clearPendingInvite();
    setInviteToken(null);
  }

  function handleInviteJoined(joined: WorkspaceSummary) {
    setSession((prev) =>
      prev
        ? {
            ...prev,
            workspaces: prev.workspaces.some((ws) => ws.id === joined.id)
              ? prev.workspaces
              : [...prev.workspaces, joined],
          }
        : prev
    );
    selectWorkspace(joined.id);
    finishInvite();
  }

  function selectWorkspace(id: number) {
    setActiveWorkspaceId(id);
    storeWorkspaceId(id);
  }

  function handleWorkspaceCreated(created: WorkspaceSummary) {
    setSession((prev) => (prev ? { ...prev, workspaces: [...prev.workspaces, created] } : prev));
    selectWorkspace(created.id);
    setDialogOpen(false);
  }

  function handleWorkspaceUpdated(updated: WorkspaceSummary) {
    setSession((prev) =>
      prev
        ? { ...prev, workspaces: prev.workspaces.map((ws) => (ws.id === updated.id ? updated : ws)) }
        : prev
    );
    setDialogOpen(false);
  }

  function handleWorkspaceDeleted(deletedId: number) {
    const remaining = session?.workspaces.filter((ws) => ws.id !== deletedId) ?? [];
    setSession((prev) => (prev ? { ...prev, workspaces: remaining } : prev));
    if (activeWorkspaceId === deletedId || activeWorkspaceId === null) {
      const fallback = remaining[0]?.id ?? null;
      setActiveWorkspaceId(fallback);
      storeWorkspaceId(fallback);
    }
    setDialogOpen(false);
  }

  function openDialog(mode: WorkspaceDialogMode) {
    setDialog(mode);
    setDialogOpen(true);
  }

  const switcherProps = {
    onSelect: selectWorkspace,
    onCreate: () => openDialog({ kind: 'create' }),
    onManage: (workspace: WorkspaceSummary) => openDialog({ kind: 'edit', workspace }),
  };

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
        Memuat sesi MoneyTrack...
      </div>
    );
  }

  if (inviteToken) {
    return (
      <InviteScreen
        token={inviteToken}
        user={session?.user ?? null}
        googleEnabled={providers.googleEnabled}
        onJoined={handleInviteJoined}
        onDismiss={finishInvite}
      />
    );
  }

  if (!session) {
    return <AuthScreen providers={providers} apiOffline={apiOffline} />;
  }

  const activeWorkspace =
    session.workspaces.find((item) => item.id === activeWorkspaceId) ?? session.workspaces[0];

  return (
    <>
      {activeWorkspace ? (
        <AppShell
          key={activeWorkspace.id}
          user={session.user}
          workspaces={session.workspaces}
          workspace={activeWorkspace}
          health={health}
          healthError={healthError}
          onSelectWorkspace={selectWorkspace}
          onCreateWorkspace={switcherProps.onCreate}
          onManageWorkspace={switcherProps.onManage}
          onLogout={handleLogout}
        />
      ) : (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-500">
          Kamu belum tergabung di Workspace mana pun.
        </div>
      )}

      {dialog ? (
        <WorkspaceDialog
          key={dialog.kind === 'edit' ? `edit-${dialog.workspace.id}` : 'create'}
          mode={dialog}
          open={dialogOpen}
          currentUserId={session.user.id}
          onLeft={handleWorkspaceDeleted}
          onClose={() => setDialogOpen(false)}
          onExited={() => setDialog(null)}
          onCreated={handleWorkspaceCreated}
          onUpdated={handleWorkspaceUpdated}
          onDeleted={handleWorkspaceDeleted}
        />
      ) : null}
    </>
  );
}
