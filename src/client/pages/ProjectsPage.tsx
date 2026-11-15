import { Building2, FolderKanban, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { SegmentThumb } from '@client/components/SegmentThumb';
import { AmountInput, EmptyState, ErrorBox, PageToolbar, PrimaryButton, ProgressBar, SecondaryButton, LoadingSkeleton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { PROJECT_STATUS } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import type { ClientItem, ProjectItem, ProjectStatus, WorkspaceSummary } from '@shared/types/domain';
import { budgetPercent, budgetStatus } from '@shared/utils/budget';
import { formatMoney } from '@client/lib/privacy';
import { formatAmountInput, parseAmountInput } from '@shared/utils/money';
import { canManagePlanning } from '@shared/utils/permissions';

interface ProjectsPageProps {
  workspace: WorkspaceSummary;
  dataVersion: number;
  onChanged: () => void;
}

type Dialog = { kind: 'project'; item: ProjectItem | null } | { kind: 'client'; item: ClientItem | null };

export function ProjectsPage({ workspace, dataVersion, onChanged }: ProjectsPageProps) {
  const [tab, setTab] = useState<'projects' | 'clients'>('projects');
  const projects = useApi<ProjectItem[]>(`/api/workspaces/${workspace.id}/projects`, dataVersion);
  const clients = useApi<ClientItem[]>(`/api/workspaces/${workspace.id}/clients`, dataVersion);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [open, setOpen] = useState(false);
  const canManage = canManagePlanning(workspace.role);
  const currency = workspace.primaryCurrency;

  function show(state: Dialog) {
    if (!canManage) return;
    setDialog(state);
    setOpen(true);
  }

  const projectList = projects.data ?? [];
  const clientList = clients.data ?? [];
  const totalProfit = projectList.reduce((acc, p) => acc + p.profitMinor, 0);
  const activeCount = projectList.filter((p) => p.status === 'active').length;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Project aktif" value={String(activeCount)} />
        <Stat
          label="Profit semua project"
          value={formatMoney(totalProfit, currency)}
          tone={totalProfit < 0 ? 'text-rose-700' : 'text-slate-900'}
        />
        <Stat label="Klien" value={String(clientList.length)} className="col-span-2 sm:col-span-1" />
      </section>

      <PageToolbar>
        <div role="tablist" aria-label="Bisnis" className="relative inline-flex rounded-xl bg-slate-100 p-1">
          <SegmentThumb />
          {(['projects', 'clients'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`relative rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors duration-200 ${
                tab === t ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t === 'projects' ? 'Project' : 'Klien'}
            </button>
          ))}
        </div>
        {canManage ? (
          <PrimaryButton onClick={() => show(tab === 'projects' ? { kind: 'project', item: null } : { kind: 'client', item: null })}>
            <Plus className="h-4 w-4" /> {tab === 'projects' ? 'Tambah Project' : 'Tambah Klien'}
          </PrimaryButton>
        ) : null}
      </PageToolbar>

      {projects.error || clients.error ? <ErrorBox>{projects.error ?? clients.error}</ErrorBox> : null}

      {tab === 'projects' ? (
        projects.loading && !projects.data ? (
          <Loading />
        ) : projectList.length === 0 ? (
          <EmptyState>
            <FolderKanban className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            Belum ada project. Tautkan pemasukan & biaya ke project untuk melihat profit bersihnya.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {projectList.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} currency={currency} canManage={canManage} onOpen={() => show({ kind: 'project', item: p })} />
              </li>
            ))}
          </ul>
        )
      ) : clients.loading && !clients.data ? (
        <Loading />
      ) : clientList.length === 0 ? (
        <EmptyState>
          <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Belum ada klien.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {clientList.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => show({ kind: 'client', item: c })}
                disabled={!canManage}
                className="w-full px-4 py-3 text-left transition enabled:hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{c.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[c.company, c.email, `${c.projectCount} project`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${c.profitMinor < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {formatMoney(c.profitMinor, currency)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
                  <span>
                    <span className="block text-slate-500">Ditagih</span>
                    <span className="text-slate-800">{formatMoney(c.invoicedMinor, currency)}</span>
                  </span>
                  <span>
                    <span className="block text-slate-500">Terbayar</span>
                    <span className="text-slate-800">{formatMoney(c.paidMinor, currency)}</span>
                  </span>
                  <span>
                    <span className="block text-slate-500">Piutang</span>
                    <span className={c.outstandingMinor > 0 ? 'font-medium text-amber-700' : 'text-slate-800'}>
                      {formatMoney(c.outstandingMinor, currency)}
                    </span>
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'project' ? (
        <ProjectDialog
          key={dialog.item?.id ?? 'new'}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setDialog(null)}
          workspace={workspace}
          project={dialog.item}
          clients={clientList}
          onChanged={onChanged}
        />
      ) : dialog?.kind === 'client' ? (
        <ClientDialog
          key={dialog.item?.id ?? 'new'}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setDialog(null)}
          workspace={workspace}
          client={dialog.item}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <LoadingSkeleton label="Memuat..." />
  );
}

function Stat({ label, value, tone = 'text-slate-900', className = '' }: { label: string; value: string; tone?: string; className?: string }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs ${className}`}>
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold tracking-tight tabular-nums sm:text-xl ${tone}`}>{value}</p>
    </div>
  );
}

function ProjectCard({
  project,
  currency,
  canManage,
  onOpen,
}: {
  project: ProjectItem;
  currency: WorkspaceSummary['primaryCurrency'];
  canManage: boolean;
  onOpen: () => void;
}) {
  const status = PROJECT_STATUS[project.status];
  const hasBudget = project.budgetMinor > 0;
  const percent = budgetPercent(project.expenseMinor, hasBudget ? project.budgetMinor : null);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!canManage}
      className="flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition enabled:hover:border-slate-300"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">{project.name}</span>
          <span className="block truncate text-xs text-slate-500">{project.client?.name ?? 'Tanpa klien'}</span>
        </span>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div>
          <dt className="text-slate-500">Omzet</dt>
          <dd className="font-medium text-emerald-700">{formatMoney(project.incomeMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Biaya</dt>
          <dd className="font-medium text-rose-700">{formatMoney(project.expenseMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Profit</dt>
          <dd className={`font-semibold ${project.profitMinor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
            {formatMoney(project.profitMinor, currency)}
          </dd>
        </div>
      </dl>
      {hasBudget ? (
        <div className="mt-3 space-y-1">
          <ProgressBar percent={percent} tone={budgetStatus(project.expenseMinor, project.budgetMinor)} label={`Anggaran ${project.name}`} />
          <p className="text-[11px] text-slate-500 tabular-nums">
            Biaya {percent}% dari anggaran {formatMoney(project.budgetMinor, currency)}
          </p>
        </div>
      ) : null}
    </button>
  );
}

function useAction(onChanged: () => void, onClose: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  return { error, setError, busy, run };
}

function DeleteRow({ label, note, onConfirm, busy }: { label: string; note: string; onConfirm: () => void; busy: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <p className="text-xs leading-relaxed text-slate-500">{note}</p>
      {confirm ? (
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
        >
          Ya, {label.toLowerCase()}
        </button>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="rounded-lg px-2 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50">
          {label}
        </button>
      )}
    </div>
  );
}

function ProjectDialog({
  open,
  onClose,
  onExited,
  workspace,
  project,
  clients,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  project: ProjectItem | null;
  clients: ClientItem[];
  onChanged: () => void;
}) {
  const currency = workspace.primaryCurrency;
  const [name, setName] = useState(project?.name ?? '');
  const [clientId, setClientId] = useState(project?.client ? String(project.client.id) : '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active');
  const [budget, setBudget] = useState(project?.budgetMinor ? formatAmountInput(project.budgetMinor, currency) : '');
  const { error, setError, busy, run } = useAction(onChanged, onClose);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError('Nama project minimal 2 karakter.');
    const budgetMinor = budget.trim() ? parseAmountInput(budget, currency) : 0;
    if (budgetMinor === null || budgetMinor < 0) return setError('Anggaran harus angka.');
    const payload = { name: name.trim(), clientId: clientId ? Number(clientId) : null, status, budgetMinor };
    void run(() =>
      apiFetch(project ? `/api/workspaces/${workspace.id}/projects/${project.id}` : `/api/workspaces/${workspace.id}/projects`, {
        method: project ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
    );
  }

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="project-dialog-title" size="md">
      <ModalHeader id="project-dialog-title" title={project ? 'Ubah Project' : 'Project Baru'} onClose={onClose} />
      <ModalBody>
        <form id="project-form" noValidate onSubmit={submit} className="space-y-4">
          <FormField id="project-name" label="Nama Project" required>
            <input
              id="project-name"
              autoFocus={!project}
              autoComplete="off"
              placeholder="contoh: Website Company Profile"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={getInputClassName(false)}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="project-client" label="Klien">
              <Select id="project-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Tanpa klien</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="project-status" label="Status">
              <Select id="project-status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                {(['active', 'paused', 'completed'] as const).map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS[s].label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField id="project-budget" label="Anggaran biaya (opsional)" hint="Dipakai untuk memantau biaya project.">
            <AmountInput id="project-budget" currency={currency} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </FormField>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {project ? (
            <DeleteRow
              label="Hapus project"
              note="Transaksi project tetap ada, hanya dilepas dari project ini. Invoice project tetap tersimpan."
              busy={busy}
              onConfirm={() => void run(() => apiFetch(`/api/workspaces/${workspace.id}/projects/${project.id}`, { method: 'DELETE' }))}
            />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="project-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

function ClientDialog({
  open,
  onClose,
  onExited,
  workspace,
  client,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  client: ClientItem | null;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({
    name: client?.name ?? '',
    company: client?.company ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    notes: client?.notes ?? '',
  });
  const { error, setError, busy, run } = useAction(onChanged, onClose);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (form.name.trim().length < 2) return setError('Nama klien minimal 2 karakter.');
    void run(() =>
      apiFetch(client ? `/api/workspaces/${workspace.id}/clients/${client.id}` : `/api/workspaces/${workspace.id}/clients`, {
        method: client ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      })
    );
  }

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="client-dialog-title" size="md">
      <ModalHeader id="client-dialog-title" title={client ? 'Ubah Klien' : 'Klien Baru'} onClose={onClose} />
      <ModalBody>
        <form id="client-form" noValidate onSubmit={submit} className="space-y-4">
          <FormField id="client-name" label="Nama" required>
            <input id="client-name" autoFocus={!client} autoComplete="off" value={form.name} onChange={set('name')} className={getInputClassName(false)} />
          </FormField>
          <FormField id="client-company" label="Perusahaan">
            <input id="client-company" autoComplete="off" value={form.company} onChange={set('company')} className={getInputClassName(false)} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="client-email" label="Email">
              <input id="client-email" type="email" autoComplete="off" value={form.email} onChange={set('email')} className={getInputClassName(false)} />
            </FormField>
            <FormField id="client-phone" label="Telepon / WA">
              <input id="client-phone" type="tel" autoComplete="off" value={form.phone} onChange={set('phone')} className={getInputClassName(false)} />
            </FormField>
          </div>
          <FormField id="client-notes" label="Catatan">
            <textarea id="client-notes" rows={2} value={form.notes} onChange={set('notes')} className={getInputClassName(false, 'resize-none')} />
          </FormField>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {client ? (
            <DeleteRow
              label="Hapus klien"
              note="Project & invoice klien ini tetap ada, hanya menjadi tanpa klien."
              busy={busy}
              onConfirm={() => void run(() => apiFetch(`/api/workspaces/${workspace.id}/clients/${client.id}`, { method: 'DELETE' }))}
            />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="client-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
