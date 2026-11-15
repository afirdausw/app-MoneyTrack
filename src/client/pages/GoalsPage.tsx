import { CalendarClock, CheckCircle2, Loader2, Plus, Target, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { FormField, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { AmountInput, EmptyState, ErrorBox, PageToolbar, PrimaryButton, ProgressBar, SecondaryButton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { formatDateKey } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import type { GoalContribution, GoalItem, WorkspaceSummary } from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';
import { canManagePlanning } from '@shared/utils/permissions';

interface GoalsPageProps {
  workspace: WorkspaceSummary;
  dataVersion: number;
  onChanged: () => void;
}

type DialogState = { kind: 'create' } | { kind: 'detail'; goalId: number };

export function GoalsPage({ workspace, dataVersion, onChanged }: GoalsPageProps) {
  const goals = useApi<GoalItem[]>(`/api/workspaces/${workspace.id}/goals`, dataVersion);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [open, setOpen] = useState(false);
  const canManage = canManagePlanning(workspace.role);

  function show(state: DialogState) {
    setDialog(state);
    setOpen(true);
  }

  const list = goals.data ?? [];
  const detailGoal = dialog?.kind === 'detail' ? list.find((g) => g.id === dialog.goalId) ?? null : null;

  return (
    <div className="space-y-4">
      <PageToolbar>
        <p className="text-sm text-slate-500">Kumpulkan dana untuk tujuan tertentu: dana darurat, liburan, gadget.</p>
        {canManage ? (
          <PrimaryButton onClick={() => show({ kind: 'create' })}>
            <Plus className="h-4 w-4" /> Tambah Target
          </PrimaryButton>
        ) : null}
      </PageToolbar>

      {goals.error ? <ErrorBox>{goals.error}</ErrorBox> : null}

      {goals.loading && !goals.data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat target...
        </div>
      ) : list.length === 0 ? (
        <EmptyState>
          <Target className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Belum ada target tabungan{canManage ? '. Mulai dengan Tambah Target.' : '.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((goal) => (
            <li key={goal.id}>
              <GoalCard goal={goal} onOpen={() => show({ kind: 'detail', goalId: goal.id })} />
            </li>
          ))}
        </ul>
      )}

      {dialog ? (
        <GoalDialog
          key={dialog.kind === 'detail' ? dialog.goalId : 'create'}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setDialog(null)}
          workspace={workspace}
          goal={detailGoal}
          canManage={canManage}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function goalPercent(goal: GoalItem): number {
  return goal.targetMinor > 0 ? Math.floor((goal.currentMinor * 100) / goal.targetMinor) : 0;
}

function GoalCard({ goal, onOpen }: { goal: GoalItem; onOpen: () => void }) {
  const percent = goalPercent(goal);
  const reached = goal.currentMinor >= goal.targetMinor;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-300"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-900">{goal.name}</span>
        {reached ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Tercapai
          </span>
        ) : (
          <span className="shrink-0 text-xs font-semibold text-slate-500 tabular-nums">{percent}%</span>
        )}
      </div>
      <p className="mt-3 text-xl font-bold tracking-tight text-slate-900 tabular-nums">
        {formatMoney(goal.currentMinor, goal.currency)}
      </p>
      <p className="text-xs text-slate-500 tabular-nums">dari {formatMoney(goal.targetMinor, goal.currency)}</p>
      <div className="mt-3">
        <ProgressBar percent={percent} tone={reached ? 'goal' : 'ok'} label={`Progres ${goal.name}`} />
      </div>
      {goal.deadline ? (
        <p className="mt-2.5 flex items-center gap-1 text-xs text-slate-500">
          <CalendarClock className="h-3.5 w-3.5" />
          {formatDateKey(goal.deadline)}
          {goal.monthlyNeededMinor ? ` · ${formatMoney(goal.monthlyNeededMinor, goal.currency)}/bulan` : ''}
        </p>
      ) : null}
    </button>
  );
}

const historyTime = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function GoalDialog({
  open,
  onClose,
  onExited,
  workspace,
  goal,
  canManage,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  goal: GoalItem | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const currency = workspace.primaryCurrency;
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? formatAmountInput(goal.targetMinor, currency) : '');
  const [initial, setInitial] = useState('');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<GoalContribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const goalId = goal?.id ?? null;

  useEffect(() => {
    if (goalId === null) return;
    let active = true;
    apiFetch<GoalContribution[]>(`/api/workspaces/${workspace.id}/goals/${goalId}/contributions`)
      .then((rows) => active && setHistory(rows))
      .catch(() => active && setHistory([]));
    return () => {
      active = false;
    };
  }, [goalId, workspace.id, goal?.currentMinor]);

  async function run(action: () => Promise<unknown>, close = true) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      if (close) onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBusy(false);
    }
  }

  function saveGoal(event: FormEvent) {
    event.preventDefault();
    const targetMinor = parseAmountInput(target, currency);
    if (name.trim().length < 2) return setError('Nama target minimal 2 karakter.');
    if (!targetMinor || targetMinor <= 0) return setError('Isi nominal target lebih dari 0.');
    const initialMinor = initial.trim() ? parseAmountInput(initial, currency) : 0;
    if (initialMinor === null || initialMinor < 0) return setError('Dana awal harus angka.');

    void run(() =>
      goal
        ? apiFetch(`/api/workspaces/${workspace.id}/goals/${goal.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: name.trim(), targetMinor, deadline: deadline || null }),
          })
        : apiFetch(`/api/workspaces/${workspace.id}/goals`, {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), targetMinor, initialMinor, deadline: deadline || null }),
          })
    );
  }

  function contribute(event: FormEvent) {
    event.preventDefault();
    if (!goal) return;
    const minor = parseAmountInput(amount, currency);
    if (!minor || minor <= 0) return setError('Isi nominal lebih dari 0.');
    void run(async () => {
      await apiFetch(`/api/workspaces/${workspace.id}/goals/${goal.id}/contributions`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor: mode === 'deposit' ? minor : -minor, note: note.trim() || null }),
      });
      setAmount('');
      setNote('');
    }, false);
  }

  const editForm = (
    <form id="goal-form" noValidate onSubmit={saveGoal} className="space-y-4">
      <FormField id="goal-name" label="Nama Target" required>
        <input
          id="goal-name"
          autoFocus={!goal}
          autoComplete="off"
          placeholder="contoh: Dana Darurat"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={getInputClassName(false)}
        />
      </FormField>
      <div className={`grid gap-3 ${goal ? '' : 'sm:grid-cols-2'}`}>
        <FormField id="goal-target" label="Nominal Target" required>
          <AmountInput id="goal-target" currency={currency} value={target} onChange={(e) => setTarget(e.target.value)} />
        </FormField>
        {goal ? null : (
          <FormField id="goal-initial" label="Sudah terkumpul" hint="Opsional">
            <AmountInput id="goal-initial" currency={currency} value={initial} onChange={(e) => setInitial(e.target.value)} />
          </FormField>
        )}
      </div>
      <FormField id="goal-deadline" label="Tenggat (opsional)" hint="Dipakai untuk menghitung setoran per bulan.">
        <input
          id="goal-deadline"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className={getInputClassName(false)}
        />
      </FormField>
    </form>
  );

  if (!goal) {
    return (
      <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="goal-dialog-title" size="md">
        <ModalHeader id="goal-dialog-title" title="Tambah Target Tabungan" onClose={onClose} />
        <ModalBody>
          <div className="space-y-4">
            {editForm}
            {error ? <ErrorBox>{error}</ErrorBox> : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
          <PrimaryButton type="submit" form="goal-form" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan Target'}
          </PrimaryButton>
        </ModalFooter>
      </Modal>
    );
  }

  const percent = goalPercent(goal);
  const reached = goal.currentMinor >= goal.targetMinor;

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="goal-dialog-title">
      <ModalHeader
        id="goal-dialog-title"
        title={goal.name}
        description={goal.deadline ? `Tenggat ${formatDateKey(goal.deadline)}` : 'Tanpa tenggat'}
        onClose={onClose}
      />
      <ModalBody>
        <div className="space-y-6">
          <section>
            <div className="flex items-end justify-between gap-2">
              <p className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {formatMoney(goal.currentMinor, currency)}
                <span className="text-base font-medium text-slate-400"> / {formatMoney(goal.targetMinor, currency)}</span>
              </p>
              <span className="text-sm font-semibold text-slate-600">{percent}%</span>
            </div>
            <div className="mt-2.5">
              <ProgressBar percent={percent} tone={reached ? 'goal' : 'ok'} label={`Progres ${goal.name}`} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {reached
                ? 'Target sudah tercapai.'
                : goal.monthlyNeededMinor
                  ? `Perlu ${formatMoney(goal.monthlyNeededMinor, currency)} per bulan agar tercapai tepat waktu.`
                  : `Kurang ${formatMoney(goal.targetMinor - goal.currentMinor, currency)}.`}
            </p>
          </section>

          {canManage ? (
            <form noValidate onSubmit={contribute} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div role="radiogroup" aria-label="Jenis setoran" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                {(['deposit', 'withdraw'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={mode === option}
                    onClick={() => setMode(option)}
                    className={`rounded-lg py-1.5 text-sm font-semibold transition ${
                      mode === option ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                    }`}
                  >
                    {option === 'deposit' ? 'Setor' : 'Tarik'}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <AmountInput
                  aria-label="Nominal"
                  currency={currency}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-white"
                />
                <input
                  aria-label="Catatan"
                  placeholder="Catatan (opsional)"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  className={getInputClassName(false, 'bg-white')}
                />
                <PrimaryButton type="submit" disabled={busy}>
                  {mode === 'deposit' ? 'Setor' : 'Tarik'}
                </PrimaryButton>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Setoran hanya mencatat progres target — saldo dompet tidak berubah. Catat transfer ke rekening tabungan
                lewat menu Transaksi bila uangnya benar-benar dipindah.
              </p>
            </form>
          ) : null}

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Riwayat</h3>
            {history === null ? (
              <p className="text-xs text-slate-400">Memuat...</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada setoran.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-800">{h.note ?? (h.amountMinor > 0 ? 'Setoran' : 'Penarikan')}</span>
                      <span className="block text-xs text-slate-500">
                        {h.actorName} · {historyTime.format(new Date(h.createdAt))}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${h.amountMinor > 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {h.amountMinor > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(h.amountMinor), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canManage ? (
            <details className="group rounded-xl border border-slate-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">Ubah target</summary>
              <div className="space-y-4 border-t border-slate-100 p-4">
                {editForm}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {confirmDelete ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void run(() => apiFetch(`/api/workspaces/${workspace.id}/goals/${goal.id}`, { method: 'DELETE' }))
                        }
                        disabled={busy}
                        className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                      >
                        Ya, hapus target
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-slate-500">
                        Batal
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus target
                    </button>
                  )}
                  <PrimaryButton type="submit" form="goal-form" disabled={busy}>
                    Simpan perubahan
                  </PrimaryButton>
                </div>
              </div>
            </details>
          ) : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Tutup</SecondaryButton>
      </ModalFooter>
    </Modal>
  );
}
