import { zodResolver } from '@hookform/resolvers/zod';
import { BellRing, Camera, ExternalLink, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { type FocusEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@client/components/Modal';
import { TransactionDetailView } from '@client/components/TransactionDetailView';
import { AmountInput, RateInput } from '@client/components/ui';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import { dateInputToIso, toDateInput } from '@client/lib/dates';
import { compressImage, formatBytes } from '@client/lib/image';
import { convertAmountText } from '@client/lib/amountText';
import { TRANSACTION_TYPE_LABEL, formatDateKey } from '@client/lib/labels';
import type {
  CategoryItem,
  ReceiptItem,
  TransactionDetail,
  TransactionType,
  WorkspaceSummary,
  WorkspaceWallet,
} from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { formatMoney as formatTypedMoney } from '@shared/utils/currency';
import {
  convertMinor,
  formatAmountInput,
  fromPlainNumber,
  isValidRate,
  parseAmountInput,
  toPlainNumber,
} from '@shared/utils/money';
import { canRecordTransactions } from '@shared/utils/permissions';

export interface TransactionPrefill {
  type?: 'income' | 'expense';
  amountMinor?: number | null;
  title?: string;
  walletId?: number | null;
  categoryId?: number | null;
  /** Bayar 1-Klik tagihan rutin: jatuh tempo dimajukan saat transaksi disimpan. */
  recurringBill?: { id: number; title: string; nextDueDate: string } | null;
  projectId?: number | null;
  /** Catat Pembayaran invoice: pemasukan ditautkan ke invoice ini. */
  invoice?: { id: number; number: string } | null;
}

interface TransactionDialogProps {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  workspace: WorkspaceSummary;
  wallets: WorkspaceWallet[];
  categories: CategoryItem[];
  /** Mode bisnis: project yang bisa dipilih (kosong = field disembunyikan). */
  projects?: Array<{ id: number; name: string }>;
  /** null = transaksi baru. */
  transactionId: number | null;
  prefill?: TransactionPrefill;
  /** Dipanggil setiap ada perubahan data (simpan, hapus, struk) agar daftar & saldo dimuat ulang. */
  onChanged: () => void;
}

const TITLE_ID = 'transaction-dialog-title';
const FORM_ID = 'transaction-form';
const MAX_RECEIPTS = 5;

interface FormValues {
  type: TransactionType;
  walletId: string;
  targetWalletId: string;
  categoryId: string;
  projectId: string;
  amount: string;
  title: string;
  date: string;
  notes: string;
  exchangeRate: string;
}

export function TransactionDialog({
  open,
  onClose,
  onExited,
  workspace,
  wallets,
  categories,
  projects = [],
  transactionId,
  prefill,
  onChanged,
}: TransactionDialogProps) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(transactionId !== null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [queued, setQueued] = useState<Array<{ file: File; preview: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Transaksi yang sudah ada dibuka sebagai tampilan detail; form baru muncul setelah "Ubah".
  const [mode, setMode] = useState<'view' | 'edit'>(transactionId !== null ? 'view' : 'edit');
  const fileInput = useRef<HTMLInputElement>(null);

  const walletById = useMemo(() => new Map(wallets.map((w) => [String(w.id), w])), [wallets]);
  const canRecord = canRecordTransactions(workspace.role);
  const readOnly = detail ? !detail.canEdit : !canRecord;
  const editing = transactionId !== null;
  const recurringBill = prefill?.recurringBill ?? null;
  // Invoice yang dibayar: dari prefill (pembayaran baru) atau dari transaksi yang sedang diedit.
  const prefillInvoice = prefill?.invoice ?? null;

  const schema = useMemo(
    () =>
      z
        .object({
          type: z.enum(['expense', 'income', 'transfer']),
          walletId: z.string().min(1, 'Pilih dompet'),
          targetWalletId: z.string(),
          categoryId: z.string(),
          projectId: z.string(),
          amount: z.string().trim().min(1, 'Nominal wajib diisi'),
          title: z.string().trim().min(1, 'Keterangan wajib diisi').max(160, 'Maksimal 160 karakter'),
          date: z.string().min(1, 'Tanggal wajib diisi'),
          notes: z.string().max(1000, 'Catatan maksimal 1000 karakter'),
          exchangeRate: z.string(),
        })
        .superRefine((v, ctx) => {
          const wallet = walletById.get(v.walletId);
          if (!wallet) return;
          const minor = parseAmountInput(v.amount, wallet.currency);
          if (v.amount.trim() && (minor === null || minor <= 0)) {
            ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Nominal harus angka lebih dari 0' });
          }
          if (v.type === 'transfer') {
            const target = walletById.get(v.targetWalletId);
            if (!target) ctx.addIssue({ code: 'custom', path: ['targetWalletId'], message: 'Pilih dompet tujuan' });
            else if (target.id === wallet.id)
              ctx.addIssue({ code: 'custom', path: ['targetWalletId'], message: 'Harus berbeda dari dompet asal' });
            else if (target.currency !== wallet.currency)
              ctx.addIssue({
                code: 'custom',
                path: ['targetWalletId'],
                message: 'Transfer antar mata uang berbeda belum didukung',
              });
          }
          if (
            wallet.currency !== workspace.primaryCurrency &&
            !isValidRate(toPlainNumber(v.exchangeRate, workspace.primaryCurrency))
          ) {
            ctx.addIssue({ code: 'custom', path: ['exchangeRate'], message: 'Isi kurs (angka positif)' });
          }
        }),
    [walletById, workspace.primaryCurrency]
  );

  const defaultWallet = prefill?.walletId ?? wallets[0]?.id ?? null;
  const defaultWalletCurrency = wallets.find((w) => w.id === defaultWallet)?.currency ?? workspace.primaryCurrency;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      type: prefill?.type ?? 'expense',
      walletId: defaultWallet ? String(defaultWallet) : '',
      targetWalletId: '',
      categoryId: prefill?.categoryId ? String(prefill.categoryId) : '',
      projectId: prefill?.projectId ? String(prefill.projectId) : '',
      amount: prefill?.amountMinor ? formatAmountInput(prefill.amountMinor, defaultWalletCurrency) : '',
      title: prefill?.title ?? '',
      date: toDateInput(new Date()),
      notes: '',
      exchangeRate: '',
    },
  });

  // Muat detail saat membuka transaksi yang sudah ada.
  useEffect(() => {
    if (transactionId === null) return;
    let active = true;
    apiFetch<TransactionDetail>(`/api/workspaces/${workspace.id}/transactions/${transactionId}`)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        reset(formValuesFrom(data, workspace.primaryCurrency));
      })
      .catch((err: unknown) => {
        if (active) setServerError(err instanceof Error ? err.message : 'Gagal memuat transaksi.');
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [transactionId, workspace.id, workspace.primaryCurrency, reset]);

  // Bersihkan object URL pratinjau struk antrean.
  useEffect(() => () => queued.forEach((q) => URL.revokeObjectURL(q.preview)), [queued]);

  const type = watch('type');
  const walletId = watch('walletId');
  const categoryId = watch('categoryId');
  const amountText = watch('amount');
  // Kurs diketik berformat locale ("16.250"); hitungan memakai angka polos ("16250").
  const rateText = toPlainNumber(watch('exchangeRate') ?? '', workspace.primaryCurrency);
  const wallet = walletById.get(walletId);
  const needsRate = wallet ? wallet.currency !== workspace.primaryCurrency : false;
  const parsedAmount = wallet ? parseAmountInput(amountText, wallet.currency) : null;
  const convertedPreview =
    needsRate && wallet && parsedAmount && isValidRate(rateText)
      ? // Gema nominal yang sedang diketik user: tetap terlihat walau mode privasi aktif.
        formatTypedMoney(convertMinor(parsedAmount, wallet.currency, workspace.primaryCurrency, rateText), workspace.primaryCurrency)
      : null;
  const visibleCategories = categories.filter((c) => c.type === type);

  function changeType(next: TransactionType) {
    setValue('type', next);
    const current = categories.find((c) => String(c.id) === categoryId);
    if (!current || current.type !== next) setValue('categoryId', '');
    if (next !== 'transfer') setValue('targetWalletId', '');
  }

  async function uploadReceipt(txId: number, file: File): Promise<void> {
    const blob = await compressImage(file);
    const form = new FormData();
    form.append('file', blob, file.name);
    await apiFetch<ReceiptItem>(`/api/workspaces/${workspace.id}/transactions/${txId}/receipts`, {
      method: 'POST',
      body: form,
    });
  }

  async function onSubmit(values: FormValues) {
    const selected = walletById.get(values.walletId);
    if (!selected) return;
    setServerError(null);

    const payload = {
      type: values.type,
      walletId: selected.id,
      transferTargetWalletId: values.type === 'transfer' ? Number(values.targetWalletId) : null,
      categoryId: values.type !== 'transfer' && values.categoryId ? Number(values.categoryId) : null,
      amountMinor: parseAmountInput(values.amount, selected.currency),
      title: values.title.trim(),
      notes: values.notes.trim() || null,
      occurredAt: dateInputToIso(
        values.date,
        detail && toDateInput(new Date(detail.occurredAt)) === values.date ? new Date(detail.occurredAt) : undefined
      ),
      ...(selected.currency !== workspace.primaryCurrency
        ? { exchangeRate: toPlainNumber(values.exchangeRate, workspace.primaryCurrency) }
        : {}),
      ...(!editing && recurringBill ? { recurringBillId: recurringBill.id } : {}),
      projectId: values.type !== 'transfer' && values.projectId ? Number(values.projectId) : null,
      // Pertahankan tautan invoice saat mengedit pembayaran (jika tetap pemasukan).
      invoiceId: values.type === 'income' ? (detail?.invoice?.id ?? prefillInvoice?.id ?? null) : null,
    };

    try {
      const saved = await apiFetch<TransactionDetail>(
        editing ? `/api/workspaces/${workspace.id}/transactions/${transactionId}` : `/api/workspaces/${workspace.id}/transactions`,
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
      );

      if (queued.length > 0) {
        setUploading(true);
        try {
          for (const item of queued) await uploadReceipt(saved.id, item.file);
        } catch (err) {
          // Transaksi sudah tersimpan; beri tahu bahwa struk gagal tanpa kehilangan isian.
          setUploading(false);
          onChanged();
          setServerError(
            `Transaksi tersimpan, tetapi struk gagal diunggah: ${err instanceof Error ? err.message : 'coba lagi'}`
          );
          return;
        }
        setUploading(false);
      }

      onChanged();
      if (editing) {
        // Kembali ke tampilan detail dengan data terbaru (termasuk struk yang baru diunggah).
        const refreshed = await apiFetch<TransactionDetail>(`/api/workspaces/${workspace.id}/transactions/${saved.id}`);
        setDetail(refreshed);
        reset(formValuesFrom(refreshed, workspace.primaryCurrency));
        setQueued([]);
        setMode('view');
      } else {
        onClose();
      }
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan transaksi.');
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setServerError(null);
    const existing = (detail?.receipts.length ?? 0) + queued.length;
    const accepted = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, Math.max(0, MAX_RECEIPTS - existing));
    if (accepted.length === 0) {
      setServerError(`Maksimal ${MAX_RECEIPTS} foto struk per transaksi.`);
      return;
    }

    if (detail) {
      setUploading(true);
      try {
        for (const file of accepted) await uploadReceipt(detail.id, file);
        const refreshed = await apiFetch<TransactionDetail>(`/api/workspaces/${workspace.id}/transactions/${detail.id}`);
        setDetail(refreshed);
        onChanged();
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'Gagal mengunggah struk.');
      } finally {
        setUploading(false);
      }
    } else {
      setQueued((prev) => [...prev, ...accepted.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    }
  }

  async function removeReceipt(receipt: ReceiptItem) {
    if (!detail) return;
    try {
      await apiFetch(receipt.url, { method: 'DELETE' });
      setDetail({ ...detail, receipts: detail.receipts.filter((r) => r.id !== receipt.id) });
      onChanged();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Gagal menghapus struk.');
    }
  }

  async function handleDelete() {
    if (!detail) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/transactions/${detail.id}`, { method: 'DELETE' });
      onChanged();
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Gagal menghapus transaksi.');
      setDeleting(false);
    }
  }

  function cancelEdit() {
    if (detail) reset(formValuesFrom(detail, workspace.primaryCurrency));
    setQueued([]);
    setServerError(null);
    setMode('view');
  }

  const viewing = editing && mode === 'view';
  const title = editing
    ? viewing
      ? 'Detail Transaksi'
      : 'Ubah Transaksi'
    : recurringBill
      ? 'Bayar Tagihan Rutin'
      : prefillInvoice
        ? 'Catat Pembayaran Invoice'
        : 'Catat Transaksi';
  const description = viewing ? undefined : detail ? `Dicatat oleh ${detail.createdBy.name}` : `di ${workspace.name}`;
  const receiptCount = (detail?.receipts.length ?? 0) + queued.length;
  const busy = isSubmitting || uploading;

  const errorBox = serverError ? (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
      {serverError}
    </div>
  ) : null;

  // Dipakai di tampilan detail maupun form: unggah langsung tersimpan bila transaksinya sudah ada.
  const receiptsSection = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-700">
          Foto Struk <span className="text-slate-400">({receiptCount}/{MAX_RECEIPTS})</span>
        </p>
        {!readOnly && receiptCount < MAX_RECEIPTS ? (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" /> Tambah Foto
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </>
        ) : null}
      </div>

      {receiptCount === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          {readOnly ? 'Tidak ada struk.' : 'Foto otomatis dikompres sebelum diunggah dan disimpan privat.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {detail?.receipts.map((receipt) => (
            <ReceiptThumb
              key={receipt.id}
              src={receipt.url}
              caption={formatBytes(receipt.sizeBytes)}
              onRemove={readOnly ? undefined : () => void removeReceipt(receipt)}
            />
          ))}
          {queued.map((item, index) => (
            <ReceiptThumb
              key={item.preview}
              src={item.preview}
              caption="Belum diunggah"
              onRemove={() => setQueued((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
          {uploading ? (
            <div className="flex aspect-square items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} onExited={onExited} labelledBy={TITLE_ID}>
      <ModalHeader id={TITLE_ID} title={title} description={description} onClose={onClose} />

      <ModalBody>
        {loadingDetail ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat transaksi...
          </div>
        ) : viewing ? (
          detail ? (
            <div className="space-y-4">
              <TransactionDetailView detail={detail} workspace={workspace} wallets={wallets} receipts={receiptsSection} />
              {errorBox}
            </div>
          ) : (
            errorBox
          )
        ) : wallets.length === 0 && !editing ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Belum ada dompet di Workspace ini. Tambahkan dompet dulu di menu <strong>Dompet</strong> sebelum mencatat
            transaksi.
          </div>
        ) : (
          <form id={FORM_ID} noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {recurringBill && !editing ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-3 text-xs leading-relaxed text-teal-900">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Pembayaran tagihan rutin <strong>{recurringBill.title}</strong> (jatuh tempo{' '}
                  {formatDateKey(recurringBill.nextDueDate)}). Sesuaikan nominal bila berbeda — setelah disimpan, jatuh
                  tempo otomatis maju ke periode berikutnya.
                </span>
              </div>
            ) : null}
            {(prefillInvoice && !editing) || detail?.invoice ? (
              <div className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-3 text-xs leading-relaxed text-teal-900">
                Pembayaran invoice <strong>{detail?.invoice?.number ?? prefillInvoice?.number}</strong>. Status invoice
                (sebagian/lunas) diperbarui otomatis dari total pembayaran.
              </div>
            ) : null}
            <fieldset disabled={readOnly || busy} className="space-y-5">
              <div role="radiogroup" aria-label="Jenis transaksi" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                {(['expense', 'income', 'transfer'] as const).map((option) => {
                  const active = type === option;
                  const activeClass =
                    option === 'expense'
                      ? 'bg-white text-rose-700 shadow-xs'
                      : option === 'income'
                        ? 'bg-white text-emerald-700 shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs';
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => changeType(option)}
                      className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
                        active ? activeClass : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {TRANSACTION_TYPE_LABEL[option]}
                    </button>
                  );
                })}
              </div>

              <FormField id="tx-amount" label="Nominal" required error={errors.amount?.message}>
                <AmountInput
                  id="tx-amount"
                  currency={wallet?.currency ?? workspace.primaryCurrency}
                  large
                  autoFocus={!editing}
                  hasError={Boolean(errors.amount)}
                  {...register('amount', {
                    // Rapikan desimal saat keluar dari kolom (mis. "12.5" → "12.50" untuk USD).
                    onBlur: (event: FocusEvent<HTMLInputElement>) => {
                      if (!wallet) return;
                      const minor = parseAmountInput(event.target.value, wallet.currency);
                      if (minor && minor > 0) setValue('amount', formatAmountInput(minor, wallet.currency));
                    },
                  })}
                />
              </FormField>

              <div className={`grid gap-4 ${type === 'transfer' ? 'sm:grid-cols-2' : ''}`}>
                <FormField
                  id="tx-wallet"
                  label={type === 'transfer' ? 'Dari Dompet' : 'Dompet'}
                  required
                  error={errors.walletId?.message}
                >
                  <Select
                    id="tx-wallet"
                    hasError={Boolean(errors.walletId)}
                    {...register('walletId', {
                      // Ganti dompet beda mata uang → ubah format nominal yang sudah diketik.
                      onChange: (event: { target: { value: string } }) => {
                        const next = walletById.get(event.target.value);
                        if (wallet && next) setValue('amount', convertAmountText(amountText ?? '', wallet.currency, next.currency));
                      },
                    })}
                  >
                    <option value="" disabled>
                      Pilih dompet
                    </option>
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} · {formatMoney(w.balanceMinor, w.currency)}
                      </option>
                    ))}
                  </Select>
                </FormField>

                {type === 'transfer' ? (
                  <FormField id="tx-target" label="Ke Dompet" required error={errors.targetWalletId?.message}>
                    <Select id="tx-target" hasError={Boolean(errors.targetWalletId)} {...register('targetWalletId')}>
                      <option value="" disabled>
                        Pilih dompet tujuan
                      </option>
                      {wallets
                        .filter((w) => String(w.id) !== walletId)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.currency})
                          </option>
                        ))}
                    </Select>
                  </FormField>
                ) : null}
              </div>

              {needsRate && wallet ? (
                <FormField
                  id="tx-rate"
                  label={`Kurs 1 ${wallet.currency} ke ${workspace.primaryCurrency}`}
                  required
                  error={errors.exchangeRate?.message}
                  hint={
                    convertedPreview
                      ? `≈ ${convertedPreview} di laporan Workspace`
                      : `Contoh: 1 ${wallet.currency} = ${fromPlainNumber('16250', workspace.primaryCurrency, 6)} ${workspace.primaryCurrency}`
                  }
                >
                  <RateInput
                    id="tx-rate"
                    currency={workspace.primaryCurrency}
                    placeholder={fromPlainNumber('16250', workspace.primaryCurrency, 6)}
                    hasError={Boolean(errors.exchangeRate)}
                    {...register('exchangeRate')}
                  />
                </FormField>
              ) : null}

              {type !== 'transfer' ? (
                <fieldset className="space-y-2">
                  <legend className="mb-2 block text-xs font-medium text-slate-700">Kategori</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleCategories.map((cat) => {
                      const active = String(cat.id) === categoryId;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setValue('categoryId', active ? '' : String(cat.id))}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'border-transparent text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                          style={active ? { backgroundColor: cat.color } : undefined}
                        >
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: active ? 'white' : cat.color }}
                          />
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              {type !== 'transfer' && projects.length > 0 ? (
                <FormField id="tx-project" label="Project (opsional)" hint="Dihitung ke omzet/biaya project untuk laporan profit.">
                  <Select id="tx-project" {...register('projectId')}>
                    <option value="">Tanpa project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
                <FormField id="tx-title" label="Keterangan" required error={errors.title?.message}>
                  <input
                    id="tx-title"
                    autoComplete="off"
                    placeholder={type === 'income' ? 'contoh: Gaji November' : 'contoh: Makan siang'}
                    className={getInputClassName(Boolean(errors.title))}
                    {...register('title')}
                  />
                </FormField>
                <FormField id="tx-date" label="Tanggal" required error={errors.date?.message}>
                  <input
                    id="tx-date"
                    type="date"
                    max={toDateInput(new Date(Date.now() + 365 * 86_400_000))}
                    className={getInputClassName(Boolean(errors.date))}
                    {...register('date')}
                  />
                </FormField>
              </div>

              <FormField id="tx-notes" label="Catatan (opsional)" error={errors.notes?.message}>
                <textarea
                  id="tx-notes"
                  rows={2}
                  className={getInputClassName(Boolean(errors.notes), 'resize-none')}
                  {...register('notes')}
                />
              </FormField>
            </fieldset>

            {receiptsSection}

            {errorBox}
          </form>
        )}
      </ModalBody>

      <ModalFooter>
        {viewing ? (
          <>
            {detail?.canEdit ? (
              <div className="mr-auto">
                {confirmDelete ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deleting ? 'Menghapus...' : 'Ya, hapus'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-xl px-2.5 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-800"
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Hapus transaksi"
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Hapus</span>
                  </button>
                )}
              </div>
            ) : null}
            {confirmDelete ? null : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Tutup
                </button>
                {detail?.canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setServerError(null);
                      setMode('edit');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800"
                  >
                    <Pencil className="h-4 w-4" /> Ubah
                  </button>
                ) : null}
              </>
            )}
          </>
        ) : readOnly ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Tutup
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={editing ? cancelEdit : onClose}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              form={FORM_ID}
              disabled={busy || loadingDetail || (wallets.length === 0 && !editing)}
              className="rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? 'Mengunggah struk...' : isSubmitting ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan'}
            </button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}

function ReceiptThumb({ src, caption, onRemove }: { src: string; caption: string; onRemove?: () => void }) {
  return (
    <figure className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <a href={src} target="_blank" rel="noreferrer" className="block aspect-square" title="Buka foto">
        <img src={src} alt="Foto struk" loading="lazy" className="h-full w-full object-cover" />
        <span className="absolute top-1.5 left-1.5 hidden rounded-md bg-black/50 p-1 text-white group-hover:block">
          <ExternalLink className="h-3 w-3" />
        </span>
      </a>
      <figcaption className="truncate px-1.5 py-1 text-[10px] text-slate-500">{caption}</figcaption>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Hapus foto struk"
          className="absolute top-1.5 right-1.5 rounded-full bg-white/90 p-1 text-slate-600 shadow-sm hover:text-rose-600"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </figure>
  );
}

function formValuesFrom(data: TransactionDetail, primaryCurrency: WorkspaceSummary['primaryCurrency']): FormValues {
  return {
    type: data.type,
    walletId: String(data.wallet.id),
    targetWalletId: data.targetWallet ? String(data.targetWallet.id) : '',
    categoryId: data.category ? String(data.category.id) : '',
    projectId: data.project ? String(data.project.id) : '',
    amount: formatAmountInput(data.amountMinor, data.currency),
    title: data.title,
    date: toDateInput(new Date(data.occurredAt)),
    notes: data.notes ?? '',
    exchangeRate: data.exchangeRate === '1.000000' ? '' : fromPlainNumber(trimRate(data.exchangeRate), primaryCurrency, 6),
  };
}

/** "16250.000000" → "16250", "0.000061" tetap. */
function trimRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate;
}

