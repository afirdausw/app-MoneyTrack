import { BarChart3, FileSpreadsheet, FileText, Printer, Table2 } from 'lucide-react';
import { useState } from 'react';
import { AutoHeight } from '@client/components/AutoHeight';
import { TrendChart } from '@client/components/TrendChart';
import { SegmentThumb } from '@client/components/SegmentThumb';
import { DatePicker } from '@client/components/DatePicker';
import { AppearanceBadge, categoryAppearance } from '@client/lib/appearance';
import { ErrorBox, LoadingSkeleton } from '@client/components/ui';
import { currentMonthKey } from '@client/lib/dates';
import { formatDateKey } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import type { ReportSummary, TrendPoint, WorkspaceSummary } from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { daysBetween, toDateKey } from '@shared/utils/schedule';

interface ReportsPageProps {
  workspace: WorkspaceSummary;
  dataVersion: number;
}

type Preset = 'this-month' | 'last-month' | 'last-3' | 'this-year' | 'custom';

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'this-month', label: 'Bulan ini' },
  { value: 'last-month', label: 'Bulan lalu' },
  { value: 'last-3', label: '3 bulan' },
  { value: 'this-year', label: 'Tahun ini' },
  { value: 'custom', label: 'Pilih tanggal' },
];

function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'this-month':
      return { from: toDateKey(new Date(y, m, 1)), to: toDateKey(now) };
    case 'last-month':
      return { from: toDateKey(new Date(y, m - 1, 1)), to: toDateKey(new Date(y, m, 0)) };
    case 'last-3':
      return { from: toDateKey(new Date(y, m - 2, 1)), to: toDateKey(now) };
    case 'this-year':
      return { from: toDateKey(new Date(y, 0, 1)), to: toDateKey(now) };
  }
}

const TITLE: Record<WorkspaceSummary['type'], { report: string; income: string; expense: string; net: string }> = {
  personal: { report: 'Laporan Arus Kas', income: 'Pemasukan', expense: 'Pengeluaran', net: 'Selisih' },
  shared: { report: 'Laporan Kas Bersama', income: 'Kas masuk', expense: 'Kas keluar', net: 'Saldo kas periode' },
  business: { report: 'Laporan Laba Rugi', income: 'Pendapatan', expense: 'Beban', net: 'Laba (rugi) bersih' },
};

export function ReportsPage({ workspace, dataVersion }: ReportsPageProps) {
  const [preset, setPreset] = useState<Preset>('this-month');
  const [custom, setCustom] = useState(() => presetRange('this-month'));
  const [months, setMonths] = useState(6);
  const [showTable, setShowTable] = useState(false);

  const range = preset === 'custom' ? custom : presetRange(preset);
  const validCustom = range.from <= range.to && daysBetween(range.from, range.to) < 366;
  const query = `from=${range.from}&to=${range.to}`;
  const base = `/api/workspaces/${workspace.id}/reports`;
  const summary = useApi<ReportSummary>(validCustom ? `${base}/summary?${query}` : null, dataVersion);
  const endMonth = range.to.slice(0, 7) > currentMonthKey() ? currentMonthKey() : range.to.slice(0, 7);
  const trend = useApi<TrendPoint[]>(`${base}/trend?end=${endMonth}&months=${months}`, dataVersion);
  const currency = workspace.primaryCurrency;
  const labels = TITLE[workspace.type];
  const data = summary.data;
  const income = data?.categories.filter((c) => c.type === 'income') ?? [];
  const expense = data?.categories.filter((c) => c.type === 'expense') ?? [];

  return (
    <div className="space-y-5">
      {/* Kepala laporan khusus versi cetak / PDF. */}
      <header className="hidden print:block">
        <h1 className="text-xl font-bold text-slate-900">
          {labels.report} — {workspace.name}
        </h1>
        <p className="text-sm text-slate-600">
          Periode {formatDateKey(range.from)} – {formatDateKey(range.to)} · dicetak {formatDateKey(toDateKey(new Date()))}
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs print:hidden sm:p-4">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={preset === p.value}
              onClick={() => setPreset(p.value)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                preset === p.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <DatePicker
              aria-label="Dari tanggal"
              placeholder="Dari tanggal"
              value={custom.from}
              max={custom.to}
              onChange={(from) => setCustom((c) => ({ ...c, from }))}
            />
            <DatePicker
              aria-label="Sampai tanggal"
              placeholder="Sampai tanggal"
              value={custom.to}
              min={custom.from}
              onChange={(to) => setCustom((c) => ({ ...c, to }))}
            />
          </div>
        ) : null}
        {!validCustom ? <ErrorBox>Pilih rentang tanggal yang benar, maksimal 1 tahun.</ErrorBox> : null}
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs text-slate-500">
            {formatDateKey(range.from)} – {formatDateKey(range.to)}
          </p>
          <a
            href={validCustom ? `${base}/export?${query}&format=xlsx` : undefined}
            aria-disabled={!validCustom}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" /> Excel
          </a>
          <a
            href={validCustom ? `${base}/export?${query}&format=csv` : undefined}
            aria-disabled={!validCustom}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4 text-slate-500" /> CSV
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> Cetak / PDF
          </button>
        </div>
      </section>

      {summary.error ? <ErrorBox>{summary.error}</ErrorBox> : null}

      {!data ? (
        validCustom ? (
          <LoadingSkeleton label="Menyusun laporan..." variant="report" />
        ) : null
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={labels.income} value={formatMoney(data.incomeMinor, currency)} />
            <Tile label={labels.expense} value={formatMoney(data.expenseMinor, currency)} />
            <Tile
              label={labels.net}
              value={`${data.netMinor < 0 ? '−' : ''}${formatMoney(Math.abs(data.netMinor), currency)}`}
              emphasis={data.netMinor < 0 ? 'negative' : 'positive'}
            />
            <Tile label="Transaksi" value={String(data.transactionCount)} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs break-inside-avoid sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Tren {months} bulan</h2>
                <p className="text-xs text-slate-500">Dalam {currency}, s.d. {formatDateKey(`${endMonth}-01`).replace(/^1 /, '')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <Segmented
                  label="Rentang tren"
                  value={months}
                  onChange={setMonths}
                  options={[
                    { value: 6, label: '6 bln' },
                    { value: 12, label: '12 bln' },
                  ]}
                />
                <Segmented
                  label="Tampilan tren"
                  value={showTable ? 'table' : 'chart'}
                  onChange={(v) => setShowTable(v === 'table')}
                  options={[
                    { value: 'chart', label: 'Grafik', icon: BarChart3 },
                    { value: 'table', label: 'Tabel', icon: Table2 },
                  ]}
                />
              </div>
            </div>
            <AutoHeight>
              {trend.data ? (
                // Kunci berbeda → isi lama diganti dan isi baru masuk dengan animasi (grafik: batang tumbuh).
                <div key={showTable ? 'table' : 'chart'} className="animate-fade-up">
                  {showTable ? (
                    <TrendTable points={trend.data} currency={currency} />
                  ) : (
                    <TrendChart points={trend.data} currency={currency} />
                  )}
                </div>
              ) : (
                <div className="skeleton h-64 rounded-xl" />
              )}
            </AutoHeight>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-xs break-inside-avoid">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5">{labels.report}</h2>
            <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-slate-100">
              <CategoryBlock title={labels.income} rows={income} total={data.incomeMinor} currency={currency} />
              <CategoryBlock title={labels.expense} rows={expense} total={data.expenseMinor} currency={currency} />
            </div>
            <p className="flex justify-between border-t border-slate-200 px-4 py-3 text-sm font-semibold sm:px-5">
              {labels.net}
              <span className={`tabular-nums ${data.netMinor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                {data.netMinor < 0 ? '−' : ''}
                {formatMoney(Math.abs(data.netMinor), currency)}
              </span>
            </p>
          </section>

          {data.projects.length > 0 ? (
            <BreakdownTable title="Per Project" rows={data.projects} currency={currency} netLabel="Profit" />
          ) : null}
          {data.wallets.length > 0 ? <BreakdownTable title="Per Dompet" rows={data.wallets} currency={currency} netLabel="Selisih" /> : null}

          <p className="text-[11px] text-slate-400">
            Nominal dalam {currency} (dompet mata uang lain dikonversi dengan kurs saat transaksi dicatat). Transfer antar dompet
            tidak dihitung sebagai pemasukan/pengeluaran.
          </p>
        </>
      )}
    </div>
  );
}

/** Grup tombol pilihan dalam wadah lembut; opsi aktif berlatar gelap. */
function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof Table2 }>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex gap-0.5 rounded-xl bg-slate-100 p-1">
      <SegmentThumb className="bg-slate-900 shadow-xs" />
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`relative inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
              active ? 'text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Tile({ label, value, emphasis }: { label: string; value: string; emphasis?: 'positive' | 'negative' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 truncate text-lg font-bold tracking-tight tabular-nums sm:text-xl ${
          emphasis === 'negative' ? 'text-rose-700' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function CategoryBlock({
  title,
  rows,
  total,
  currency,
}: {
  title: string;
  rows: ReportSummary['categories'];
  total: number;
  currency: WorkspaceSummary['primaryCurrency'];
}) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Tidak ada.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const share = total > 0 ? Math.round((r.totalMinor * 100) / total) : 0;
            return (
              <li key={`${r.type}-${r.categoryId ?? 'none'}`} className="flex items-center gap-3 text-sm">
                <AppearanceBadge appearance={categoryAppearance(r)} size="sm" variant="soft" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-800">{r.name}</span>
                    <span className="shrink-0 text-slate-900 tabular-nums">{formatMoney(r.totalMinor, currency)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {r.count} transaksi · {share}%
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-sm font-medium text-slate-900">
        Total <span className="tabular-nums">{formatMoney(total, currency)}</span>
      </p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  currency,
  netLabel,
}: {
  title: string;
  rows: ReportSummary['wallets'];
  currency: WorkspaceSummary['primaryCurrency'];
  netLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs break-inside-avoid">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium sm:px-5">Nama</th>
              <th className="px-3 py-2 text-right font-medium">Masuk</th>
              <th className="px-3 py-2 text-right font-medium">Keluar</th>
              <th className="px-4 py-2 text-right font-medium sm:px-5">{netLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {rows.map((r) => {
              const net = r.incomeMinor - r.expenseMinor;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-slate-800 sm:px-5">{r.name}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{formatMoney(r.incomeMinor, currency)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{formatMoney(r.expenseMinor, currency)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium sm:px-5 ${net < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                    {net < 0 ? '−' : ''}
                    {formatMoney(Math.abs(net), currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });

function TrendTable({ points, currency }: { points: TrendPoint[]; currency: WorkspaceSummary['primaryCurrency'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-2 font-medium">Bulan</th>
            <th className="py-2 text-right font-medium">Pemasukan</th>
            <th className="py-2 text-right font-medium">Pengeluaran</th>
            <th className="py-2 text-right font-medium">Selisih</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {points.map((p) => {
            const [y, m] = p.month.split('-').map(Number) as [number, number];
            const net = p.incomeMinor - p.expenseMinor;
            return (
              <tr key={p.month}>
                <td className="py-2 text-slate-800">{monthLabel.format(new Date(y, m - 1, 1))}</td>
                <td className="py-2 text-right text-slate-700">{formatMoney(p.incomeMinor, currency)}</td>
                <td className="py-2 text-right text-slate-700">{formatMoney(p.expenseMinor, currency)}</td>
                <td className={`py-2 text-right font-medium ${net < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                  {net < 0 ? '−' : ''}
                  {formatMoney(Math.abs(net), currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
