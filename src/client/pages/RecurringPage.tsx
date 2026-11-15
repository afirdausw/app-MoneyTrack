import { BellRing, Plus, Repeat } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { DatePicker } from '@client/components/DatePicker';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { SegmentThumb } from '@client/components/SegmentThumb';
import { AmountInput, EmptyState, ErrorBox, PageToolbar, PrimaryButton, SecondaryButton, LoadingSkeleton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { FREQUENCY_LABEL, TRANSACTION_TYPE_LABEL, dueLabel } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import { convertAmountText } from '@client/lib/amountText';
import type {
  CategoryItem,
  RecurringBillItem,
  RecurringFrequencyType,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';
import { canManagePlanning, canRecordTransactions } from '@shared/utils/permissions';
import { toDateKey } from '@shared/utils/schedule';

interface RecurringPageProps {
  workspace: WorkspaceSummary;
  wallets: WorkspaceWallet[];
  categories: CategoryItem[];
  dataVersion: number;
  onPay: (bill: RecurringBillItem) => void;
  onChanged: () => void;
}

export function RecurringPage({ workspace, wallets, categories, dataVersion, onPay, onChanged }: RecurringPageProps) {
  const bills = useApi<RecurringBillItem[]>(`/api/workspaces/${workspace.id}/recurring`, dataVersion);
  const [editing, setEditing] = useState<RecurringBillItem | 'new' | null>(null);
  const [open, setOpen] = useState(false);
  const canManage = canManagePlanning(workspace.role);
  const canPay = canRecordTransactions(workspace.role);

  const list = bills.data ?? [];
  const due = list.filter((b) => b.isActive && b.dueStatus !== 'upcoming');
  const upcoming = list.filter((b) => b.isActive && b.dueStatus === 'upcoming');
  const inactive = list.filter((b) => !b.isActive);

  function edit(target: RecurringBillItem | 'new') {
    setEditing(target);
    setOpen(true);
  }

  const section = (title: string, items: RecurringBillItem[]) =>
    items.length === 0 ? null : (
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map((bill) => (
            <BillRow
              key={bill.id}
              bill={bill}
              canPay={canPay}
              canManage={canManage}
              onPay={() => onPay(bill)}
              onEdit={() => edit(bill)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="space-y-5">
      <PageToolbar>
        <p className="text-sm text-slate-500">
          Tidak ada potong saldo otomatis — konfirmasi tiap pembayaran agar nominalnya selalu sesuai.
        </p>
        {canManage ? (
          <PrimaryButton onClick={() => edit('new')}>
            <Plus className="h-4 w-4" /> Tambah Tagihan
          </PrimaryButton>
        ) : null}
      </PageToolbar>

      {bills.error ? <ErrorBox>{bills.error}</ErrorBox> : null}

      {bills.loading && !bills.data ? (
        <LoadingSkeleton label="Memuat tagihan..." />
      ) : list.length === 0 ? (
        <EmptyState>
          <Repeat className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Belum ada tagihan rutin. Contoh: listrik, internet, kos, cicilan, gaji bulanan.
        </EmptyState>
      ) : (
        <>
          {section('Perlu dibayar', due)}
          {section('Mendatang', upcoming)}
          {section('Nonaktif', inactive)}
        </>
      )}

      {editing ? (
        <RecurringDialog
          key={editing === 'new' ? 'new' : editing.id}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setEditing(null)}
          workspace={workspace}
          wallets={wallets}
          categories={categories}
          bill={editing === 'new' ? null : editing}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

const DUE_TONE = {
  overdue: 'bg-rose-50 text-rose-700',
  due_today: 'bg-amber-50 text-amber-800',
  due_soon: 'bg-sky-50 text-sky-700',
  upcoming: 'bg-slate-100 text-slate-600',
} as const;

export function BillRow({
  bill,
  canPay,
  canManage,
  onPay,
  onEdit,
}: {
  bill: RecurringBillItem;
  canPay: boolean;
  canManage: boolean;
  onPay: () => void;
  onEdit?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-3 sm:px-4">
      <button
        type="button"
        onClick={onEdit}
        disabled={!canManage || !onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: `${bill.category?.color ?? '#64748b'}1a`,
            color: bill.category?.color ?? '#64748b',
          }}
        >
          <BellRing className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{bill.title}</span>
          <span className="block truncate text-xs text-slate-500">
            {formatMoney(bill.amountMinor, bill.currency)} · {FREQUENCY_LABEL[bill.frequency]}
            {bill.wallet ? ` · ${bill.wallet.name}` : ''}
          </span>
          {bill.isActive ? (
            <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${DUE_TONE[bill.dueStatus]}`}>
              {dueLabel(bill)}
            </span>
          ) : null}
        </span>
      </button>
      {bill.isActive && canPay ? (
        <button
          type="button"
          onClick={onPay}
          className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
            bill.dueStatus === 'upcoming'
              ? 'border border-slate-200 text-slate-700 hover:bg-slate-50'
              : 'bg-teal-700 text-white shadow-xs hover:bg-teal-800'
          }`}
        >
          {bill.type === 'income' ? 'Terima' : 'Bayar'}
        </button>
      ) : null}
    </li>
  );
}

function RecurringDialog({
  open,
  onClose,
  onExited,
  workspace,
  wallets,
  categories,
  bill,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  wallets: WorkspaceWallet[];
  categories: CategoryItem[];
  bill: RecurringBillItem | null;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(bill?.title ?? '');
  const [type, setType] = useState<'income' | 'expense'>(bill?.type ?? 'expense');
  const [walletId, setWalletId] = useState(bill?.wallet ? String(bill.wallet.id) : wallets[0] ? String(wallets[0].id) : '');
  const [categoryId, setCategoryId] = useState(bill?.category ? String(bill.category.id) : '');
  const [frequency, setFrequency] = useState<RecurringFrequencyType>(bill?.frequency ?? 'monthly');
  const [nextDueDate, setNextDueDate] = useState(bill?.nextDueDate ?? toDateKey(new Date()));
  const [isActive, setIsActive] = useState(bill?.isActive ?? true);
  const wallet = wallets.find((w) => String(w.id) === walletId);
  const currency = wallet?.currency ?? workspace.primaryCurrency;
  const [amount, setAmount] = useState(bill ? formatAmountInput(bill.amountMinor, bill.currency) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Terjadi kesalahan.');
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountMinor = parseAmountInput(amount, currency);
    if (title.trim().length < 2) return setError('Nama tagihan minimal 2 karakter.');
    if (!amountMinor || amountMinor <= 0) return setError('Isi nominal lebih dari 0.');
    if (!nextDueDate) return setError('Isi tanggal jatuh tempo.');
    const payload = {
      title: title.trim(),
      type,
      amountMinor,
      walletId: walletId ? Number(walletId) : null,
      categoryId: categoryId ? Number(categoryId) : null,
      frequency,
      nextDueDate,
      isActive,
    };
    void run(() =>
      apiFetch(bill ? `/api/workspaces/${workspace.id}/recurring/${bill.id}` : `/api/workspaces/${workspace.id}/recurring`, {
        method: bill ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
    );
  }

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="recurring-dialog-title" size="md">
      <ModalHeader
        id="recurring-dialog-title"
        title={bill ? 'Ubah Tagihan Rutin' : 'Tambah Tagihan Rutin'}
        description="Pengingat muncul di Beranda 7 hari sebelum jatuh tempo."
        onClose={onClose}
      />
      <ModalBody>
        <form id="recurring-form" noValidate onSubmit={submit} className="space-y-4">
          <div role="radiogroup" aria-label="Jenis" className="relative grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                <SegmentThumb />
            {(['expense', 'income'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                onClick={() => {
                  setType(option);
                  setCategoryId('');
                }}
                className={`relative rounded-lg py-1.5 text-sm font-semibold transition-colors duration-200 ${
                  type === option ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {TRANSACTION_TYPE_LABEL[option]}
              </button>
            ))}
          </div>

          <FormField id="rec-title" label="Nama" required>
            <input
              id="rec-title"
              autoFocus={!bill}
              autoComplete="off"
              placeholder={type === 'expense' ? 'contoh: Listrik PLN' : 'contoh: Gaji bulanan'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={getInputClassName(false)}
            />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="rec-amount" label="Nominal perkiraan" required hint="Bisa disesuaikan saat membayar.">
              <AmountInput id="rec-amount" currency={currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <FormField id="rec-wallet" label="Dompet">
              <Select
                id="rec-wallet"
                value={walletId}
                onChange={(e) => {
                  const next = wallets.find((w) => String(w.id) === e.target.value);
                  setAmount(convertAmountText(amount, currency, next?.currency ?? workspace.primaryCurrency));
                  setWalletId(e.target.value);
                }}
              >
                <option value="">Pilih saat membayar</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.currency})
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="rec-frequency" label="Frekuensi" required>
              <Select id="rec-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequencyType)}>
                {(['weekly', 'monthly', 'yearly'] as const).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="rec-due" label="Jatuh tempo berikutnya" required>
              <DatePicker id="rec-due" value={nextDueDate} onChange={setNextDueDate} />
            </FormField>
          </div>

          <FormField id="rec-category" label="Kategori">
            <Select id="rec-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Tanpa kategori</option>
              {categories
                .filter((c) => c.type === type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormField>

          {bill ? (
            <label className="flex items-center gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-teal-700"
              />
              Aktif (tampilkan pengingat)
            </label>
          ) : null}

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          {bill ? (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {bill.isActive ? (
                <SecondaryButton
                  disabled={busy}
                  onClick={() =>
                    void run(() => apiFetch(`/api/workspaces/${workspace.id}/recurring/${bill.id}/skip`, { method: 'POST' }))
                  }
                >
                  Lewati periode ini
                </SecondaryButton>
              ) : null}
              {confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => apiFetch(`/api/workspaces/${workspace.id}/recurring/${bill.id}`, { method: 'DELETE' }))}
                  className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  Ya, hapus tagihan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  Hapus
                </button>
              )}
            </div>
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="recurring-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
