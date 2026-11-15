import { Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormField, Select } from '@client/components/FormField';
import { MonthNav } from '@client/components/MonthNav';
import { TransactionList } from '@client/components/TransactionList';
import { AmountInput } from '@client/components/ui';
import { apiFetch } from '@client/lib/api';
import { currentMonthKey, formatMonth, monthRangeIso } from '@client/lib/dates';
import { TRANSACTION_TYPE_LABEL } from '@client/lib/labels';
import type {
  CategoryItem,
  TransactionItem,
  TransactionPage,
  TransactionType,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';
import { parseAmountInput } from '@shared/utils/money';

interface TransactionsPageProps {
  workspace: WorkspaceSummary;
  wallets: WorkspaceWallet[];
  categories: CategoryItem[];
  dataVersion: number;
  onOpenTransaction: (item: TransactionItem) => void;
}

/** Tunda nilai sampai user berhenti mengetik, agar pencarian tidak memanggil API tiap huruf. */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function TransactionsPage({ workspace, wallets, categories, dataVersion, onOpenTransaction }: TransactionsPageProps) {
  const [month, setMonth] = useState(currentMonthKey);
  const [allPeriods, setAllPeriods] = useState(false);
  const [type, setType] = useState<TransactionType | ''>('');
  const [walletId, setWalletId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = workspace.primaryCurrency;
  const q = useDebounced(query.trim());
  const minAmount = useDebounced(minText.trim() ? parseAmountInput(minText, currency) : null);
  const maxAmount = useDebounced(maxText.trim() ? parseAmountInput(maxText, currency) : null);
  const extraFilters = [categoryId, minAmount, maxAmount].filter((v) => v !== '' && v !== null).length;
  const anyFilter = Boolean(type || walletId || q || extraFilters);

  function buildUrl(before?: number): string {
    const params = new URLSearchParams({ limit: '30' });
    if (!allPeriods) {
      const { from, to } = monthRangeIso(month);
      params.set('from', from);
      params.set('to', to);
    }
    if (type) params.set('type', type);
    if (walletId) params.set('walletId', walletId);
    if (categoryId) params.set('categoryId', categoryId);
    if (q) params.set('q', q);
    if (minAmount !== null) params.set('minAmount', String(minAmount));
    if (maxAmount !== null) params.set('maxAmount', String(maxAmount));
    if (before) params.set('before', String(before));
    return `/api/workspaces/${workspace.id}/transactions?${params.toString()}`;
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<TransactionPage>(buildUrl())
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat transaksi.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // buildUrl membaca semua filter di bawah.
  }, [workspace.id, month, allPeriods, type, walletId, categoryId, q, minAmount, maxAmount, dataVersion]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<TransactionPage>(buildUrl(cursor));
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat transaksi.');
    } finally {
      setLoadingMore(false);
    }
  }

  function resetFilters() {
    setType('');
    setWalletId('');
    setCategoryId('');
    setQuery('');
    setMinText('');
    setMaxText('');
  }

  const visibleCategories = categories.filter((c) => !type || type === 'transfer' || c.type === type);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Cari transaksi</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
              placeholder="Cari keterangan atau catatan…"
              className="w-full rounded-xl border border-slate-300 py-2.5 pr-3.5 pl-10 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </label>
          <button
            type="button"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
            className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
              showFilters ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filter</span>
            {extraFilters > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                {extraFilters}
              </span>
            ) : null}
          </button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {allPeriods ? (
              <span className="px-2 text-sm font-semibold text-slate-900">Semua periode</span>
            ) : (
              <MonthNav month={month} onChange={setMonth} />
            )}
            <button
              type="button"
              aria-pressed={allPeriods}
              onClick={() => setAllPeriods((v) => !v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                allPeriods ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Semua periode
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="sm:w-40">
              <Select aria-label="Filter jenis" value={type} onChange={(e) => setType(e.target.value as TransactionType | '')}>
                <option value="">Semua jenis</option>
                {(['expense', 'income', 'transfer'] as const).map((t) => (
                  <option key={t} value={t}>
                    {TRANSACTION_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:w-48">
              <Select aria-label="Filter dompet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                <option value="">Semua dompet</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        {showFilters ? (
          <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
            <FormField id="filter-category" label="Kategori">
              <Select id="filter-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Semua kategori</option>
                {visibleCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="filter-min" label={`Nominal min. (${currency})`}>
              <AmountInput id="filter-min" currency={currency} value={minText} onChange={(e) => setMinText(e.target.value)} />
            </FormField>
            <FormField id="filter-max" label={`Nominal maks. (${currency})`}>
              <AmountInput id="filter-max" currency={currency} value={maxText} onChange={(e) => setMaxText(e.target.value)} />
            </FormField>
          </div>
        ) : null}

        {anyFilter ? (
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{loading ? 'Mencari…' : `${items.length}${cursor ? '+' : ''} transaksi ditemukan`}</span>
            <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800">
              <X className="h-3.5 w-3.5" /> Hapus filter
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat transaksi...
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-12 text-center text-sm text-slate-500">
          {anyFilter
            ? `Tidak ada transaksi yang cocok${allPeriods ? '' : ` di ${formatMonth(month)}`}.`
            : `Tidak ada transaksi di ${formatMonth(month)}.`}
          {anyFilter && !allPeriods ? (
            <button type="button" onClick={() => setAllPeriods(true)} className="mt-2 block w-full font-medium text-teal-700">
              Cari di semua periode
            </button>
          ) : null}
        </p>
      ) : (
        <>
          <TransactionList items={items} onSelect={onOpenTransaction} grouped />
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
        </>
      )}
    </div>
  );
}
