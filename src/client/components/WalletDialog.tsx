import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Unlink } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AppearancePicker, type AppearanceValue } from '@client/components/AppearancePicker';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { AmountInput } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { ICON_COMPONENT, WALLET_DEFAULT_APPEARANCE } from '@client/lib/appearance';
import { VISIBILITY_LABEL, WALLET_KIND_LABEL } from '@client/lib/labels';
import { useApi } from '@client/lib/useApi';
import { convertAmountText } from '@client/lib/amountText';
import {
  CURRENCY_CODES,
  type CurrencyCode,
  type MyWallet,
  WALLET_KINDS,
  type WalletKind,
  type WalletVisibilityMode,
  type WorkspaceSummary,
  type WorkspaceWallet,
} from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { isAppearanceIcon } from '@shared/utils/appearance';
import { parseAmountInput } from '@shared/utils/money';
import { canManageWorkspace } from '@shared/utils/permissions';

export type WalletDialogMode =
  | { kind: 'create' }
  | { kind: 'link' }
  | { kind: 'manage'; wallet: WorkspaceWallet };

interface WalletDialogProps {
  mode: WalletDialogMode;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  onChanged: () => void;
}

const TITLE_ID = 'wallet-dialog-title';
const FORM_ID = 'wallet-form';

export function defaultVisibility(workspace: WorkspaceSummary): WalletVisibilityMode {
  return workspace.type === 'shared' ? 'full_transparent' : 'workspace_only';
}

export function WalletDialog({ mode, open, onClose, onExited, workspace, onChanged }: WalletDialogProps) {
  const heading =
    mode.kind === 'create'
      ? { title: 'Tambah Dompet', description: 'Rekening, e-wallet, atau kas tunai yang dipakai di Workspace ini.' }
      : mode.kind === 'link'
        ? { title: 'Tautkan Dompet Saya', description: 'Pakai dompet yang sudah ada di Workspace lain — saldonya tetap satu.' }
        : { title: mode.wallet.name, description: `${WALLET_KIND_LABEL[mode.wallet.kind]} milik ${mode.wallet.ownerName}` };

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy={TITLE_ID} size="md">
      <ModalHeader id={TITLE_ID} title={heading.title} description={heading.description} onClose={onClose} />
      {mode.kind === 'create' ? (
        <CreateWalletForm workspace={workspace} onClose={onClose} onChanged={onChanged} />
      ) : mode.kind === 'link' ? (
        <LinkWalletForm workspace={workspace} onClose={onClose} onChanged={onChanged} />
      ) : (
        <ManageWallet wallet={mode.wallet} workspace={workspace} onClose={onClose} onChanged={onChanged} />
      )}
    </Modal>
  );
}

interface FormProps {
  workspace: WorkspaceSummary;
  onClose: () => void;
  onChanged: () => void;
}

interface CreateValues {
  name: string;
  kind: WalletKind;
  currency: CurrencyCode;
  openingBalance: string;
  visibilityMode: WalletVisibilityMode;
}

function CreateWalletForm({ workspace, onClose, onChanged }: FormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<AppearanceValue>({ icon: null, color: null });
  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(2, 'Nama dompet minimal 2 karakter').max(100, 'Maksimal 100 karakter'),
          kind: z.enum(WALLET_KINDS),
          currency: z.enum(CURRENCY_CODES),
          openingBalance: z.string(),
          visibilityMode: z.enum(['workspace_only', 'full_transparent']),
        })
        .superRefine((v, ctx) => {
          if (v.openingBalance.trim() && parseAmountInput(v.openingBalance, v.currency) === null) {
            ctx.addIssue({ code: 'custom', path: ['openingBalance'], message: 'Saldo awal harus berupa angka' });
          }
        }),
    []
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      kind: 'bank',
      currency: workspace.primaryCurrency,
      openingBalance: '',
      visibilityMode: defaultVisibility(workspace),
    },
  });

  const kind = watch('kind');
  const currency = watch('currency');
  const visibility = watch('visibilityMode');

  async function onSubmit(values: CreateValues) {
    setServerError(null);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/wallets`, {
        method: 'POST',
        body: JSON.stringify({
          name: values.name.trim(),
          kind: values.kind,
          currency: values.currency,
          openingBalanceMinor: parseAmountInput(values.openingBalance, values.currency) ?? 0,
          visibilityMode: values.visibilityMode,
          icon: appearance.icon,
          color: appearance.color,
        }),
      });
      onChanged();
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal menambah dompet.');
    }
  }

  return (
    <>
      <ModalBody>
        <form id={FORM_ID} noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <FormField id="wallet-name" label="Nama Dompet" required error={errors.name?.message}>
            <input
              id="wallet-name"
              autoFocus
              autoComplete="off"
              placeholder="contoh: BCA Utama, GoPay, Kas Tunai"
              className={getInputClassName(Boolean(errors.name))}
              {...register('name')}
            />
          </FormField>

          <fieldset>
            <legend className="mb-2 block text-xs font-medium text-slate-700">Jenis</legend>
            <div className="flex flex-wrap gap-1.5">
              {WALLET_KINDS.map((option) => {
                const Icon = ICON_COMPONENT[WALLET_DEFAULT_APPEARANCE[option].icon];
                const active = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setValue('kind', option)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-teal-600 bg-teal-50 text-teal-800'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {WALLET_KIND_LABEL[option]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <FormField id="wallet-currency" label="Mata Uang" required>
              <Select
                id="wallet-currency"
                {...register('currency', {
                  onChange: (event: { target: { value: string } }) =>
                    setValue(
                      'openingBalance',
                      convertAmountText(watch('openingBalance') ?? '', currency, event.target.value as CurrencyCode)
                    ),
                })}
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              id="wallet-opening"
              label="Saldo Saat Ini"
              error={errors.openingBalance?.message}
              hint="Kosongkan bila mulai dari 0. Awali dengan - untuk saldo minus (kartu kredit)."
            >
              <AmountInput
                id="wallet-opening"
                currency={currency}
                allowNegative
                hasError={Boolean(errors.openingBalance)}
                {...register('openingBalance')}
              />
            </FormField>
          </div>

          <AppearancePicker
            value={appearance}
            onChange={setAppearance}
            fallback={WALLET_DEFAULT_APPEARANCE[kind]}
            previewLabel={(watch('name') ?? '').trim()}
            previewHint={WALLET_KIND_LABEL[kind]}
            allowReset
          />

          <VisibilityPicker value={visibility} onChange={(v) => setValue('visibilityMode', v)} />

          {serverError ? <ErrorBox message={serverError} /> : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <SubmitButton disabled={isSubmitting} label={isSubmitting ? 'Menyimpan...' : 'Tambah Dompet'} />
      </ModalFooter>
    </>
  );
}

function LinkWalletForm({ workspace, onClose, onChanged }: FormProps) {
  const mine = useApi<MyWallet[]>('/api/wallets');
  const [walletId, setWalletId] = useState('');
  const [visibility, setVisibility] = useState<WalletVisibilityMode>(defaultVisibility(workspace));
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const candidates = (mine.data ?? []).filter((w) => !w.linkedWorkspaces.some((l) => l.id === workspace.id));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!walletId) {
      setServerError('Pilih dompet yang ingin ditautkan.');
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/wallets/link`, {
        method: 'POST',
        body: JSON.stringify({ walletId: Number(walletId), visibilityMode: visibility }),
      });
      onChanged();
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal menautkan dompet.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <ModalBody>
        <form id={FORM_ID} noValidate onSubmit={submit} className="space-y-5">
          {mine.loading ? (
            <p className="text-sm text-slate-500">Memuat dompetmu...</p>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              Semua dompetmu sudah tertaut di sini. Gunakan <strong>Tambah Dompet</strong> untuk membuat yang baru.
            </p>
          ) : (
            <FormField id="link-wallet" label="Dompet" required>
              <Select id="link-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                <option value="" disabled>
                  Pilih dompet
                </option>
                {candidates.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {formatMoney(w.balanceMinor, w.currency)}
                    {w.linkedWorkspaces.length ? ` (di ${w.linkedWorkspaces.map((l) => l.name).join(', ')})` : ''}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          {candidates.length > 0 ? <VisibilityPicker value={visibility} onChange={setVisibility} /> : null}
          {serverError ? <ErrorBox message={serverError} /> : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <SubmitButton disabled={submitting || candidates.length === 0} label={submitting ? 'Menautkan...' : 'Tautkan'} />
      </ModalFooter>
    </>
  );
}

function ManageWallet({
  wallet,
  workspace,
  onClose,
  onChanged,
}: FormProps & { wallet: WorkspaceWallet }) {
  const [visibility, setVisibility] = useState(wallet.visibilityMode);
  const initialAppearance: AppearanceValue = {
    icon: wallet.icon && isAppearanceIcon(wallet.icon) ? wallet.icon : null,
    color: wallet.color,
  };
  const [appearance, setAppearance] = useState<AppearanceValue>(initialAppearance);
  const appearanceChanged =
    appearance.icon !== initialAppearance.icon || appearance.color !== initialAppearance.color;
  const visibilityChanged = visibility !== wallet.visibilityMode;
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const canUnlink = wallet.isMine || canManageWorkspace(workspace.role);

  async function saveVisibility(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setServerError(null);
    try {
      if (visibilityChanged) {
        await apiFetch(`/api/workspaces/${workspace.id}/wallets/${wallet.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ visibilityMode: visibility }),
        });
      }
      // Ikon & warna melekat di dompet (milik user), jadi berlaku di semua Workspace tempat dompet ditautkan.
      if (appearanceChanged) {
        await apiFetch(`/api/wallets/${wallet.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ icon: appearance.icon, color: appearance.color }),
        });
      }
      onChanged();
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan.');
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setServerError(null);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/wallets/${wallet.id}`, { method: 'DELETE' });
      onChanged();
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal melepas tautan.');
      setBusy(false);
      setConfirmUnlink(false);
    }
  }

  return (
    <>
      <ModalBody>
        <form id={FORM_ID} noValidate onSubmit={saveVisibility} className="space-y-5">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Saldo saat ini</p>
            <p className="text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {formatMoney(wallet.balanceMinor, wallet.currency)}
            </p>
          </div>

          {wallet.isMine ? (
            <AppearancePicker
              value={appearance}
              onChange={setAppearance}
              fallback={WALLET_DEFAULT_APPEARANCE[wallet.kind]}
              previewLabel={wallet.name}
              previewHint="Berlaku di semua Workspace tempat dompet ini ditautkan"
              allowReset
            />
          ) : null}

          {wallet.isMine ? (
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              Visibilitas: <strong>{VISIBILITY_LABEL[wallet.visibilityMode].title}</strong>. Hanya {wallet.ownerName}{' '}
              (pemilik dompet) yang bisa mengubahnya.
            </p>
          )}

          {canUnlink ? (
            <div className="space-y-2 rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Lepas dari Workspace ini</p>
              <p className="text-xs leading-relaxed text-slate-500">
                Dompet tidak dihapus — hanya tidak lagi muncul di {workspace.name}. Hanya bisa bila belum ada
                transaksi dompet ini di Workspace ini.
              </p>
              {confirmUnlink ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={unlink}
                    disabled={busy}
                    className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    Ya, lepas tautan
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmUnlink(false)}
                    className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmUnlink(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Unlink className="h-3.5 w-3.5" /> Lepas tautan
                </button>
              )}
            </div>
          ) : null}

          {serverError ? <ErrorBox message={serverError} /> : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <CancelButton onClick={onClose} label={wallet.isMine ? 'Batal' : 'Tutup'} />
        {wallet.isMine ? (
          <SubmitButton disabled={busy || (!visibilityChanged && !appearanceChanged)} label="Simpan" />
        ) : null}
      </ModalFooter>
    </>
  );
}

function VisibilityPicker({
  value,
  onChange,
}: {
  value: WalletVisibilityMode;
  onChange: (value: WalletVisibilityMode) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 block text-xs font-medium text-slate-700">Visibilitas di Workspace ini</legend>
      <div className="space-y-2">
        {(['workspace_only', 'full_transparent'] as const).map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option)}
              className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                active ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  active ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300'
                }`}
              >
                {active ? <Check className="h-3 w-3" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium text-slate-900">{VISIBILITY_LABEL[option].title}</span>
                <span className="block text-xs leading-snug text-slate-500">{VISIBILITY_LABEL[option].hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
      {message}
    </div>
  );
}

function CancelButton({ onClick, label = 'Batal' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      {label}
    </button>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  return (
    <button
      type="submit"
      form={FORM_ID}
      disabled={disabled}
      className="rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}
