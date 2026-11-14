import {
  bigint,
  boolean,
  datetime,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from '@server/db/schema/auth';
import {
  createdAtColumn,
  currentTimestamp,
  defaultNowDatetime,
  updatedAtColumn,
} from '@server/db/schema/helpers';
import { workspaces } from '@server/db/schema/workspaces';

export const wallets = mysqlTable('wallets', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  ownerUserId: bigint('owner_user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  walletKind: mysqlEnum('wallet_kind', ['cash', 'bank', 'ewallet', 'investment', 'other'])
    .notNull()
    .default('bank'),
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('IDR'),
  balanceMinor: bigint('balance_minor', { mode: 'number' }).notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const workspaceWallets = mysqlTable(
  'workspace_wallets',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    walletId: bigint('wallet_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    visibilityMode: mysqlEnum('visibility_mode', ['workspace_only', 'full_transparent'])
      .notNull()
      .default('workspace_only'),
    linkedByUserId: bigint('linked_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    linkedAt: currentTimestamp('linked_at'),
  },
  (table) => [uniqueIndex('uq_workspace_wallet').on(table.workspaceId, table.walletId)]
);

export const categories = mysqlTable('categories', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  type: mysqlEnum('type', ['income', 'expense']).notNull(),
  color: varchar('color', { length: 20 }).notNull().default('#0ea5e9'),
  icon: varchar('icon', { length: 40 }).notNull().default('tag'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAtColumn(),
});

export const recurringBills = mysqlTable('recurring_bills', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  walletId: bigint('wallet_id', { mode: 'number', unsigned: true }).references(() => wallets.id, {
    onDelete: 'set null',
  }),
  categoryId: bigint('category_id', { mode: 'number', unsigned: true }).references(
    () => categories.id,
    { onDelete: 'set null' }
  ),
  title: varchar('title', { length: 140 }).notNull(),
  type: mysqlEnum('type', ['income', 'expense']).notNull().default('expense'),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('IDR'),
  frequency: mysqlEnum('frequency', ['weekly', 'monthly', 'yearly']).notNull().default('monthly'),
  nextDueDate: datetime('next_due_date', { mode: 'date' }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAtColumn(),
});

export const transactions = mysqlTable('transactions', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  walletId: bigint('wallet_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => wallets.id, { onDelete: 'restrict' }),
  transferTargetWalletId: bigint('transfer_target_wallet_id', {
    mode: 'number',
    unsigned: true,
  }).references(() => wallets.id, { onDelete: 'restrict' }),
  categoryId: bigint('category_id', { mode: 'number', unsigned: true }).references(
    () => categories.id,
    { onDelete: 'set null' }
  ),
  createdByUserId: bigint('created_by_user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  type: mysqlEnum('type', ['income', 'expense', 'transfer']).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('IDR'),
  exchangeRateToWorkspace: decimal('exchange_rate_to_workspace', { precision: 18, scale: 6 })
    .notNull()
    .default('1.000000'),
  convertedAmountMinor: bigint('converted_amount_minor', { mode: 'number' }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  notes: text('notes'),
  occurredAt: defaultNowDatetime('occurred_at'),
  projectId: bigint('project_id', { mode: 'number', unsigned: true }),
  invoiceId: bigint('invoice_id', { mode: 'number', unsigned: true }),
  recurringBillId: bigint('recurring_bill_id', { mode: 'number', unsigned: true }).references(
    () => recurringBills.id,
    { onDelete: 'set null' }
  ),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const receipts = mysqlTable('receipts', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  transactionId: bigint('transaction_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  uploadedByUserId: bigint('uploaded_by_user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  storagePath: varchar('storage_path', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 80 }).notNull(),
  sizeBytes: int('size_bytes', { unsigned: true }).notNull(),
  createdAt: createdAtColumn(),
});

export const budgets = mysqlTable(
  'budgets',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: bigint('category_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    monthKey: varchar('month_key', { length: 7 }).notNull(),
    limitMinor: bigint('limit_minor', { mode: 'number' }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [uniqueIndex('uq_budget_category_month').on(table.workspaceId, table.categoryId, table.monthKey)]
);

export const goals = mysqlTable('goals', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  targetMinor: bigint('target_minor', { mode: 'number' }).notNull(),
  currentMinor: bigint('current_minor', { mode: 'number' }).notNull().default(0),
  deadlineAt: datetime('deadline_at', { mode: 'date' }),
  createdAt: createdAtColumn(),
});

export const splitExpenses = mysqlTable('split_expenses', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  transactionId: bigint('transaction_id', { mode: 'number', unsigned: true }).references(
    () => transactions.id,
    { onDelete: 'set null' }
  ),
  paidByUserId: bigint('paid_by_user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 160 }).notNull(),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('IDR'),
  occurredAt: defaultNowDatetime('occurred_at'),
  createdAt: createdAtColumn(),
});

export const splitParticipants = mysqlTable(
  'split_participants',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    splitExpenseId: bigint('split_expense_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => splitExpenses.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    owedMinor: bigint('owed_minor', { mode: 'number' }).notNull(),
    settledMinor: bigint('settled_minor', { mode: 'number' }).notNull().default(0),
    isSettled: boolean('is_settled').notNull().default(false),
    settledAt: datetime('settled_at', { mode: 'date' }),
  },
  (table) => [uniqueIndex('uq_split_participant').on(table.splitExpenseId, table.userId)]
);
