import { sql } from 'drizzle-orm';
import { datetime, timestamp } from 'drizzle-orm/mysql-core';

/** Kolom timestamp CURRENT_TIMESTAMP tanpa kurung `(now())` agar kompatibel dengan MariaDB 10.1 & MySQL 5.7+. */
export function currentTimestamp(columnName: string) {
  return timestamp(columnName, { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull();
}

export function createdAtColumn() {
  return currentTimestamp('created_at');
}

export function updatedAtColumn() {
  return timestamp('updated_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .onUpdateNow()
    .notNull();
}

export function defaultNowDatetime(columnName: string) {
  return datetime(columnName, { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull();
}
