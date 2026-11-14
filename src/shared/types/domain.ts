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
}

export interface AuthSessionPayload {
  user: AuthUser;
  workspaces: WorkspaceSummary[];
}

export interface AuthProvidersPayload {
  googleEnabled: boolean;
  redirectUri: string;
}

