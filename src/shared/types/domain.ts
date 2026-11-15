export const WORKSPACE_TYPES = ['personal', 'shared', 'business'] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WALLET_VISIBILITY_MODES = ['workspace_only', 'full_transparent'] as const;
export type WalletVisibilityMode = (typeof WALLET_VISIBILITY_MODES)[number];

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const CURRENCY_CODES = ['IDR', 'USD', 'SGD', 'MYR', 'EUR'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface QuickParseResult {
  raw: string;
  type: 'income' | 'expense';
  amount: number | null;
  currency: CurrencyCode;
  description: string;
  walletHint: string | null;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface HealthStatus {
  status: 'ok';
  app: string;
  timestamp: string;
  database: 'connected' | 'not_configured' | 'error';
  databaseMessage?: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface WorkspaceSummary {
  id: number;
  name: string;
  type: WorkspaceType;
  primaryCurrency: CurrencyCode;
  role: WorkspaceRole;
  /** Kunci ikon (`APPEARANCE_ICONS`); null = bawaan sesuai mode. */
  icon: string | null;
  /** Hex #RRGGBB; null = bawaan sesuai mode. */
  color: string | null;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  memberCount: number;
  categoryCount: number;
  createdAt: string;
}

/** Role yang bisa diberikan lewat undangan (owner tidak bisa diundang). */
export const INVITABLE_ROLES = ['admin', 'member', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface WorkspaceMember {
  userId: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceInvite {
  id: number;
  role: InvitableRole;
  /** Bila diisi, hanya akun dengan email ini yang bisa menerima undangan. */
  email: string | null;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

/** Dikembalikan sekali saat undangan dibuat — token asli tidak disimpan di server. */
export interface CreatedWorkspaceInvite extends WorkspaceInvite {
  inviteUrl: string;
}

export interface InvitePreview {
  workspaceName: string;
  workspaceType: WorkspaceType;
  role: InvitableRole;
  invitedByName: string;
  email: string | null;
  expiresAt: string;
  status: 'pending' | 'expired' | 'used';
}

export interface AcceptInvitePayload {
  workspace: WorkspaceSummary;
  /** true bila user sudah anggota — undangan tidak dipakai dan tetap berlaku untuk orang lain. */
  alreadyMember: boolean;
}

export const WALLET_KINDS = ['cash', 'bank', 'ewallet', 'investment', 'other'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

/** Dompet yang tertaut ke sebuah Workspace (dilihat dari dalam Workspace tersebut). */
export interface WorkspaceWallet {
  id: number;
  name: string;
  kind: WalletKind;
  currency: CurrencyCode;
  balanceMinor: number;
  visibilityMode: WalletVisibilityMode;
  ownerName: string;
  isMine: boolean;
  /** null = bawaan sesuai jenis dompet. */
  icon: string | null;
  color: string | null;
}

/** Dompet milik user aktif beserta Workspace tempat dompet itu ditautkan. */
export interface MyWallet {
  id: number;
  name: string;
  kind: WalletKind;
  currency: CurrencyCode;
  balanceMinor: number;
  icon: string | null;
  color: string | null;
  linkedWorkspaces: Array<{ id: number; name: string; visibilityMode: WalletVisibilityMode }>;
}

export interface CategoryItem {
  id: number;
  name: string;
  type: 'income' | 'expense';
  color: string;
  icon: string;
}

export interface ReceiptItem {
  id: number;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Endpoint privat (butuh session + keanggotaan Workspace). */
  url: string;
}

export interface TransactionItem {
  id: number;
  type: TransactionType;
  /** Nominal dalam mata uang dompet sumber. */
  amountMinor: number;
  currency: CurrencyCode;
  exchangeRate: string;
  /** Nominal dalam mata uang utama Workspace tempat transaksi dicatat. */
  convertedAmountMinor: number;
  title: string;
  notes: string | null;
  occurredAt: string;
  wallet: { id: number; name: string };
  targetWallet: { id: number; name: string } | null;
  category: { id: number; name: string; color: string; icon: string } | null;
  createdBy: { id: number; name: string };
  /** Mode bisnis: project tempat transaksi ini dihitung, dan invoice yang dibayar (khusus pemasukan). */
  project: { id: number; name: string } | null;
  invoice: { id: number; number: string } | null;
  receiptCount: number;
  /** Diisi bila transaksi berasal dari Workspace lain lewat dompet `full_transparent` (baca saja). */
  sourceWorkspaceName: string | null;
  canEdit: boolean;
}

export interface TransactionDetail extends TransactionItem {
  receipts: ReceiptItem[];
}

export interface TransactionPage {
  items: TransactionItem[];
  /** ID untuk memuat halaman berikutnya (`?before=`), null bila sudah habis. */
  nextCursor: number | null;
}

export interface BudgetItem {
  categoryId: number;
  name: string;
  color: string;
  icon: string;
  /** null = kategori belum diberi batas bulan ini. */
  limitMinor: number | null;
  spentMinor: number;
}

export interface BudgetOverview {
  month: string;
  currency: CurrencyCode;
  items: BudgetItem[];
  totalLimitMinor: number;
  /** Pengeluaran pada kategori yang punya budget. */
  totalBudgetedSpentMinor: number;
  /** Pengeluaran tanpa budget (kategori tanpa batas + tanpa kategori). */
  unbudgetedSpentMinor: number;
}

export interface GoalItem {
  id: number;
  name: string;
  currency: CurrencyCode;
  targetMinor: number;
  currentMinor: number;
  /** `YYYY-MM-DD` atau null. */
  deadline: string | null;
  /** Setoran per bulan yang dibutuhkan agar target tercapai tepat waktu (null bila tanpa tenggat/sudah tercapai). */
  monthlyNeededMinor: number | null;
  createdAt: string;
}

export interface GoalContribution {
  id: number;
  amountMinor: number;
  note: string | null;
  actorName: string;
  createdAt: string;
}

export type RecurringFrequencyType = 'weekly' | 'monthly' | 'yearly';
export type DueStatusType = 'overdue' | 'due_today' | 'due_soon' | 'upcoming';

export interface RecurringBillItem {
  id: number;
  title: string;
  type: 'income' | 'expense';
  amountMinor: number;
  currency: CurrencyCode;
  frequency: RecurringFrequencyType;
  /** `YYYY-MM-DD` */
  nextDueDate: string;
  isActive: boolean;
  wallet: { id: number; name: string } | null;
  category: { id: number; name: string; color: string } | null;
  dueStatus: DueStatusType;
  /** Selisih hari ke jatuh tempo (negatif = terlambat). */
  daysUntilDue: number;
}

export interface SplitParticipantItem {
  userId: number;
  name: string;
  owedMinor: number;
  isSettled: boolean;
  settledAt: string | null;
}

export interface SplitItem {
  id: number;
  title: string;
  totalMinor: number;
  currency: CurrencyCode;
  occurredAt: string;
  paidBy: { id: number; name: string };
  participants: SplitParticipantItem[];
  /** Total porsi peserta lain yang belum dilunasi ke pembayar. */
  outstandingMinor: number;
  canDelete: boolean;
}

export interface SettlementSuggestion {
  from: { id: number; name: string };
  to: { id: number; name: string };
  amountMinor: number;
  /** true bila user aktif boleh menandai lunas (penerima uang atau admin). */
  canSettle: boolean;
}

export interface MemberContribution {
  userId: number;
  name: string;
  role: WorkspaceRole;
  /** Pemasukan & pengeluaran yang dicatat anggota ini pada bulan tersebut (mata uang Workspace). */
  incomeMinor: number;
  expenseMinor: number;
  /** Total split bill yang ditalangi anggota ini pada bulan tersebut. */
  splitPaidMinor: number;
  /** Posisi utang-piutang split yang belum lunas (semua waktu): + akan menerima, − harus membayar. */
  splitNetMinor: number;
}

export interface SharedCashSummary {
  month: string;
  currency: CurrencyCode;
  members: MemberContribution[];
  settlements: SettlementSuggestion[];
}

export interface AuditLogItem {
  id: number;
  action: 'create' | 'update' | 'delete' | 'settle';
  entityType: string;
  entityId: number;
  actor: { id: number; name: string };
  /** Kalimat ringkas berbahasa Indonesia, mis. "mencatat pengeluaran Makan siang Rp25.000". */
  summary: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  nextCursor: number | null;
}

export interface ClientItem {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  projectCount: number;
  /** Total nilai invoice (selain draft), terbayar, dan sisa piutang. */
  invoicedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  /** Pemasukan − biaya dari transaksi project klien ini / invoice klien ini. */
  profitMinor: number;
}

export type ProjectStatus = 'active' | 'completed' | 'paused';

export interface ProjectItem {
  id: number;
  name: string;
  status: ProjectStatus;
  /** Estimasi anggaran biaya project (0 = tanpa anggaran). */
  budgetMinor: number;
  client: { id: number; name: string } | null;
  incomeMinor: number;
  expenseMinor: number;
  profitMinor: number;
  createdAt: string;
}

export type InvoiceStatusType = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue';

export interface InvoiceItem {
  id: number;
  number: string;
  title: string;
  amountMinor: number;
  paidMinor: number;
  currency: CurrencyCode;
  /** Status tampilan (`overdue` dihitung dari jatuh tempo). */
  status: InvoiceStatusType;
  /** `YYYY-MM-DD` */
  issuedAt: string;
  dueDate: string | null;
  client: { id: number; name: string } | null;
  project: { id: number; name: string } | null;
  paymentCount: number;
}

export interface ReportSummary {
  /** `YYYY-MM-DD` (inklusif) */
  from: string;
  to: string;
  currency: CurrencyCode;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  transactionCount: number;
  categories: Array<{
    type: 'income' | 'expense';
    categoryId: number | null;
    name: string;
    color: string;
    icon: string;
    totalMinor: number;
    count: number;
  }>;
  wallets: Array<{ id: number; name: string; incomeMinor: number; expenseMinor: number }>;
  projects: Array<{ id: number; name: string; incomeMinor: number; expenseMinor: number }>;
}

export interface TrendPoint {
  /** `YYYY-MM` */
  month: string;
  incomeMinor: number;
  expenseMinor: number;
}

export interface WorkspaceOverview {
  month: string;
  primaryCurrency: CurrencyCode;
  incomeMinor: number;
  expenseMinor: number;
  /** Total saldo dompet bermata uang sama dengan mata uang utama Workspace. */
  totalBalanceMinor: number;
  /** Jumlah dompet bermata uang lain (tidak dijumlahkan ke total). */
  otherCurrencyWallets: number;
  walletCount: number;
  recent: TransactionItem[];
  /** Tagihan rutin aktif yang terlambat / jatuh tempo ≤ 7 hari. */
  dueBills: RecurringBillItem[];
  /** Budget bulan ini yang sudah ≥ 80% atau terlampaui. */
  budgetAlerts: BudgetItem[];
}

export interface AuthSessionPayload {
  user: AuthUser;
  workspaces: WorkspaceSummary[];
}

export interface AuthProvidersPayload {
  googleEnabled: boolean;
  redirectUri: string;
}

