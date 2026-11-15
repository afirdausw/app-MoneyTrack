import { ArrowLeftRight, History, Settings2, Split, Target, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorBox, LoadingSkeleton } from '@client/components/ui';
import { apiFetch } from '@client/lib/api';
import { formatDayHeading, toDateInput } from '@client/lib/dates';
import type { AuditLogItem, AuditLogPage as AuditPage, WorkspaceSummary } from '@shared/types/domain';

interface AuditLogPageProps {
  workspace: WorkspaceSummary;
  dataVersion: number;
}

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Semua' },
  { value: 'transaction', label: 'Transaksi' },
  { value: 'split', label: 'Split Bill' },
  { value: 'member', label: 'Anggota' },
  { value: 'wallet', label: 'Dompet' },
  { value: 'goal_contribution', label: 'Target' },
  { value: 'workspace', label: 'Pengaturan' },
];

const ENTITY_ICON: Record<string, typeof Wallet> = {
  transaction: ArrowLeftRight,
  split: Split,
  member: Users,
  wallet: Wallet,
  goal_contribution: Target,
  workspace: Settings2,
};

const ACTION_TONE: Record<AuditLogItem['action'], string> = {
  create: 'bg-emerald-50 text-emerald-700',
  update: 'bg-sky-50 text-sky-700',
  delete: 'bg-rose-50 text-rose-700',
  settle: 'bg-teal-50 text-teal-700',
};

const timeFormat = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

export function AuditLogPage({ workspace, dataVersion }: AuditLogPageProps) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = (before?: number) => {
    const params = new URLSearchParams({ limit: '40' });
    if (filter) params.set('entityType', filter);
    if (before) params.set('before', String(before));
    return `/api/workspaces/${workspace.id}/audit-logs?${params.toString()}`;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<AuditPage>(url())
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : 'Gagal memuat audit log.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [workspace.id, filter, dataVersion]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<AuditPage>(url(cursor));
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat audit log.');
    } finally {
      setLoadingMore(false);
    }
  }

  const groups: Array<{ key: string; items: AuditLogItem[] }> = [];
  for (const item of items) {
    const key = toDateInput(new Date(item.createdAt));
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              filter === f.value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {loading ? (
        <LoadingSkeleton label="Memuat riwayat..." />
      ) : items.length === 0 ? (
        <EmptyState>
          <History className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Belum ada aktivitas tercatat.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="mb-1.5 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {formatDayHeading(group.items[0]!.createdAt)}
              </h3>
              <ol className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {group.items.map((item) => {
                  const Icon = ENTITY_ICON[item.entityType] ?? History;
                  return (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ACTION_TONE[item.action]}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <p className="min-w-0 flex-1 text-sm leading-snug text-slate-700">
                        <strong className="font-semibold text-slate-900">{item.actor.name}</strong> {item.summary}
                      </p>
                      <time dateTime={item.createdAt} className="shrink-0 text-xs text-slate-400 tabular-nums">
                        {timeFormat.format(new Date(item.createdAt))}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {cursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
