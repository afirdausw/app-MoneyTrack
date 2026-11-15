import {
  bigint,
  datetime,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from '@server/db/schema/auth';
import { createdAtColumn, currentTimestamp, updatedAtColumn } from '@server/db/schema/helpers';

export const workspaces = mysqlTable('workspaces', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  type: mysqlEnum('type', ['personal', 'shared', 'business']).notNull().default('personal'),
  primaryCurrency: varchar('primary_currency', { length: 10 }).notNull().default('IDR'),
  /** Kustomisasi tampilan; NULL = ikon/warna bawaan sesuai mode. */
  icon: varchar('icon', { length: 40 }),
  color: varchar('color', { length: 20 }),
  createdByUserId: bigint('created_by_user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const workspaceMembers = mysqlTable(
  'workspace_members',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', ['owner', 'admin', 'member', 'viewer']).notNull().default('member'),
    joinedAt: currentTimestamp('joined_at'),
  },
  (table) => [uniqueIndex('uq_workspace_member').on(table.workspaceId, table.userId)]
);

export const workspaceInvites = mysqlTable(
  'workspace_invites',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    invitedByUserId: bigint('invited_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 191 }),
    role: mysqlEnum('role', ['admin', 'member', 'viewer']).notNull().default('member'),
    token: varchar('token', { length: 128 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
    acceptedAt: datetime('accepted_at', { mode: 'date' }),
    createdAt: createdAtColumn(),
  },
  (table) => [uniqueIndex('uq_workspace_invites_token').on(table.token)]
);

export const auditLogs = mysqlTable('audit_logs', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  actorUserId: bigint('actor_user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  entityType: varchar('entity_type', { length: 60 }).notNull(),
  entityId: bigint('entity_id', { mode: 'number', unsigned: true }).notNull(),
  action: mysqlEnum('action', ['create', 'update', 'delete', 'settle']).notNull(),
  metadataJson: text('metadata_json'),
  createdAt: createdAtColumn(),
});
