import type {
  InvoiceStatusType,
  ProjectStatus,
  RecurringBillItem,
  RecurringFrequencyType,
  TransactionType,
  WalletKind,
  WalletVisibilityMode,
  WorkspaceRole,
  WorkspaceType,
} from '@shared/types/domain';

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const WALLET_KIND_LABEL: Record<WalletKind, string> = {
  bank: 'Rekening Bank',
  ewallet: 'E-Wallet',
  cash: 'Tunai',
  investment: 'Investasi',
  other: 'Lainnya',
};

export const VISIBILITY_LABEL: Record<WalletVisibilityMode, { title: string; hint: string }> = {
  workspace_only: {
    title: 'Saldo saja',
    hint: 'Saldo terlihat, tapi riwayat transaksi dari Workspace lain tetap privat.',
  },
  full_transparent: {
    title: 'Transparan penuh',
    hint: 'Semua mutasi dompet ini (dari Workspace mana pun) ikut tampil di sini.',
  },
};

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
  transfer: 'Transfer',
};

export const FREQUENCY_LABEL: Record<RecurringFrequencyType, string> = {
  weekly: 'Mingguan',
  monthly: 'Bulanan',
  yearly: 'Tahunan',
};

const shortDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** "YYYY-MM-DD" → "15 Nov 2026" (tanpa pergeseran zona waktu). */
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return shortDate.format(new Date(y, m - 1, d));
}

/** Teks jatuh tempo: "Terlambat 3 hari", "Hari ini", "Besok", "5 hari lagi", atau tanggal. */
export function dueLabel(item: Pick<RecurringBillItem, 'daysUntilDue' | 'nextDueDate'>): string {
  const d = item.daysUntilDue;
  if (d < 0) return `Terlambat ${-d} hari`;
  if (d === 0) return 'Jatuh tempo hari ini';
  if (d === 1) return 'Besok';
  if (d <= 7) return `${d} hari lagi`;
  return formatDateKey(item.nextDueDate);
}

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: string }> = {
  active: { label: 'Aktif', tone: 'bg-teal-50 text-teal-700' },
  paused: { label: 'Ditunda', tone: 'bg-amber-50 text-amber-800' },
  completed: { label: 'Selesai', tone: 'bg-slate-100 text-slate-600' },
};

export const INVOICE_STATUS: Record<InvoiceStatusType, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-slate-100 text-slate-600' },
  sent: { label: 'Terkirim', tone: 'bg-sky-50 text-sky-700' },
  partial: { label: 'Dibayar sebagian', tone: 'bg-amber-50 text-amber-800' },
  paid: { label: 'Lunas', tone: 'bg-emerald-50 text-emerald-700' },
  overdue: { label: 'Jatuh tempo', tone: 'bg-rose-50 text-rose-700' },
};

export const MODE_LABEL: Record<WorkspaceType, string> = {
  personal: 'Pribadi',
  shared: 'Shared',
  business: 'Bisnis',
};
