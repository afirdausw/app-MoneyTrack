import { type SQL, and, desc, eq, lt, or } from 'drizzle-orm';
import { auditLogs, users } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import type { DbTransaction } from '@server/services/workspace-service';
import type { AuditLogItem, AuditLogPage, CurrencyCode } from '@shared/types/domain';
import { formatMoney } from '@shared/utils/currency';
import type { AuditQuery } from '@shared/validation/collab';

export type AuditEntity =
  | 'transaction'
  | 'goal_contribution'
  | 'member'
  | 'split'
  | 'wallet'
  | 'workspace'
  | 'invoice';
export type AuditAction = 'create' | 'update' | 'delete' | 'settle';

export interface AuditEntry {
  workspaceId: number;
  actorUserId: number;
  entityType: AuditEntity;
  entityId: number;
  action: AuditAction;
  metadata: Record<string, unknown>;
}

/** Tulis satu baris audit. Bisa dipanggil di dalam DB transaction agar ikut rollback bila gagal. */
export async function recordAudit(executor: DbClient | DbTransaction, entry: AuditEntry): Promise<void> {
  await (executor as DbClient).insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    metadataJson: JSON.stringify(entry.metadata),
  });
}

const TYPE_LABEL: Record<string, string> = { income: 'pemasukan', expense: 'pengeluaran', transfer: 'transfer' };
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const VISIBILITY_LABEL: Record<string, string> = {
  workspace_only: 'Saldo saja',
  full_transparent: 'Transparan penuh',
};

type Meta = Record<string, unknown>;

function money(amount: unknown, currency: unknown): string {
  return typeof amount === 'number' ? formatMoney(amount, (currency as CurrencyCode) ?? 'IDR') : '';
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value ? value : fallback;
}

/** Ubah metadata audit menjadi kalimat ringkas untuk ditampilkan di halaman Audit Log. */
export function summarizeAudit(entityType: string, action: AuditAction, meta: Meta): string {
  switch (entityType) {
    case 'transaction': {
      if (action === 'update') {
        const before = (meta.before ?? {}) as Meta;
        const after = (meta.after ?? {}) as Meta;
        const amountChanged = before.amountMinor !== after.amountMinor;
        return `mengubah transaksi "${str(after.title)}"${
          amountChanged ? ` (${money(before.amountMinor, before.currency)} → ${money(after.amountMinor, after.currency)})` : ''
        }`;
      }
      const verb = action === 'delete' ? 'menghapus' : 'mencatat';
      return `${verb} ${TYPE_LABEL[str(meta.type)] ?? 'transaksi'} "${str(meta.title)}" ${money(meta.amountMinor, meta.currency)}`.trim();
    }
    case 'goal_contribution': {
      const amount = typeof meta.amountMinor === 'number' ? meta.amountMinor : 0;
      const verb = amount >= 0 ? 'menyetor' : 'menarik';
      const note = str(meta.note) ? ` (${str(meta.note)})` : '';
      return `${verb} ${money(Math.abs(amount), meta.currency)} ${amount >= 0 ? 'ke' : 'dari'} target "${str(meta.goalName, 'tabungan')}"${note}`;
    }
    case 'member': {
      const name = str(meta.targetName, 'anggota');
      switch (meta.event) {
        case 'joined':
          return `bergabung sebagai ${ROLE_LABEL[str(meta.role)] ?? str(meta.role)}`;
        case 'role_changed':
          return `mengubah role ${name}: ${ROLE_LABEL[str(meta.fromRole)]} → ${ROLE_LABEL[str(meta.toRole)]}`;
        case 'left':
          return 'keluar dari Workspace';
        default:
          return `mengeluarkan ${name} dari Workspace`;
      }
    }
    case 'split':
      if (action === 'settle') {
        return `menandai lunas: ${str(meta.fromName)} → ${str(meta.toName)} ${money(meta.amountMinor, meta.currency)}`;
      }
      return action === 'delete'
        ? `menghapus split bill "${str(meta.title)}"`
        : `membuat split bill "${str(meta.title)}" ${money(meta.totalMinor, meta.currency)} (ditalangi ${str(meta.paidByName)})`;
    case 'wallet':
      switch (meta.event) {
        case 'linked':
          return `menautkan dompet "${str(meta.walletName)}" (${VISIBILITY_LABEL[str(meta.visibilityMode)] ?? ''})`;
        case 'unlinked':
          return `melepas dompet "${str(meta.walletName)}"`;
        default:
          return `mengubah visibilitas dompet "${str(meta.walletName)}" menjadi ${VISIBILITY_LABEL[str(meta.visibilityMode)] ?? ''}`;
      }
    case 'invoice':
      return action === 'delete'
        ? `menghapus invoice ${str(meta.number)} "${str(meta.title)}"`
        : `membuat invoice ${str(meta.number)} "${str(meta.title)}" ${money(meta.amountMinor, meta.currency)}`;
    case 'workspace': {
      const changes = (meta.changes ?? {}) as Meta;
      const parts = [
        changes.name ? `nama menjadi "${str(changes.name)}"` : null,
        changes.primaryCurrency ? `mata uang menjadi ${str(changes.primaryCurrency)}` : null,
        'icon' in changes || 'color' in changes ? 'tampilan (ikon/warna)' : null,
      ].filter(Boolean);
      return `mengubah pengaturan Workspace${parts.length ? `: ${parts.join(', ')}` : ''}`;
    }
    default:
      return `${action} ${entityType} #`;
  }
}

export async function listAuditLogs(db: DbClient, workspaceId: number, query: AuditQuery): Promise<AuditLogPage> {
  // Urut menurut waktu kejadian (bukan ID); paginasi keyset pada (created_at, id) agar stabil.
  let cursorCondition: SQL | undefined;
  if (query.before) {
    const [cursor] = await db
      .select({ createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.id, query.before), eq(auditLogs.workspaceId, workspaceId)))
      .limit(1);
    if (cursor) {
      cursorCondition = or(
        lt(auditLogs.createdAt, cursor.createdAt),
        and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, query.before))
      );
    }
  }
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadataJson: auditLogs.metadataJson,
      createdAt: auditLogs.createdAt,
      actorId: users.id,
      actorName: users.name,
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
        cursorCondition
      )
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const items: AuditLogItem[] = page.map((row) => {
    let meta: Meta = {};
    try {
      meta = JSON.parse(row.metadataJson ?? '{}') as Meta;
    } catch {
      meta = {};
    }
    return {
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: { id: row.actorId, name: row.actorName },
      summary: summarizeAudit(row.entityType, row.action, meta),
      createdAt: row.createdAt.toISOString(),
    };
  });
  return { items, nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null };
}
