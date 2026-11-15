import {
  ArrowLeftRight,
  BarChart3,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  HandCoins,
  History,
  LayoutDashboard,
  Menu as MenuIcon,
  LogOut,
  Moon,
  PiggyBank,
  Plus,
  Sun,
  Tags,
  Target,
  Wallet,
} from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { InstallAppButton, OfflineBanner } from '@client/components/PwaControls';
import {
  TransactionDialog,
  type TransactionPrefill,
} from '@client/components/TransactionDialog';
import { UserAvatar } from '@client/components/UserAvatar';
import { AppearanceBadge, workspaceAppearance } from '@client/lib/appearance';
import { WalletDialog, type WalletDialogMode } from '@client/components/WalletDialog';
import { WorkspaceSwitcher } from '@client/components/WorkspaceSwitcher';
import { MODE_LABEL, ROLE_LABEL } from '@client/lib/labels';
import { setAmountsHidden, useAmountsHidden } from '@client/lib/privacy';
import { switchThemeAnimated, useTheme } from '@client/lib/theme';
import { useApi } from '@client/lib/useApi';
import { BudgetPage } from '@client/pages/BudgetPage';
import { CategoriesPage } from '@client/pages/CategoriesPage';
import { DashboardPage } from '@client/pages/DashboardPage';
import { AuditLogPage } from '@client/pages/AuditLogPage';
import { GoalsPage } from '@client/pages/GoalsPage';
import { InvoicesPage } from '@client/pages/InvoicesPage';
import { ProjectsPage } from '@client/pages/ProjectsPage';
import { RecurringPage } from '@client/pages/RecurringPage';
import { ReportsPage } from '@client/pages/ReportsPage';
import { SharedCashPage } from '@client/pages/SharedCashPage';
import { TransactionsPage } from '@client/pages/TransactionsPage';
import { WalletsPage } from '@client/pages/WalletsPage';
import type {
  AuthUser,
  CategoryItem,
  HealthStatus,
  InvoiceItem,
  ProjectItem,
  RecurringBillItem,
  TransactionItem,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';
import { canRecordTransactions } from '@shared/utils/permissions';

type View =
  | 'dashboard'
  | 'transactions'
  | 'wallets'
  | 'shared'
  | 'business'
  | 'invoices'
  | 'budget'
  | 'goals'
  | 'recurring'
  | 'categories'
  | 'audit'
  | 'reports'
  | 'menu';

const VIEW_TITLE: Record<View, string> = {
  dashboard: 'Beranda',
  transactions: 'Transaksi',
  wallets: 'Dompet',
  shared: 'Kas Bersama',
  business: 'Project & Klien',
  invoices: 'Invoice',
  budget: 'Budget',
  goals: 'Target Tabungan',
  recurring: 'Tagihan Rutin',
  categories: 'Kategori',
  audit: 'Audit Log',
  reports: 'Laporan',
  menu: 'Menu',
};

/** Menu utama (sidebar desktop). Di HP, tiga pertama ada di bottom nav dan sisanya di halaman Menu. */
type NavGroup = 'main' | 'business' | 'collab' | 'planning' | 'settings';

/** Urutan & label grup menu di sidebar desktop; grup tanpa item yang tampil disembunyikan. */
const NAV_GROUPS: Array<{ id: NavGroup; label: string }> = [
  { id: 'main', label: 'Utama' },
  { id: 'business', label: 'Bisnis' },
  { id: 'collab', label: 'Kolaborasi' },
  { id: 'planning', label: 'Perencanaan' },
  { id: 'settings', label: 'Pengaturan' },
];

type NavItemDef = {
  view: View;
  icon: typeof Wallet;
  label: string;
  group: NavGroup;
  /** Hanya untuk Workspace multi-anggota (shared/business). */
  sharedOnly?: boolean;
  /** Hanya untuk Workspace bisnis. */
  businessOnly?: boolean;
};

const NAV: NavItemDef[] = [
  { view: 'dashboard', icon: LayoutDashboard, label: 'Beranda', group: 'main' },
  { view: 'transactions', icon: ArrowLeftRight, label: 'Transaksi', group: 'main' },
  { view: 'wallets', icon: Wallet, label: 'Dompet', group: 'main' },
  { view: 'reports', icon: BarChart3, label: 'Laporan', group: 'main' },
  { view: 'business', icon: FolderKanban, label: 'Project & Klien', group: 'business', businessOnly: true },
  { view: 'invoices', icon: FileText, label: 'Invoice', group: 'business', businessOnly: true },
  { view: 'shared', icon: HandCoins, label: 'Kas Bersama & Split', group: 'collab', sharedOnly: true },
  { view: 'budget', icon: PiggyBank, label: 'Budget', group: 'planning' },
  { view: 'goals', icon: Target, label: 'Target Tabungan', group: 'planning' },
  { view: 'recurring', icon: BellRing, label: 'Tagihan Rutin', group: 'planning' },
  { view: 'categories', icon: Tags, label: 'Kategori', group: 'settings' },
  { view: 'audit', icon: History, label: 'Audit Log', group: 'settings' },
];

const BOTTOM_VIEWS: View[] = ['dashboard', 'transactions', 'wallets'];



interface AppShellProps {
  user: AuthUser;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary;
  health: HealthStatus | null;
  healthError: string | null;
  onSelectWorkspace: (id: number) => void;
  onCreateWorkspace: () => void;
  onManageWorkspace: (workspace: WorkspaceSummary) => void;
  onLogout: () => void;
}

type TxDialogState = { seq: number; transactionId: number | null; prefill?: TransactionPrefill };

export function AppShell({
  user,
  workspaces,
  workspace,
  health,
  healthError,
  onSelectWorkspace,
  onCreateWorkspace,
  onManageWorkspace,
  onLogout,
}: AppShellProps) {
  const [view, setView] = useState<View>('dashboard');
  // Berlangganan di sini: saat mode privasi berubah, seluruh halaman & dialog di bawah ikut render ulang.
  const amountsHidden = useAmountsHidden();
  const theme = useTheme();
  // Ikon tombol tema baru berganti setelah animasi lingkaran selesai; selama animasi tombol dinonaktifkan.
  const [themeIcon, setThemeIcon] = useState(theme);
  const [switchingTheme, setSwitchingTheme] = useState(false);
  useEffect(() => {
    if (!switchingTheme) setThemeIcon(theme); // mis. tema ikut berubah karena pengaturan sistem
  }, [theme, switchingTheme]);

  async function toggleTheme(button: HTMLElement) {
    if (switchingTheme) return;
    setSwitchingTheme(true);
    await switchThemeAnimated(theme === 'dark' ? 'light' : 'dark', button);
    setSwitchingTheme(false);
  }
  const [dataVersion, setDataVersion] = useState(0);
  // Dialog tetap terisi selama animasi tutup; flag `*Open` yang memicu animasinya.
  const [txDialog, setTxDialog] = useState<TxDialogState | null>(null);
  const [txOpen, setTxOpen] = useState(false);
  const [walletDialog, setWalletDialog] = useState<WalletDialogMode | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

  const walletsApi = useApi<WorkspaceWallet[]>(`/api/workspaces/${workspace.id}/wallets`, dataVersion);
  const categoriesApi = useApi<CategoryItem[]>(`/api/workspaces/${workspace.id}/categories`, dataVersion);
  const wallets = walletsApi.data ?? [];
  const categories = categoriesApi.data ?? [];
  const canRecord = canRecordTransactions(workspace.role);
  // Kas bersama & split bill hanya relevan untuk Workspace multi-anggota (shared/business).
  const isBusiness = workspace.type === 'business';
  const navItems = NAV.filter(
    (item) => (!item.sharedOnly || workspace.type !== 'personal') && (!item.businessOnly || isBusiness)
  );
  // Project aktif untuk dipilih di form transaksi (mode bisnis saja).
  const projectsApi = useApi<ProjectItem[]>(isBusiness ? `/api/workspaces/${workspace.id}/projects` : null, dataVersion);
  const projectOptions = (projectsApi.data ?? []).filter((p) => p.status !== 'completed');

  // Halaman "Menu" hanya ada di HP; kembali ke beranda bila layar melebar.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (query.matches) setView((v) => (v === 'menu' ? 'dashboard' : v));
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const bumpData = () => setDataVersion((v) => v + 1);

  // Shortcut PWA "Catat Transaksi" (manifest → /?action=catat): langsung buka form, lalu bersihkan URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'catat') return;
    window.history.replaceState({}, '', window.location.pathname);
    if (canRecord) openTransaction({ transactionId: null });
    // Hanya saat pertama kali dimuat.
  }, []);

  function openTransaction(state: Omit<TxDialogState, 'seq'>) {
    setTxDialog((prev) => ({ ...state, seq: (prev?.seq ?? 0) + 1 }));
    setTxOpen(true);
  }

  function openWalletDialog(mode: WalletDialogMode) {
    setWalletDialog(mode);
    setWalletOpen(true);
  }

  const openItem = (item: TransactionItem) => openTransaction({ transactionId: item.id });
  const recordInvoicePayment = (invoice: InvoiceItem) =>
    openTransaction({
      transactionId: null,
      prefill: {
        type: 'income',
        amountMinor: Math.max(0, invoice.amountMinor - invoice.paidMinor),
        title: `Pembayaran ${invoice.number}${invoice.client ? ` – ${invoice.client.name}` : ''}`,
        projectId: invoice.project?.id ?? null,
        invoice: { id: invoice.id, number: invoice.number },
      },
    });
  const payBill = (bill: RecurringBillItem) =>
    openTransaction({
      transactionId: null,
      prefill: {
        type: bill.type,
        amountMinor: bill.amountMinor,
        title: bill.title,
        walletId: bill.wallet?.id ?? null,
        categoryId: bill.category?.id ?? null,
        recurringBill: { id: bill.id, title: bill.title, nextDueDate: bill.nextDueDate },
      },
    });
  const switcher = (
    <WorkspaceSwitcher
      workspaces={workspaces}
      activeId={workspace.id}
      onSelect={(id) => {
        onSelectWorkspace(id);
        if (view === 'menu') setView('dashboard');
      }}
      onCreate={onCreateWorkspace}
      onManage={onManageWorkspace}
    />
  );

  return (
    <>
    <OfflineBanner />
    <div className="min-h-screen bg-slate-50 pb-24 md:flex md:pb-0 print:bg-white print:pb-0">
      {/* Sidebar Desktop */}
      <aside className="sticky top-0 hidden h-screen print:hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <div className="flex items-center gap-2.5 px-1">
            <img src="/icon.svg" alt="" className="h-9 w-9 rounded-xl" />
            <div>
              <p className="text-base font-bold tracking-tight text-slate-900">MoneyTrack</p>
              <p className="text-xs text-slate-500">Multi-Mode Finance</p>
            </div>
          </div>

          {switcher}

          <nav aria-label="Menu utama" className="space-y-5">
            {NAV_GROUPS.map((group) => {
              const items = navItems.filter((item) => item.group === group.id);
              if (items.length === 0) return null;
              const headingId = `nav-group-${group.id}`;
              return (
                <div key={group.id} role="group" aria-labelledby={headingId} className="space-y-1">
                  <p id={headingId} className="px-2 pb-1 text-xs font-semibold tracking-wider text-slate-400 uppercase">
                    {group.label}
                  </p>
                  {items.map((item) => (
                    <NavItem
                      key={item.view}
                      icon={item.icon}
                      label={item.label}
                      active={view === item.view}
                      onClick={() => setView(item.view)}
                    />
                  ))}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 border-t border-slate-100 p-4">
          <InstallAppButton />
          <div className="flex items-center gap-2.5">
            <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate font-semibold text-slate-900">{user.name}</p>
              <p className="truncate text-slate-500">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              title="Keluar"
              aria-label="Keluar"
              className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Konten */}
      <div className="min-w-0 flex-1">
        {/* Padding horizontal di DALAM kotak max-w-5xl (sama seperti <main>) agar tepi kiri/kanan sejajar dengan konten. */}
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 py-3 backdrop-blur-sm print:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setView('menu')}
              className="flex min-w-0 items-center gap-2.5 text-left md:pointer-events-none"
            >
              {/* Di HP, identitas Workspace aktif (ikon & warna kustom) menggantikan logo aplikasi. */}
              <AppearanceBadge appearance={workspaceAppearance(workspace)} size="sm" className="md:hidden" />
              <span className="min-w-0">
                <span className="block truncate text-base font-bold text-slate-900">
                  <span className="md:hidden">{workspace.name}</span>
                  <span className="hidden md:inline">{VIEW_TITLE[view]}</span>
                </span>
                <span className="block truncate text-xs text-slate-500">
                  <span className="md:hidden">
                    {VIEW_TITLE[view]} · {ROLE_LABEL[workspace.role]}
                  </span>
                  <span className="hidden md:inline">
                    {workspace.name} · {MODE_LABEL[workspace.type]} · {ROLE_LABEL[workspace.role]}
                  </span>
                </span>
              </span>
            </button>

            <div className="flex shrink-0 items-center gap-2">
              {health ? (
                <span
                  title={health.database === 'connected' ? 'API & MySQL terhubung' : 'Database bermasalah'}
                  className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                    health.database === 'connected'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {health.database === 'connected' ? 'Online' : 'Cek DB'}
                </span>
              ) : (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                  {healthError ?? 'Menghubungkan...'}
                </span>
              )}
              <HeaderIconButton
                onClick={(event) => void toggleTheme(event.currentTarget)}
                label={themeIcon === 'dark' ? 'Mode terang' : 'Mode gelap'}
                disabled={switchingTheme}
              >
                {themeIcon === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
              </HeaderIconButton>
              <HeaderIconButton
                onClick={() => setAmountsHidden(!amountsHidden)}
                label={amountsHidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
                pressed={amountsHidden}
              >
                {amountsHidden ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
              </HeaderIconButton>
              {canRecord ? (
                <button
                  type="button"
                  onClick={() => openTransaction({ transactionId: null })}
                  className="hidden h-10 items-center gap-1.5 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 md:inline-flex"
                >
                  <Plus className="h-4 w-4" /> Catat
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setView('menu')}
                aria-label="Profil & menu"
                className="rounded-full md:hidden"
              >
                <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl p-4 sm:p-6">
          {walletsApi.error ? (
            <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {walletsApi.error}
            </p>
          ) : null}

          {view === 'dashboard' ? (
            <DashboardPage
              workspace={workspace}
              wallets={wallets}
              dataVersion={dataVersion}
              onQuickAdd={(prefill) => openTransaction({ transactionId: null, prefill })}
              onOpenTransaction={openItem}
              onShowTransactions={() => setView('transactions')}
              onShowWallets={() => setView('wallets')}
              onAddWallet={() => openWalletDialog({ kind: 'create' })}
              onPayBill={payBill}
              onShowBudget={() => setView('budget')}
              onShowRecurring={() => setView('recurring')}
            />
          ) : view === 'transactions' ? (
            <TransactionsPage
              workspace={workspace}
              wallets={wallets}
              categories={categories}
              dataVersion={dataVersion}
              onOpenTransaction={openItem}
            />
          ) : view === 'wallets' ? (
            <WalletsPage
              workspace={workspace}
              wallets={wallets}
              loading={walletsApi.loading}
              onCreate={() => openWalletDialog({ kind: 'create' })}
              onLink={() => openWalletDialog({ kind: 'link' })}
              onManage={(wallet) => openWalletDialog({ kind: 'manage', wallet })}
            />
          ) : view === 'reports' ? (
            <ReportsPage workspace={workspace} dataVersion={dataVersion} />
          ) : view === 'business' ? (
            <ProjectsPage workspace={workspace} dataVersion={dataVersion} onChanged={bumpData} />
          ) : view === 'invoices' ? (
            <InvoicesPage
              workspace={workspace}
              dataVersion={dataVersion}
              onRecordPayment={recordInvoicePayment}
              onChanged={bumpData}
            />
          ) : view === 'shared' ? (
            <SharedCashPage workspace={workspace} currentUserId={user.id} dataVersion={dataVersion} onChanged={bumpData} />
          ) : view === 'audit' ? (
            <AuditLogPage workspace={workspace} dataVersion={dataVersion} />
          ) : view === 'budget' ? (
            <BudgetPage workspace={workspace} dataVersion={dataVersion} onChanged={bumpData} />
          ) : view === 'goals' ? (
            <GoalsPage workspace={workspace} dataVersion={dataVersion} onChanged={bumpData} />
          ) : view === 'recurring' ? (
            <RecurringPage
              workspace={workspace}
              wallets={wallets}
              categories={categories}
              dataVersion={dataVersion}
              onPay={payBill}
              onChanged={bumpData}
            />
          ) : view === 'categories' ? (
            <CategoriesPage workspace={workspace} categories={categories} onChanged={bumpData} />
          ) : (
            <div className="space-y-6 md:hidden">
              <InstallAppButton variant="menu" />
              <section
                aria-label="Profil"
                className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center"
              >
                <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="xl" />
                <div className="w-full min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900">{user.name}</p>
                  <p className="truncate text-sm text-slate-500">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" /> Keluar
                </button>
              </section>
              <nav aria-label="Menu lainnya" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {navItems.filter((item) => !BOTTOM_VIEWS.includes(item.view)).map((item) => (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => setView(item.view)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left text-sm font-medium text-slate-800 last:border-b-0 hover:bg-slate-50"
                  >
                    <item.icon className="h-5 w-5 text-slate-500" />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                ))}
              </nav>
              {switcher}
            </div>
          )}
        </main>
      </div>

      {txDialog ? (
        <TransactionDialog
          key={txDialog.seq}
          open={txOpen}
          onClose={() => setTxOpen(false)}
          onExited={() => setTxDialog(null)}
          workspace={workspace}
          wallets={wallets}
          categories={categories}
          projects={projectOptions}
          transactionId={txDialog.transactionId}
          prefill={txDialog.prefill}
          onChanged={bumpData}
        />
      ) : null}

      {walletDialog ? (
        <WalletDialog
          key={walletDialog.kind === 'manage' ? `manage-${walletDialog.wallet.id}` : walletDialog.kind}
          mode={walletDialog}
          open={walletOpen}
          onClose={() => setWalletOpen(false)}
          onExited={() => setWalletDialog(null)}
          workspace={workspace}
          onChanged={bumpData}
        />
      ) : null}

      {/* Bottom Nav Mobile */}
      <nav
        aria-label="Menu utama"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 print:hidden items-end border-t border-slate-200 bg-white/95 px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden"
      >
        <BottomItem icon={LayoutDashboard} label="Beranda" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
        <BottomItem
          icon={ArrowLeftRight}
          label="Transaksi"
          active={view === 'transactions'}
          onClick={() => setView('transactions')}
        />
        <div className="flex justify-center">
          <button
            type="button"
            aria-label="Catat transaksi"
            disabled={!canRecord}
            onClick={() => openTransaction({ transactionId: null })}
            className="-mt-7 flex h-13 w-13 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg shadow-teal-700/30 transition active:scale-95 disabled:bg-slate-300 disabled:shadow-none"
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>
        <BottomItem icon={Wallet} label="Dompet" active={view === 'wallets'} onClick={() => setView('wallets')} />
        <BottomItem icon={MenuIcon} label="Menu" active={!BOTTOM_VIEWS.includes(view)} onClick={() => setView('menu')} />
      </nav>
    </div>
    </>
  );
}

/** Tombol ikon persegi di topbar, setinggi tombol "Catat" (h-10). */
function HeaderIconButton({
  onClick,
  label,
  pressed,
  disabled = false,
  children,
}: {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  label: string;
  /** Diisi untuk tombol toggle (aria-pressed). */
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition disabled:opacity-60 ${
        pressed
          ? 'border-teal-200 bg-teal-50 text-teal-700'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Wallet;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function BottomItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Wallet;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center gap-0.5 py-1 text-[11px] ${
        active ? 'font-semibold text-teal-700' : 'text-slate-500'
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
