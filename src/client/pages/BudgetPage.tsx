import { AlertTriangle, Copy, Loader2, Pencil } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { MonthNav } from '@client/components/MonthNav';
import { AmountInput, EmptyState, ErrorBox, PrimaryButton, ProgressBar, SecondaryButton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { AppearanceBadge, categoryAppearance } from '@client/lib/appearance';
import { currentMonthKey, formatMonth, shiftMonth } from '@client/lib/dates';
import { useApi } from '@client/lib/useApi';
import type { BudgetItem, BudgetOverview, WorkspaceSummary } from '@shared/types/domain';
import { budgetPercent, budgetStatus } from '@shared/utils/budget';
import { formatMoney } from '@client/lib/privacy';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';
import { canManagePlanning } from '@shared/utils/permissions';

interface BudgetPageProps {
  workspace: WorkspaceSummary;
  dataVersion: number;
  onChanged: () => void;
}

export function BudgetPage({ workspace, dataVersion, onChanged }: BudgetPageProps) {
  const [month, setMonth] = useState(currentMonthKey);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const budget = useApi<BudgetOverview>(`/api/workspaces/${workspace.id}/budgets?month=${month}`, dataVersion);
  const canManage = canManagePlanning(workspace.role);
  const currency = workspace.primaryCurrency;
  const data = budget.data;

  const budgeted = (data?.items ?? [])
    .filter((i) => i.limitMinor !== null)
    .sort((a, b) => budgetPercent(b.spentMinor, b.limitMinor) - budgetPercent(a.spentMinor, a.limitMinor));
  const unbudgeted = (data?.items ?? [])
    .filter((i) => i.limitMinor === null)
    .sort((a, b) => b.spentMinor - a.spentMinor);
  const totalPercent = data ? budgetPercent(data.totalBudgetedSpentMinor, data.totalLimitMinor || null) : 0;
  const prevMonth = shiftMonth(month, -1);

  async function copyFromPrevious() {
    setCopying(true);
    setCopyMessage(null);
    try {
      const result = await apiFetch<{ copied: number }>(`/api/workspaces/${workspace.id}/budgets/copy`, {
        method: 'POST',
        body: JSON.stringify({ fromMonth: prevMonth, toMonth: month }),
      });
      setCopyMessage(
        result.copied > 0 ? null : `Tidak ada budget di ${formatMonth(prevMonth)} untuk disalin.`
      );
      onChanged();
    } catch (err) {
      setCopyMessage(err instanceof Error ? err.message : 'Gagal menyalin budget.');
    } finally {
      setCopying(false);
    }
  }

  function edit(item: BudgetItem) {
    if (!canManage) return;
    setEditing(item);
    setEditOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <MonthNav month={month} onChange={setMonth} allowFuture />
      </div>

      {budget.error ? <ErrorBox>{budget.error}</ErrorBox> : null}

      {!data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat budget...
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500">Terpakai dari total budget</p>
                <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {formatMoney(data.totalBudgetedSpentMinor, currency)}
                  <span className="text-base font-medium text-slate-400"> / {formatMoney(data.totalLimitMinor, currency)}</span>
                </p>
              </div>
              {data.totalLimitMinor > 0 ? (
                <span className="text-sm font-semibold text-slate-600 tabular-nums">{totalPercent}%</span>
              ) : null}
            </div>
            <div className="mt-3">
              <ProgressBar
                percent={totalPercent}
                tone={budgetStatus(data.totalBudgetedSpentMinor, data.totalLimitMinor || null)}
                label="Total pemakaian budget"
              />
            </div>
            {data.unbudgetedSpentMinor > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                + {formatMoney(data.unbudgetedSpentMinor, currency)} pengeluaran di luar budget
              </p>
            ) : null}
          </section>

          {budgeted.length === 0 ? (
            <EmptyState>
              <p>Belum ada budget untuk {formatMonth(month)}.</p>
              {canManage ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <SecondaryButton onClick={copyFromPrevious} disabled={copying}>
                    <Copy className="h-4 w-4" /> Salin dari {formatMonth(prevMonth)}
                  </SecondaryButton>
                  <p className="text-xs text-slate-400">atau atur batas per kategori di bawah.</p>
                  {copyMessage ? <p className="text-xs text-amber-700">{copyMessage}</p> : null}
                </div>
              ) : null}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {budgeted.map((item) => (
                <BudgetRow key={item.categoryId} item={item} currency={currency} canManage={canManage} onEdit={edit} />
              ))}
            </ul>
          )}

          {unbudgeted.length > 0 ? (
            <section className="space-y-2">
              <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Tanpa batas</h2>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {unbudgeted.map((item) => (
                  <li key={item.categoryId}>
                    <button
                      type="button"
                      onClick={() => edit(item)}
                      disabled={!canManage}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition enabled:hover:bg-slate-50"
                    >
                      <AppearanceBadge appearance={categoryAppearance(item)} size="sm" variant="soft" />
                      <span className="flex-1 truncate text-sm text-slate-800">{item.name}</span>
                      <span className="text-sm text-slate-500 tabular-nums">{formatMoney(item.spentMinor, currency)}</span>
                      {canManage ? <span className="text-xs font-medium text-teal-700">Atur batas</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {editing ? (
        <BudgetDialog
          key={editing.categoryId}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onExited={() => setEditing(null)}
          workspace={workspace}
          month={month}
          item={editing}
          onSaved={onChanged}
        />
      ) : null}
    </div>
  );
}

function BudgetRow({
  item,
  currency,
  canManage,
  onEdit,
}: {
  item: BudgetItem;
  currency: WorkspaceSummary['primaryCurrency'];
  canManage: boolean;
  onEdit: (item: BudgetItem) => void;
}) {
  const status = budgetStatus(item.spentMinor, item.limitMinor);
  const percent = budgetPercent(item.spentMinor, item.limitMinor);
  const remaining = (item.limitMinor ?? 0) - item.spentMinor;
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(item)}
        disabled={!canManage}
        className="group w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition enabled:hover:border-slate-300"
      >
        <div className="flex items-center gap-2.5">
          <AppearanceBadge appearance={categoryAppearance(item)} size="sm" variant="soft" />
          <span className="flex-1 truncate text-sm font-medium text-slate-900">{item.name}</span>
          {status === 'over' || status === 'warning' ? (
            <AlertTriangle className={`h-4 w-4 ${status === 'over' ? 'text-rose-600' : 'text-amber-500'}`} />
          ) : null}
          <span className="text-xs font-semibold text-slate-500 tabular-nums">{percent}%</span>
          {canManage ? <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" /> : null}
        </div>
        <div className="mt-2.5">
          <ProgressBar percent={percent} tone={status} label={`Pemakaian budget ${item.name}`} />
        </div>
        <div className="mt-2 flex justify-between gap-2 text-xs tabular-nums">
          <span className="text-slate-500">
            {formatMoney(item.spentMinor, currency)} / {formatMoney(item.limitMinor ?? 0, currency)}
          </span>
          <span className={remaining < 0 ? 'font-semibold text-rose-700' : 'text-slate-500'}>
            {remaining < 0 ? `Lewat ${formatMoney(-remaining, currency)}` : `Sisa ${formatMoney(remaining, currency)}`}
          </span>
        </div>
      </button>
    </li>
  );
}

function BudgetDialog({
  open,
  onClose,
  onExited,
  workspace,
  month,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  month: string;
  item: BudgetItem;
  onSaved: () => void;
}) {
  const currency = workspace.primaryCurrency;
  const [value, setValue] = useState(item.limitMinor ? formatAmountInput(item.limitMinor, currency) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(limitMinor: number | null) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/budgets`, {
        method: 'PUT',
        body: JSON.stringify({ month, categoryId: item.categoryId, limitMinor }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan budget.');
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const minor = parseAmountInput(value, currency);
    if (!minor || minor <= 0) {
      setError('Isi batas budget lebih dari 0.');
      return;
    }
    void save(minor);
  }

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="budget-dialog-title" size="md">
      <ModalHeader
        id="budget-dialog-title"
        title={`Budget ${item.name}`}
        description={`${formatMonth(month)} · terpakai ${formatMoney(item.spentMinor, currency)}`}
        onClose={onClose}
      />
      <ModalBody>
        <form id="budget-form" noValidate onSubmit={submit} className="space-y-4">
          <FormField id="budget-limit" label="Batas pengeluaran bulan ini" required hint="Peringatan muncul saat pemakaian mencapai 80%.">
            <AmountInput
              id="budget-limit"
              currency={currency}
              large
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              hasError={Boolean(error)}
            />
          </FormField>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
        </form>
      </ModalBody>
      <ModalFooter>
        {item.limitMinor !== null ? (
          <button
            type="button"
            onClick={() => void save(null)}
            disabled={busy}
            className="mr-auto rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            Hapus batas
          </button>
        ) : null}
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="budget-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
