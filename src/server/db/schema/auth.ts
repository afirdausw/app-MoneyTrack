import { bigint, datetime, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { createdAtColumn, updatedAtColumn } from '@server/db/schema/helpers';

export const users = mysqlTable(
  'users',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 191 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    googleId: varchar('google_id', { length: 191 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('uq_users_email').on(table.email),
    uniqueIndex('uq_users_google_id').on(table.googleId),
  ]
);

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
  createdAt: createdAtColumn(),
});
