import { FileText, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { DatePicker } from '@client/components/DatePicker';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { AmountInput, EmptyState, ErrorBox, PageToolbar, PrimaryButton, ProgressBar, SecondaryButton, LoadingSkeleton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { INVOICE_STATUS, formatDateKey } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import type {
  ClientItem,
  InvoiceItem,
  InvoiceStatusType,
  ProjectItem,
  WorkspaceSummary,
} from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';
import { canManagePlanning, canRecordTransactions } from '@shared/utils/permissions';
import { daysBetween, toDateKey } from '@shared/utils/schedule';

interface InvoicesPageProps {
  workspace: WorkspaceSummary;
  dataVersion: number;
  onRecordPayment: (invoice: InvoiceItem) => void;
  onChanged: () => void;
}

const FILTERS: Array<{ value: 'open' | 'all' | InvoiceStatusType; label: string }> = [
  { value: 'open', label: 'Belum lunas' },
  { value: 'overdue', label: 'Jatuh tempo' },
  { value: 'draft', label: 'Draft' },
  { value: 'paid', label: 'Lunas' },
  { value: 'all', label: 'Semua' },
];

export function InvoicesPage({ workspace, dataVersion, onRecordPayment, onChanged }: InvoicesPageProps) {
  const invoices = useApi<InvoiceItem[]>(`/api/workspaces/${workspace.id}/invoices`, dataVersion);
  const clients = useApi<ClientItem[]>(`/api/workspaces/${workspace.id}/clients`, dataVersion);
  const projects = useApi<ProjectItem[]>(`/api/workspaces/${workspace.id}/projects`, dataVersion);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('open');
  const [editing, setEditing] = useState<InvoiceItem | 'new' | null>(null);
  const [open, setOpen] = useState(false);
  const canManage = canManagePlanning(workspace.role);
  const canPay = canRecordTransactions(workspace.role);
  const currency = workspace.primaryCurrency;

  const all = invoices.data ?? [];
  const sentOrLater = all.filter((i) => i.status !== 'draft');
  const receivable = sentOrLater.reduce((acc, i) => acc + Math.max(0, i.amountMinor - i.paidMinor), 0);
  const overdue = all.filter((i) => i.status === 'overdue');
  const overdueTotal = overdue.reduce((acc, i) => acc + (i.amountMinor - i.paidMinor), 0);
  const visible = all.filter((i) =>
    filter === 'all' ? true : filter === 'open' ? i.status !== 'paid' && i.status !== 'draft' : i.status === filter
  );

  function edit(target: InvoiceItem | 'new') {
    if (!canManage) return;
    setEditing(target);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-medium text-slate-500">Total piutang</p>
          <p className="mt-1 truncate text-lg font-bold tracking-tight text-slate-900 tabular-nums sm:text-xl">
            {formatMoney(receivable, currency)}
          </p>
        </div>
        <div className={`rounded-2xl border p-4 shadow-xs ${overdue.length ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'}`}>
          <p className="text-xs font-medium text-slate-500">Lewat jatuh tempo ({overdue.length})</p>
          <p className={`mt-1 truncate text-lg font-bold tracking-tight tabular-nums sm:text-xl ${overdue.length ? 'text-rose-700' : 'text-slate-900'}`}>
            {formatMoney(overdueTotal, currency)}
          </p>
        </div>
      </section>

      <PageToolbar>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filter === f.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canManage ? (
          <PrimaryButton onClick={() => edit('new')}>
            <Plus className="h-4 w-4" /> Buat Invoice
          </PrimaryButton>
        ) : null}
      </PageToolbar>

      {invoices.error ? <ErrorBox>{invoices.error}</ErrorBox> : null}

      {invoices.loading && !invoices.data ? (
        <LoadingSkeleton label="Memuat invoice..." />
      ) : visible.length === 0 ? (
        <EmptyState>
          <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          {all.length === 0 ? 'Belum ada invoice.' : 'Tidak ada invoice dengan filter ini.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map((inv) => {
            const status = INVOICE_STATUS[inv.status];
            const remaining = inv.amountMinor - inv.paidMinor;
            const percent = inv.amountMinor ? Math.floor((inv.paidMinor * 100) / inv.amountMinor) : 0;
            const overdueDays = inv.dueDate ? -daysBetween(toDateKey(new Date()), inv.dueDate) : 0;
            return (
              <li key={inv.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <button type="button" onClick={() => edit(inv)} disabled={!canManage} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500">{inv.number}</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">{inv.title}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[inv.client?.name ?? 'Tanpa klien', inv.project?.name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-slate-900 tabular-nums">{formatMoney(inv.amountMinor, inv.currency)}</span>
                      <span className={`block text-xs ${inv.status === 'overdue' ? 'font-medium text-rose-700' : 'text-slate-500'}`}>
                        {inv.dueDate
                          ? inv.status === 'overdue'
                            ? `Lewat ${overdueDays} hari`
                            : `Jatuh tempo ${formatDateKey(inv.dueDate)}`
                          : `Terbit ${formatDateKey(inv.issuedAt)}`}
                      </span>
                    </span>
                  </div>
                  {inv.paidMinor > 0 && inv.status !== 'paid' ? (
                    <div className="mt-3 space-y-1">
                      <ProgressBar percent={percent} tone="goal" label={`Pembayaran ${inv.number}`} />
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Terbayar {formatMoney(inv.paidMinor, inv.currency)} · sisa {formatMoney(remaining, inv.currency)}
                      </p>
                    </div>
                  ) : null}
                </button>
                {canPay && inv.status !== 'paid' && inv.status !== 'draft' ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onRecordPayment(inv)}
                      className="rounded-xl bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800"
                    >
                      Catat Pembayaran
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <InvoiceDialog
          key={editing === 'new' ? 'new' : editing.id}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setEditing(null)}
          workspace={workspace}
          invoice={editing === 'new' ? null : editing}
          clients={clients.data ?? []}
          projects={projects.data ?? []}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function InvoiceDialog({
  open,
  onClose,
  onExited,
  workspace,
  invoice,
  clients,
  projects,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  invoice: InvoiceItem | null;
  clients: ClientItem[];
  projects: ProjectItem[];
  onChanged: () => void;
}) {
  const currency = workspace.primaryCurrency;
  const today = toDateKey(new Date());
  const [number, setNumber] = useState(invoice?.number ?? '');
  const [title, setTitle] = useState(invoice?.title ?? '');
  const [amount, setAmount] = useState(invoice ? formatAmountInput(invoice.amountMinor, currency) : '');
  const [clientId, setClientId] = useState(invoice?.client ? String(invoice.client.id) : '');
  const [projectId, setProjectId] = useState(invoice?.project ? String(invoice.project.id) : '');
  const [issuedAt, setIssuedAt] = useState(invoice?.issuedAt ?? today);
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? '');
  const [sent, setSent] = useState(invoice ? invoice.status !== 'draft' : false);
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
    if (title.trim().length < 2) return setError('Judul invoice minimal 2 karakter.');
    if (!amountMinor || amountMinor <= 0) return setError('Isi nominal lebih dari 0.');
    if (dueDate && dueDate < issuedAt) return setError('Jatuh tempo tidak boleh sebelum tanggal terbit.');
    const payload = {
      number: number.trim() || null,
      title: title.trim(),
      amountMinor,
      clientId: clientId ? Number(clientId) : null,
      projectId: projectId ? Number(projectId) : null,
      issuedAt,
      dueDate: dueDate || null,
      status: sent ? 'sent' : 'draft',
    };
    void run(() =>
      apiFetch(invoice ? `/api/workspaces/${workspace.id}/invoices/${invoice.id}` : `/api/workspaces/${workspace.id}/invoices`, {
        method: invoice ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
    );
  }

  // Project yang dipilih sebaiknya milik klien yang dipilih.
  const projectOptions = clientId ? projects.filter((p) => !p.client || String(p.client.id) === clientId) : projects;

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="invoice-dialog-title">
      <ModalHeader
        id="invoice-dialog-title"
        title={invoice ? `Invoice ${invoice.number}` : 'Invoice Baru'}
        description={
          invoice && invoice.paidMinor > 0
            ? `Terbayar ${formatMoney(invoice.paidMinor, invoice.currency)} dari ${invoice.paymentCount} pembayaran`
            : 'Pembayaran dicatat sebagai transaksi pemasukan yang ditautkan ke invoice ini.'
        }
        onClose={onClose}
      />
      <ModalBody>
        <form id="invoice-form" noValidate onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <FormField id="inv-title" label="Judul" required>
              <input
                id="inv-title"
                autoFocus={!invoice}
                autoComplete="off"
                placeholder="contoh: DP 50% Website"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={getInputClassName(false)}
              />
            </FormField>
            <FormField id="inv-number" label="Nomor" hint={invoice ? undefined : 'Kosongkan untuk nomor otomatis'}>
              <input
                id="inv-number"
                autoComplete="off"
                placeholder="INV-…"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className={getInputClassName(false)}
              />
            </FormField>
          </div>
          <FormField id="inv-amount" label="Nominal" required>
            <AmountInput id="inv-amount" currency={currency} large value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="inv-client" label="Klien">
              <Select id="inv-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Tanpa klien</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="inv-project" label="Project">
              <Select id="inv-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Tanpa project</option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="inv-issued" label="Tanggal terbit" required>
              <DatePicker id="inv-issued" value={issuedAt} onChange={setIssuedAt} />
            </FormField>
            <FormField id="inv-due" label="Jatuh tempo">
              <DatePicker id="inv-due" value={dueDate} min={issuedAt} onChange={setDueDate} placeholder="Tanpa jatuh tempo" clearable />
            </FormField>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={sent}
              onChange={(e) => setSent(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-teal-700"
            />
            Sudah dikirim ke klien (dihitung sebagai piutang)
          </label>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {invoice ? (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <p className="text-xs leading-relaxed text-slate-500">
                Menghapus invoice tidak menghapus transaksi pembayarannya — transaksi hanya dilepas dari invoice.
              </p>
              {confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => apiFetch(`/api/workspaces/${workspace.id}/invoices/${invoice.id}`, { method: 'DELETE' }))}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Ya, hapus invoice
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-lg px-2 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50">
                  Hapus invoice
                </button>
              )}
            </div>
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="invoice-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
