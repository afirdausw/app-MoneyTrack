import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '@server/config/env';
import * as schema from '@server/db/schema';

let poolInstance: mysql.Pool | null = null;
let dbInstance: MySql2Database<typeof schema> | null = null;

/** Mengembalikan instance Drizzle ORM apabila DATABASE_URL sudah dikonfigurasi. */
export function getDb(): MySql2Database<typeof schema> | null {
  if (!env.DATABASE_URL) {
    return null;
  }

  if (!poolInstance) {
    poolInstance = mysql.createPool(env.DATABASE_URL);
    // Drizzle membaca/menulis DATETIME & TIMESTAMP sebagai UTC. Samakan zona waktu sesi MySQL ke UTC
    // agar nilai `DEFAULT CURRENT_TIMESTAMP` (created_at, joined_at, dll.) juga UTC — tanpa ini jam
    // bergeser sebesar offset server (mis. +7 jam di WIB). Kolom TIMESTAMP lama ikut terbaca benar
    // karena MySQL menyimpannya dalam UTC secara internal.
    poolInstance.pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'");
    });
    dbInstance = drizzle(poolInstance, { schema, mode: 'default' });
  }

  return dbInstance;
}

export async function checkDatabaseHealth(): Promise<{
  status: 'connected' | 'not_configured' | 'error';
  message?: string;
}> {
  if (!env.DATABASE_URL) {
    return {
      status: 'not_configured',
      message: 'Salin .env.example menjadi .env dan isi DATABASE_URL MySQL.',
    };
  }

  try {
    getDb();
    if (!poolInstance) {
      return { status: 'not_configured' };
    }
    const connection = await poolInstance.getConnection();
    await connection.ping();
    connection.release();
    return { status: 'connected' };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Koneksi MySQL gagal',
    };
  }
}

export async function closeDb(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
  }
}
