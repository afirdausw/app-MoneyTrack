import { zodResolver } from '@hookform/resolvers/zod';
import { Briefcase, Check, Palette, Settings2, Trash2, User, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AppearancePicker } from '@client/components/AppearancePicker';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { SegmentThumb } from '@client/components/SegmentThumb';
import { WorkspaceMembersPanel } from '@client/components/WorkspaceMembersPanel';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { WORKSPACE_DEFAULT_APPEARANCE } from '@client/lib/appearance';
import { MODE_LABEL } from '@client/lib/labels';
import {
  CURRENCY_CODES,
  type WorkspaceSummary,
  type WorkspaceType,
} from '@shared/types/domain';
import { isAppearanceIcon } from '@shared/utils/appearance';
import { canDeleteWorkspace, canManageWorkspace } from '@shared/utils/permissions';
import { type CreateWorkspaceInput, createWorkspaceSchema } from '@shared/validation/workspace';

export type WorkspaceDialogMode = { kind: 'create' } | { kind: 'edit'; workspace: WorkspaceSummary };

interface WorkspaceDialogProps {
  mode: WorkspaceDialogMode;
  open: boolean;
  currentUserId: number;
  /** Dipanggil setelah user aktif keluar dari Workspace. */
  onLeft: (workspaceId: number) => void;
  onClose: () => void;
  onExited: () => void;
  onCreated: (workspace: WorkspaceSummary) => void;
  onUpdated: (workspace: WorkspaceSummary) => void;
  onDeleted: (workspaceId: number) => void;
}

const TYPE_OPTIONS: Array<{ value: WorkspaceType; label: string; hint: string; icon: typeof User }> = [
  { value: 'personal', label: 'Pribadi', hint: 'Budget, goals & tagihan rutin', icon: User },
  { value: 'shared', label: 'Shared', hint: 'Pasangan, keluarga & komunitas', icon: Users },
  { value: 'business', label: 'Bisnis', hint: 'Freelancer, UMKM & project', icon: Briefcase },
];

type Tab = 'general' | 'appearance' | 'members';

const FORM_ID = 'workspace-form';
const TITLE_ID = 'workspace-dialog-title';

export function WorkspaceDialog({
  mode,
  open,
  currentUserId,
  onLeft,
  onClose,
  onExited,
  onCreated,
  onUpdated,
  onDeleted,
}: WorkspaceDialogProps) {
  const editing = mode.kind === 'edit' ? mode.workspace : null;
  // Non-admin hanya bisa melihat pengaturan & anggota (dan keluar dari Workspace).
  const readOnly = editing !== null && !canManageWorkspace(editing.role);
  const [tab, setTab] = useState<Tab>('general');
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    // Validasi baru jalan saat submit (lalu live saat mengetik), bukan saat input kehilangan fokus —
    // supaya menekan Batal / X / area luar tidak memunculkan pesan error sebelum modal tertutup.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: editing?.name ?? '',
      type: editing?.type ?? 'shared',
      primaryCurrency: editing?.primaryCurrency ?? 'IDR',
      icon: editing?.icon && isAppearanceIcon(editing.icon) ? editing.icon : null,
      color: editing?.color ?? null,
    },
  });

  const selectedType = watch('type');
  const nameValue = watch('name');
  const iconValue = watch('icon') ?? null;
  const colorValue = watch('color') ?? null;

  async function onSubmit(values: CreateWorkspaceInput) {
    setServerError(null);
    try {
      if (editing) {
        const updated = await apiFetch<WorkspaceSummary>(`/api/workspaces/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            primaryCurrency: values.primaryCurrency,
            icon: values.icon ?? null,
            color: values.color ?? null,
          }),
        });
        onUpdated(updated);
      } else {
        const created = await apiFetch<WorkspaceSummary>('/api/workspaces', {
          method: 'POST',
          body: JSON.stringify(values),
        });
        onCreated(created);
      }
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan Workspace.');
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setServerError(null);
    setDeleting(true);
    try {
      await apiFetch(`/api/workspaces/${editing.id}`, { method: 'DELETE' });
      onDeleted(editing.id);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal menghapus Workspace.');
      setDeleting(false);
    }
  }

  const appearancePicker = (
    <AppearancePicker
      value={{ icon: iconValue, color: colorValue }}
      onChange={(next) => {
        setValue('icon', next.icon, { shouldDirty: true });
        setValue('color', next.color, { shouldDirty: true });
      }}
      fallback={WORKSPACE_DEFAULT_APPEARANCE[selectedType]}
      previewLabel={nameValue.trim()}
      previewHint={`Workspace ${MODE_LABEL[selectedType]}`}
      allowReset
      disabled={readOnly}
    />
  );

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy={TITLE_ID}>
      <ModalHeader
        id={TITLE_ID}
        title={editing ? editing.name : 'Buat Workspace Baru'}
        description={
          editing
            ? readOnly
              ? 'Kamu bisa melihat pengaturan dan anggota Workspace ini.'
              : 'Atur detail ruang keuangan dan siapa saja yang bisa mengaksesnya.'
            : 'Kategori bawaan otomatis dibuat sesuai mode yang dipilih.'
        }
        onClose={onClose}
      >
        {editing ? (
          <div
            role="tablist"
            aria-label="Pengaturan Workspace"
            className="relative mb-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
          >
            <SegmentThumb />
            <TabButton active={tab === 'general'} onClick={() => setTab('general')} icon={Settings2}>
              Umum
            </TabButton>
            <TabButton active={tab === 'appearance'} onClick={() => setTab('appearance')} icon={Palette}>
              Tampilan
            </TabButton>
            <TabButton active={tab === 'members'} onClick={() => setTab('members')} icon={Users}>
              Anggota
            </TabButton>
          </div>
        ) : null}
      </ModalHeader>

      <ModalBody>
        {/* Kedua tab tetap ter-mount agar isian form & link undangan tidak hilang saat berpindah tab. */}
        <div hidden={tab !== 'general'} className="animate-fade-up space-y-6">
          <form id={FORM_ID} noValidate onSubmit={handleSubmit(onSubmit, () => setTab('general'))} className="space-y-5">
            <fieldset disabled={readOnly} className="space-y-5">
            <FormField id="ws-name" label="Nama Workspace" required error={errors.name?.message}>
              <input
                id="ws-name"
                autoFocus={!editing}
                autoComplete="off"
                placeholder="contoh: Kas Kos Melati"
                className={getInputClassName(Boolean(errors.name))}
                {...register('name')}
              />
            </FormField>

            {editing ? null : (
              <fieldset className="space-y-2">
                <legend className="mb-2 block text-xs font-medium text-slate-700">
                  Mode<span className="ml-0.5 text-rose-600">*</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TYPE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = selectedType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setValue('type', opt.value, { shouldDirty: true })}
                        className={`relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition sm:flex-col sm:items-start sm:gap-2 ${
                          active
                            ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            active ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Icon className="h-4.5 w-4.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{opt.label}</span>
                          <span className="block text-xs leading-snug text-slate-500">{opt.hint}</span>
                        </span>
                        {active ? (
                          <Check className="absolute top-3 right-3 h-4 w-4 text-teal-700" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {errors.type ? (
                  <p role="alert" className="text-xs font-medium text-rose-600">
                    {errors.type.message}
                  </p>
                ) : null}
              </fieldset>
            )}

            <FormField
              id="ws-currency"
              label="Mata Uang Utama"
              required
              error={errors.primaryCurrency?.message}
              hint="Laporan Workspace dihitung dalam mata uang ini. Terkunci setelah ada transaksi."
            >
              <Select id="ws-currency" hasError={Boolean(errors.primaryCurrency)} {...register('primaryCurrency')}>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </FormField>

            {/* Saat membuat Workspace belum ada tab, jadi pilihan tampilan ikut di form ini. */}
            {editing ? null : appearancePicker}

            </fieldset>
            {serverError ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                {serverError}
              </div>
            ) : null}
          </form>

          {editing && canDeleteWorkspace(editing.role) ? (
            <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4">
              <div>
                <p className="text-sm font-semibold text-rose-800">Hapus Workspace</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                  Seluruh kategori, transaksi, budget, dan anggota ikut terhapus permanen. Ketik{' '}
                  <strong className="text-slate-900">{editing.name}</strong> untuk konfirmasi.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  aria-label="Konfirmasi nama Workspace"
                  autoComplete="off"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  placeholder={editing.name}
                  className={getInputClassName(false, 'bg-white sm:flex-1')}
                />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || confirmName !== editing.name}
                  className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? 'Menghapus...' : 'Hapus Permanen'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {editing ? (
          <div hidden={tab !== 'appearance'} className="animate-fade-up space-y-3">
            <p className="text-sm text-slate-500">
              Ikon & warna membantu membedakan Workspace di daftar dan di bagian atas layar. Berlaku untuk semua anggota.
            </p>
            {appearancePicker}
          </div>
        ) : null}

        {editing ? (
          <div hidden={tab !== 'members'} className="animate-fade-up">
            <WorkspaceMembersPanel workspace={editing} currentUserId={currentUserId} onLeft={onLeft} />
          </div>
        ) : null}
      </ModalBody>

      <ModalFooter>
        {tab !== 'members' && !readOnly ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting || (editing !== null && !isDirty)}
              className="rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Buat Workspace'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Tutup
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: typeof User;
  children: string;
}

function TabButton({ active, onClick, icon: Icon, children }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      // Segmented control, seragam dengan pilihan jenis di dialog Catat Transaksi.
      className={`relative flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors duration-200 ${
        active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 transition-colors duration-200 ${active ? 'text-teal-700' : ''}`} />
      <span className="truncate">{children}</span>
    </button>
  );
}
