import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AppearancePicker } from '@client/components/AppearancePicker';
import { FormField, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { ErrorBox, PageToolbar, PrimaryButton, SecondaryButton } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { AppearanceBadge, categoryAppearance } from '@client/lib/appearance';
import { TRANSACTION_TYPE_LABEL } from '@client/lib/labels';
import type { CategoryItem, WorkspaceSummary } from '@shared/types/domain';
import { type AppearanceIcon, isAppearanceIcon } from '@shared/utils/appearance';
import { canManagePlanning } from '@shared/utils/permissions';
import { CATEGORY_COLORS } from '@shared/validation/planning';

interface CategoriesPageProps {
  workspace: WorkspaceSummary;
  categories: CategoryItem[];
  onChanged: () => void;
}

type Editing = { kind: 'new'; type: 'income' | 'expense' } | { kind: 'edit'; category: CategoryItem };

export function CategoriesPage({ workspace, categories, onChanged }: CategoriesPageProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [open, setOpen] = useState(false);
  const canManage = canManagePlanning(workspace.role);

  function show(state: Editing) {
    setEditing(state);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <PageToolbar>
        <p className="text-sm text-slate-500">Kategori dipakai untuk transaksi, budget, dan tagihan rutin di Workspace ini.</p>
      </PageToolbar>

      <div className="grid gap-4 md:grid-cols-2">
        {(['expense', 'income'] as const).map((type) => (
          <section key={type} className="rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">{TRANSACTION_TYPE_LABEL[type]}</h2>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => show({ kind: 'new', type })}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-slate-100">
              {categories
                .filter((c) => c.type === type)
                .map((cat) => (
                  <li key={cat.id}>
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => show({ kind: 'edit', category: cat })}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-800 transition enabled:hover:bg-slate-50"
                    >
                      <AppearanceBadge appearance={categoryAppearance(cat)} size="sm" variant="soft" />
                      <span className="flex-1 truncate">{cat.name}</span>
                      {canManage ? <span className="text-xs text-slate-400">Ubah</span> : null}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>

      {editing ? (
        <CategoryDialog
          key={editing.kind === 'edit' ? editing.category.id : `new-${editing.type}`}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setEditing(null)}
          workspace={workspace}
          editing={editing}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  open,
  onClose,
  onExited,
  workspace,
  editing,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  editing: Editing;
  onChanged: () => void;
}) {
  const existing = editing.kind === 'edit' ? editing.category : null;
  const type = existing?.type ?? (editing.kind === 'new' ? editing.type : 'expense');
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState<string>(existing?.color ?? CATEGORY_COLORS[5]);
  const [icon, setIcon] = useState<AppearanceIcon>(
    existing?.icon && isAppearanceIcon(existing.icon) ? existing.icon : 'tag'
  );
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
    if (name.trim().length < 2) return setError('Nama kategori minimal 2 karakter.');
    void run(() =>
      existing
        ? apiFetch(`/api/workspaces/${workspace.id}/categories/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: name.trim(), color, icon }),
          })
        : apiFetch(`/api/workspaces/${workspace.id}/categories`, {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), type, color, icon }),
          })
    );
  }

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy="category-dialog-title" size="md">
      <ModalHeader
        id="category-dialog-title"
        title={existing ? 'Ubah Kategori' : `Kategori ${TRANSACTION_TYPE_LABEL[type]} Baru`}
        onClose={onClose}
      />
      <ModalBody>
        <form id="category-form" noValidate onSubmit={submit} className="space-y-4">
          <FormField id="cat-name" label="Nama" required>
            <input
              id="cat-name"
              autoFocus
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={getInputClassName(false)}
            />
          </FormField>
          <AppearancePicker
            value={{ icon, color }}
            onChange={(next) => {
              if (next.icon) setIcon(next.icon);
              if (next.color) setColor(next.color);
            }}
            fallback={{ icon: 'tag', color: CATEGORY_COLORS[5] }}
            previewLabel={name.trim()}
            previewHint={`Kategori ${TRANSACTION_TYPE_LABEL[type].toLowerCase()}`}
          />
          {existing ? (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <p className="text-xs leading-relaxed text-slate-500">
                Menghapus kategori tidak menghapus transaksinya — transaksi lama menjadi "Tanpa kategori" dan budget
                kategori ini ikut dihapus.
              </p>
              {confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => apiFetch(`/api/workspaces/${workspace.id}/categories/${existing.id}`, { method: 'DELETE' }))}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Ya, hapus kategori
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg px-2 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                >
                  Hapus kategori
                </button>
              )}
            </div>
          ) : null}
          {error ? <ErrorBox>{error}</ErrorBox> : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>Batal</SecondaryButton>
        <PrimaryButton type="submit" form="category-form" disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
