import { ArrowRight, Check, Loader2, Plus, Split, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { MonthNav } from '@client/components/MonthNav';
import { AmountInput, EmptyState, ErrorBox, PageToolbar, PrimaryButton, SecondaryButton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { currentMonthKey, dateInputToIso, toDateInput } from '@client/lib/dates';
import { ROLE_LABEL } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import type {
  SettlementSuggestion,
  SharedCashSummary,
  SplitItem,
  WorkspaceMember,
  WorkspaceSummary,
} from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';
import { canRecordTransactions } from '@shared/utils/permissions';
import { splitEqually } from '@shared/utils/split';

interface SharedCashPageProps {
  workspace: WorkspaceSummary;
  currentUserId: number;
  dataVersion: number;
  onChanged: () => void;
}

const dayFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });

export function SharedCashPage({ workspace, currentUserId, dataVersion, onChanged }: SharedCashPageProps) {
  const [month, setMonth] = useState(currentMonthKey);
  const summary = useApi<SharedCashSummary>(`/api/workspaces/${workspace.id}/shared-cash?month=${month}`, dataVersion);
  const splits = useApi<SplitItem[]>(`/api/workspaces/${workspace.id}/splits`, dataVersion);
  const members = useApi<WorkspaceMember[]>(`/api/workspaces/${workspace.id}/members`, dataVersion);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMounted, setDialogMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const currency = workspace.primaryCurrency;
  const canRecord = canRecordTransactions(workspace.role);

  async function act(key: string, action: () => Promise<unknown>) {
    setBusyKey(key);
    setError(null);
    try {
      await action();
      setConfirmKey(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBusyKey(null);
    }
  }

  const settle = (s: SettlementSuggestion) =>
    act(`settle-${s.from.id}-${s.to.id}`, () =>
      apiFetch(`/api/workspaces/${workspace.id}/splits/settle`, {
        method: 'POST',
        body: JSON.stringify({ fromUserId: s.from.id, toUserId: s.to.id }),
      })
    );

  return (
    <div className="space-y-5">
      <PageToolbar>
        <p className="text-sm text-slate-500">Siapa menalangi apa, siapa harus transfer ke siapa — semuanya transparan.</p>
        {canRecord ? (
          <PrimaryButton
            onClick={() => {
              setDialogMounted(true);
              setDialogOpen(true);
            }}
            disabled={!members.data}
          >
            <Plus className="h-4 w-4" /> Split Bill
          </PrimaryButton>
        ) : null}
      </PageToolbar>

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Perlu Diselesaikan</h2>
          <p className="text-xs text-slate-500">Saran transfer bersih antar anggota dari split bill yang belum lunas.</p>
        </div>
        {!summary.data ? (
          <p className="px-5 py-6 text-sm text-slate-500">Memuat...</p>
        ) : summary.data.settlements.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-emerald-700">
            <Check className="h-4 w-4" /> Semua sudah lunas.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {summary.data.settlements.map((s) => {
              const key = `settle-${s.from.id}-${s.to.id}`;
              const involvesMe = s.from.id === currentUserId || s.to.id === currentUserId;
              return (
                <li key={key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <p className="flex flex-1 flex-wrap items-center gap-x-2 text-sm">
                    <span className={`font-semibold ${s.from.id === currentUserId ? 'text-rose-700' : 'text-slate-900'}`}>
                      {s.from.id === currentUserId ? 'Kamu' : s.from.name}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <span className={`font-semibold ${s.to.id === currentUserId ? 'text-emerald-700' : 'text-slate-900'}`}>
                      {s.to.id === currentUserId ? 'Kamu' : s.to.name}
                    </span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(s.amountMinor, currency)}</span>
                    {involvesMe ? null : <span className="text-xs text-slate-400">(antar anggota lain)</span>}
                  </p>
                  {s.canSettle ? (
                    confirmKey === key ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Uang sudah diterima?</span>
                        <button
                          type="button"
                          onClick={() => void settle(s)}
                          disabled={busyKey === key}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Ya, lunas
                        </button>
                        <button type="button" onClick={() => setConfirmKey(null)} className="text-xs text-slate-500">
                          Batal
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmKey(key)}
                        className="self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:self-auto"
                      >
                        Tandai lunas
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-slate-400">Menunggu konfirmasi {s.to.name}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Kontribusi Anggota</h2>
          <MonthNav month={month} onChange={setMonth} />
        </div>
        {!summary.data ? (
          <p className="px-5 py-6 text-sm text-slate-500">Memuat...</p>
        ) : (
          <>
          {/* HP: kartu per anggota, tanpa scroll horizontal */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {summary.data.members.map((m) => (
              <li key={m.userId} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {m.name}
                    {m.userId === currentUserId ? ' (kamu)' : ''}
                    <span className="ml-1.5 text-xs font-normal text-slate-500">{ROLE_LABEL[m.role]}</span>
                  </span>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      m.splitNetMinor > 0 ? 'text-emerald-700' : m.splitNetMinor < 0 ? 'text-rose-700' : 'text-slate-400'
                    }`}
                  >
                    {m.splitNetMinor === 0
                      ? 'Impas'
                      : `${m.splitNetMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(m.splitNetMinor), currency)}`}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                  <div>
                    <dt className="text-slate-500">Pemasukan</dt>
                    <dd className="text-emerald-700">{formatMoney(m.incomeMinor, currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Pengeluaran</dt>
                    <dd className="text-rose-700">{formatMoney(m.expenseMinor, currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Talangan</dt>
                    <dd className="text-slate-700">{formatMoney(m.splitPaidMinor, currency)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Anggota</th>
                  <th className="px-3 py-2 text-right font-medium">Pemasukan</th>
                  <th className="px-3 py-2 text-right font-medium">Pengeluaran</th>
                  <th className="px-3 py-2 text-right font-medium">Talangan</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Posisi split</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {summary.data.members.map((m) => (
                  <tr key={m.userId}>
                    <td className="px-4 py-2.5 sm:px-5">
                      <span className="block font-medium text-slate-900">
                        {m.name}
                        {m.userId === currentUserId ? ' (kamu)' : ''}
                      </span>
                      <span className="text-xs text-slate-500">{ROLE_LABEL[m.role]}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-700">{formatMoney(m.incomeMinor, currency)}</td>
                    <td className="px-3 py-2.5 text-right text-rose-700">{formatMoney(m.expenseMinor, currency)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{formatMoney(m.splitPaidMinor, currency)}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-medium sm:px-5 ${
                        m.splitNetMinor > 0 ? 'text-emerald-700' : m.splitNetMinor < 0 ? 'text-rose-700' : 'text-slate-400'
                      }`}
                    >
                      {m.splitNetMinor === 0
                        ? '—'
                        : `${m.splitNetMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(m.splitNetMinor), currency)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2.5 text-[11px] text-slate-400 sm:px-5">
              Pemasukan/pengeluaran = transaksi yang dicatat anggota bulan ini. Posisi split: + akan menerima, − harus membayar.
            </p>
          </div>
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Riwayat Split Bill</h2>
        {splits.loading && !splits.data ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
          </div>
        ) : (splits.data ?? []).length === 0 ? (
          <EmptyState>
            <Split className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            Belum ada split bill. Catat pengeluaran patungan lewat tombol Split Bill.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {(splits.data ?? []).map((split) => {
              const key = `delete-${split.id}`;
              return (
                <li key={split.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{split.title}</p>
                      <p className="text-xs text-slate-500">
                        {dayFormat.format(new Date(split.occurredAt))} · ditalangi {split.paidBy.name}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-slate-900 tabular-nums">{formatMoney(split.totalMinor, split.currency)}</p>
                      <p className={`text-xs ${split.outstandingMinor > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {split.outstandingMinor > 0 ? `Belum lunas ${formatMoney(split.outstandingMinor, split.currency)}` : 'Lunas'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {split.participants.map((p) => (
                      <span
                        key={p.userId}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                          p.isSettled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {p.isSettled ? <Check className="h-3 w-3" /> : null}
                        {p.name} · {formatMoney(p.owedMinor, split.currency)}
                      </span>
                    ))}
                  </div>
                  {split.canDelete ? (
                    <div className="mt-3 flex justify-end">
                      {confirmKey === key ? (
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyKey === key}
                            onClick={() =>
                              void act(key, () => apiFetch(`/api/workspaces/${workspace.id}/splits/${split.id}`, { method: 'DELETE' }))
                            }
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                          >
                            Ya, hapus
                          </button>
                          <button type="button" onClick={() => setConfirmKey(null)} className="text-xs text-slate-500">
                            Batal
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmKey(key)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Hapus
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dialogMounted && members.data ? (
        <SplitDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onExited={() => setDialogMounted(false)}
          workspace={workspace}
          members={members.data}
          currentUserId={currentUserId}
          onSaved={onChanged}
        />
      ) : null}
    </div>
  );
}

function SplitDialog({
  open,
  onClose,
  onExited,
  workspace,
  members,
  currentUserId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  members: WorkspaceMember[];
  currentUserId: number;
  onSaved: () => void;
}) {
  const currency = workspace.primaryCurrency;
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [date, setDate] = useState(toDateInput(new Date()));
  const [payer, setPayer] = useState(String(currentUserId));
  const [mode, setMode] = useState<'equal' | 'custom'>('equal');
  const [selected, setSelected] = useState<Set<number>>(() => new Set(members.map((m) => m.userId)));
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalMinor = parseAmountInput(total, currency) ?? 0;
  const chosen = members.filter((m) => selected.has(m.userId));
  const equalPreview = new Map(splitEqually(totalMinor, chosen.map((m) => m.userId)).map((s) => [s.userId, s.owedMinor]));
  const customSum = chosen.reduce((acc, m) => acc + (parseAmountInput(custom[m.userId] ?? '', currency) ?? 0), 0);

  function toggle(userId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length < 2) return setError('Keterangan minimal 2 karakter.');
    if (totalMinor <= 0) return setError('Isi total lebih dari 0.');
    if (chosen.length === 0) return setError('Pilih minimal satu peserta.');
    if (mode === 'custom' && customSum !== totalMinor) {
      return setError(`Jumlah porsi ${formatMoney(customSum, currency)} harus sama dengan total ${formatMoney(totalMinor, currency)}.`);
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/splits`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          totalMinor,
          paidByUserId: Number(payer),
          occurredAt: dateInputToIso(date),
          mode,
          participants: chosen.map((m) =>
            mode === 'custom'
              ? { userId: m.userId, owedMinor: parseAmountInput(custom[m.userId] ?? '', currency) ?? 0 }
              : { userId: m.userId }
          ),
        }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan split bill.');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="split-dialog-title">
      <ModalHeader
        id="split-dialog-title"
        title="Split Bill"
        description="Catat pengeluaran patungan. Porsi pembayar sendiri otomatis dianggap lunas."
        onClose={onClose}
      />
      <ModalBody>
        <form id="split-form" noValidate onSubmit={submit} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <FormField id="split-title" label="Keterangan" required>
              <input
                id="split-title"
                autoFocus
                autoComplete="off"
                placeholder="contoh: Makan malam bareng"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={getInputClassName(false)}
              />
            </FormField>
            <FormField id="split-date" label="Tanggal" required>
              <input
                id="split-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={getInputClassName(false)}
              />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="split-total" label="Total" required>
              <AmountInput
                id="split-total"
                currency={currency}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                onBlur={() => totalMinor > 0 && setTotal(formatAmountInput(totalMinor, currency))}
              />
            </FormField>
            <FormField id="split-payer" label="Ditalangi oleh" required>
              <Select id="split-payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                    {m.userId === currentUserId ? ' (kamu)' : ''}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div role="radiogroup" aria-label="Cara bagi" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(['equal', 'custom'] as const).map((option) => (
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
                {option === 'equal' ? 'Bagi rata' : 'Nominal custom'}
              </button>
            ))}
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-slate-700">
              <span>Peserta ({chosen.length})</span>
              {mode === 'custom' ? (
                <span className={customSum === totalMinor ? 'text-emerald-700' : 'text-amber-700'}>
                  {formatMoney(customSum, currency)} / {formatMoney(totalMinor, currency)}
                </span>
              ) : null}
            </legend>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {members.map((m) => {
                const checked = selected.has(m.userId);
                return (
                  <li key={m.userId} className="flex items-center gap-3 px-3 py-2.5">
                    <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(m.userId)}
                        className="h-4 w-4 rounded border-slate-300 accent-teal-700"
                      />
                      <span className="truncate">
                        {m.name}
                        {String(m.userId) === payer ? <span className="text-xs text-slate-400"> · pembayar</span> : null}
                      </span>
                    </label>
                    {checked ? (
                      mode === 'custom' ? (
                        <div className="w-36">
                          <AmountInput
                            aria-label={`Porsi ${m.name}`}
                            currency={currency}
                            value={custom[m.userId] ?? ''}
                            onChange={(e) => setCustom((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                            className="py-1.5"
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-slate-600 tabular-nums">
                          {formatMoney(equalPreview.get(m.userId) ?? 0, currency)}
                        </span>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {error ? <ErrorBox>{error}</ErrorBox> : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="split-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan Split'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
