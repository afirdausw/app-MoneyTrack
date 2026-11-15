import { desc, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '@server/config/env';
import { closeDb, getDb } from '@server/db';
import { users, workspaceMembers, workspaces } from '@server/db/schema';
import { createUserWithDefaultWorkspace } from '@server/services/auth-service';

/**
 * Regresi: kolom `DEFAULT CURRENT_TIMESTAMP` (diisi MySQL) harus terbaca sama dengan jam sekarang,
 * bukan bergeser sebesar offset zona waktu server (dulu +7 jam di WIB).
 */
describe.skipIf(!env.DATABASE_URL)('database timestamps', () => {
  const created: number[] = [];

  afterAll(async () => {
    const db = getDb();
    if (db && created.length) {
      await db.delete(workspaces).where(inArray(workspaces.createdByUserId, created));
      await db.delete(users).where(inArray(users.id, created));
    }
    await closeDb();
  });

  it('reads DB-generated timestamps in the correct instant', async () => {
    const db = getDb()!;
    const before = Date.now();
    const user = await createUserWithDefaultWorkspace(db, {
      name: 'Uji Zona Waktu',
      email: `vitest-tz-${before}@example.test`,
      passwordHash: null,
    });
    created.push(user.user.id);

    const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, user.user.id));
    const [member] = await db
      .select({ joinedAt: workspaceMembers.joinedAt })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.user.id))
      .orderBy(desc(workspaceMembers.joinedAt))
      .limit(1);

    for (const value of [row!.createdAt, member!.joinedAt]) {
      // Toleransi 2 menit untuk lambatnya query; selisih zona waktu (jam) pasti gagal.
      expect(Math.abs(value.getTime() - before)).toBeLessThan(120_000);
    }
  });
});
