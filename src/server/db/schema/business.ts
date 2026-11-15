import { bigint, datetime, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { createdAtColumn, defaultNowDatetime } from '@server/db/schema/helpers';
import { workspaces } from '@server/db/schema/workspaces';

export const clients = mysqlTable('clients', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 140 }).notNull(),
  email: varchar('email', { length: 191 }),
  phone: varchar('phone', { length: 40 }),
  company: varchar('company', { length: 140 }),
  notes: text('notes'),
  createdAt: createdAtColumn(),
});

export const projects = mysqlTable('projects', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  clientId: bigint('client_id', { mode: 'number', unsigned: true }).references(() => clients.id, {
    onDelete: 'set null',
  }),
  name: varchar('name', { length: 160 }).notNull(),
  status: mysqlEnum('status', ['active', 'completed', 'paused']).notNull().default('active'),
  budgetMinor: bigint('budget_minor', { mode: 'number' }).default(0).notNull(),
  createdAt: createdAtColumn(),
});

export const invoices = mysqlTable(
  'invoices',
  {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  clientId: bigint('client_id', { mode: 'number', unsigned: true }).references(() => clients.id, {
    onDelete: 'set null',
  }),
  projectId: bigint('project_id', { mode: 'number', unsigned: true }).references(() => projects.id, {
    onDelete: 'set null',
  }),
  invoiceNumber: varchar('invoice_number', { length: 60 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  paidMinor: bigint('paid_minor', { mode: 'number' }).notNull().default(0),
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('IDR'),
  status: mysqlEnum('status', ['draft', 'sent', 'partial', 'paid', 'overdue'])
    .notNull()
    .default('draft'),
  dueDate: datetime('due_date', { mode: 'date' }),
  issuedAt: defaultNowDatetime('issued_at'),
  createdAt: createdAtColumn(),
  },
  // Nomor invoice unik per Workspace.
  (table) => [uniqueIndex('uq_invoice_number').on(table.workspaceId, table.invoiceNumber)]
);
