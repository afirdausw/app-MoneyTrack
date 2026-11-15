import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, Plus, Wallet } from 'lucide-react';
import { QuickAdd } from '@client/components/QuickAdd';
import type { TransactionPrefill } from '@client/components/TransactionDialog';
import { TransactionList } from '@client/components/TransactionList';
import { ProgressBar } from '@client/components/ui';
import { BillRow } from '@client/pages/RecurringPage';
import { currentMonthKey, formatMonth } from '@client/lib/dates';
import { useApi } from '@client/lib/useApi';
import type {
  RecurringBillItem,
  TransactionItem,
  WorkspaceOverview,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';
import { budgetPercent, budgetStatus } from '@shared/utils/budget';
import { formatMoney } from '@client/lib/privacy';
import { canManageWorkspace, canRecordTransactions } from '@shared/utils/permissions';

interface DashboardPageProps {
  workspace: WorkspaceSummary;
  wallets: WorkspaceWallet[];
  dataVersion: number;
  onQuickAdd: (prefill: TransactionPrefill) => void;
  onOpenTransaction: (item: TransactionItem) => void;
  onShowTransactions: () => void;
  onShowWallets: () => void;
  onAddWallet: () => void;
  onPayBill: (bill: RecurringBillItem) => void;
  onShowBudget: () => void;
  onShowRecurring: () => void;
}

export function DashboardPage({
  workspace,
  wallets,
  dataVersion,
  onQuickAdd,
  onOpenTransaction,
  onShowTransactions,
  onShowWallets,
  onAddWallet,
  onPayBill,
  onShowBudget,
  onShowRecurring,
}: DashboardPageProps) {
  const month = currentMonthKey();
  const overview = useApi<WorkspaceOverview>(`/api/workspaces/${workspace.id}/overview?month=${month}`, dataVersion);
  const data = overview.data;
  const currency = workspace.primaryCurrency;
  const net = data ? data.incomeMinor - data.expenseMinor : 0;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Saldo"
          value={data ? formatMoney(data.totalBalanceMinor, currency) : '—'}
          note={
            data
              ? data.walletCount === 0
                ? 'Belum ada dompet'
                : `${data.walletCount} dompet${data.otherCurrencyWallets ? ` · ${data.otherCurrencyWallets} beda mata uang tidak dijumlah` : ''}`
              : 'Memuat...'
          }
          icon={Wallet}
          tone="teal"
          onClick={onShowWallets}
          className="col-span-2 sm:col-span-1"
        />
        <StatCard
          label="Pemasukan"
          value={data ? formatMoney(data.incomeMinor, currency) : '—'}
          note={formatMonth(month)}
          icon={ArrowDownLeft}
          tone="emerald"
        />
        <StatCard
          label="Pengeluaran"
          value={data ? formatMoney(data.expenseMinor, currency) : '—'}
          note={data ? `Selisih ${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net), currency)}` : ' '}
          icon={ArrowUpRight}
          tone="rose"
        />
      </section>

      {data && (data.dueBills.length > 0 || data.budgetAlerts.length > 0) ? (
        <section className="rounded-2xl border border-amber-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3 sm:px-5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-slate-900">Perlu Perhatian</h2>
          </div>

          {data.dueBills.length > 0 ? (
            <div>
              <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Tagihan rutin</p>
                <button type="button" onClick={onShowRecurring} className="text-xs font-medium text-teal-700 hover:text-teal-800">
                  Semua tagihan
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {data.dueBills.slice(0, 4).map((bill) => (
                  <BillRow
                    key={bill.id}
                    bill={bill}
                    canPay={canRecordTransactions(workspace.role)}
                    canManage={false}
                    onPay={() => onPayBill(bill)}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {data.budgetAlerts.length > 0 ? (
            <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Budget hampir habis</p>
                <button type="button" onClick={onShowBudget} className="text-xs font-medium text-teal-700 hover:text-teal-800">
                  Lihat budget
                </button>
              </div>
              <ul className="space-y-3">
                {data.budgetAlerts.slice(0, 3).map((item) => {
                  const percent = budgetPercent(item.spentMinor, item.limitMinor);
                  return (
                    <li key={item.categoryId}>
                      <div className="mb-1 flex justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-slate-800">{item.name}</span>
                        <span className="shrink-0 text-slate-500 tabular-nums">
                          {formatMoney(item.spentMinor, currency)} / {formatMoney(item.limitMinor ?? 0, currency)}
                        </span>
                      </div>
                      <ProgressBar
                        percent={percent}
                        tone={budgetStatus(item.spentMinor, item.limitMinor)}
                        label={`Budget ${item.name}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {overview.error ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {overview.error}
        </p>
      ) : null}

      {wallets.length === 0 && !overview.loading ? (
        <section className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-5 text-center">
          <Wallet className="mx-auto h-8 w-8 text-teal-600" />
          <h2 className="mt-2 text-sm font-semibold text-slate-900">Mulai dengan menambah dompet</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-600">
            Rekening bank, e-wallet, atau kas tunai — saldo otomatis berubah setiap transaksi dicatat.
          </p>
          {canManageWorkspace(workspace.role) ? (
            <button
              type="button"
              onClick={onAddWallet}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
            >
              <Plus className="h-4 w-4" /> Tambah Dompet
            </button>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Minta admin Workspace menambahkan dompet.</p>
          )}
        </section>
      ) : (
        <QuickAdd wallets={wallets} disabled={!canRecordTransactions(workspace.role)} onContinue={onQuickAdd} />
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Transaksi Terakhir</h2>
          <button
            type="button"
            onClick={onShowTransactions}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
          >
            Lihat semua <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {data && data.recent.length > 0 ? (
          <TransactionList items={data.recent} onSelect={onOpenTransaction} />
        ) : (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {overview.loading ? 'Memuat...' : 'Belum ada transaksi. Catat yang pertama lewat Catat Cepat atau tombol +.'}
          </p>
        )}
      </section>
    </div>
  );
}

const TONE = {
  teal: 'bg-teal-50 text-teal-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
} as const;

function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
  onClick,
  className: extraClass = '',
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Wallet;
  tone: keyof typeof TONE;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-slate-500">{label}</p>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-1 truncate text-lg font-bold tracking-tight text-slate-900 tabular-nums sm:text-xl">{value}</p>
      <p className="mt-0.5 truncate text-xs text-slate-500">{note}</p>
    </>
  );
  const className = `min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs ${extraClass}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} transition hover:border-slate-300`}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
