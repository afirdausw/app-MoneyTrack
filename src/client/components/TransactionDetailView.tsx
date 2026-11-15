import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Eye, FileText, FolderKanban } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppearanceBadge, categoryAppearance, walletAppearance } from '@client/lib/appearance';
import { TRANSACTION_TYPE_LABEL } from '@client/lib/labels';
import { formatMoney } from '@client/lib/privacy';
import type { TransactionDetail, WorkspaceSummary, WorkspaceWallet } from '@shared/types/domain';
import { fromPlainNumber } from '@shared/utils/money';

const TYPE_STYLE = {
  expense: { icon: ArrowUpRight, sign: '−', amount: 'text-rose-700', chip: 'bg-rose-50 text-rose-700', bubble: 'bg-rose-50 text-rose-600' },
  income: { icon: ArrowDownLeft, sign: '+', amount: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700', bubble: 'bg-emerald-50 text-emerald-600' },
  transfer: { icon: ArrowLeftRight, sign: '', amount: 'text-slate-900', chip: 'bg-slate-100 text-slate-700', bubble: 'bg-slate-100 text-slate-600' },
} as const;

const fullDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

/** Tampilan baca transaksi: nominal besar di atas, lalu rincian berlabel. Form hanya muncul saat "Ubah". */
export function TransactionDetailView({
  detail,
  workspace,
  wallets,
  receipts,
}: {
  detail: TransactionDetail;
  workspace: WorkspaceSummary;
  /** Dompet Workspace, untuk ikon/warna dompet (bila tertaut di sini). */
  wallets: WorkspaceWallet[];
  /** Bagian struk dirender oleh dialog (punya aksi unggah/hapus). */
  receipts: ReactNode;
}) {
  const style = TYPE_STYLE[detail.type];
  const TypeIcon = style.icon;
  const occurred = new Date(detail.occurredAt);
  const foreign = detail.currency !== workspace.primaryCurrency;

  return (
    <div className="space-y-5">
      {detail.sourceWorkspaceName ? (
        <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-xs leading-relaxed text-sky-800">
          <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Dicatat di Workspace {detail.sourceWorkspaceName}. Tampil di sini karena dompetnya transparan penuh — hanya bisa
          dilihat.
        </p>
      ) : null}

      {/* Ringkasan */}
      <section className="flex flex-col items-center gap-2 pt-1 text-center">
        {detail.type !== 'transfer' && detail.category ? (
          <AppearanceBadge appearance={categoryAppearance(detail.category)} size="lg" />
        ) : (
          <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${style.bubble}`} aria-hidden="true">
            <TypeIcon className="h-7 w-7" />
          </span>
        )}
        <p className="mt-1 max-w-full text-sm font-medium break-words text-slate-600">{detail.title}</p>
        <p className={`text-3xl font-bold tracking-tight tabular-nums sm:text-4xl ${style.amount}`}>
          {style.sign}
          {formatMoney(detail.amountMinor, detail.currency)}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip}`}>
          {TRANSACTION_TYPE_LABEL[detail.type]}
        </span>
      </section>

      {/* Rincian */}
      <dl className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
        {detail.type === 'transfer' ? (
          <Row label="Transfer">
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <WalletChip wallet={detail.wallet} wallets={wallets} />
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-label="ke" />
              {detail.targetWallet ? <WalletChip wallet={detail.targetWallet} wallets={wallets} /> : '—'}
            </span>
          </Row>
        ) : (
          <>
            <Row label="Dompet">
              <WalletChip wallet={detail.wallet} wallets={wallets} />
            </Row>
            <Row label="Kategori">
              {detail.category ? (
                <span className="inline-flex items-center gap-2">
                  <AppearanceBadge appearance={categoryAppearance(detail.category)} size="xs" variant="soft" />
                  {detail.category.name}
                </span>
              ) : (
                <span className="text-slate-400">Tanpa kategori</span>
              )}
            </Row>
          </>
        )}

        <Row label="Tanggal">
          <span className="block">{fullDate.format(occurred)}</span>
          <span className="block text-xs font-normal text-slate-500">Pukul {timeOnly.format(occurred)}</span>
        </Row>

        {foreign ? (
          <>
            <Row label="Kurs">
              1 {detail.currency} = {fromPlainNumber(trimRate(detail.exchangeRate), workspace.primaryCurrency, 6)}{' '}
              {workspace.primaryCurrency}
            </Row>
            <Row label="Nilai di laporan">{formatMoney(detail.convertedAmountMinor, workspace.primaryCurrency)}</Row>
          </>
        ) : null}

        {detail.project ? (
          <Row label="Project">
            <span className="inline-flex items-center gap-1.5">
              <FolderKanban className="h-3.5 w-3.5 text-violet-500" />
              {detail.project.name}
            </span>
          </Row>
        ) : null}
        {detail.invoice ? (
          <Row label="Invoice">
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-teal-600" />
              {detail.invoice.number}
            </span>
          </Row>
        ) : null}

        <Row label="Dicatat oleh">{detail.createdBy.name}</Row>
      </dl>

      {detail.notes ? (
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium text-slate-500">Catatan</h3>
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-800">
            {detail.notes}
          </p>
        </section>
      ) : null}

      {receipts}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 pt-0.5 text-sm text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words text-slate-900">{children}</dd>
    </div>
  );
}

function WalletChip({ wallet, wallets }: { wallet: { id: number; name: string }; wallets: WorkspaceWallet[] }) {
  const linked = wallets.find((w) => w.id === wallet.id);
  return (
    <span className="inline-flex items-center gap-2">
      {linked ? <AppearanceBadge appearance={walletAppearance(linked)} size="xs" /> : null}
      {wallet.name}
    </span>
  );
}

/** "16250.000000" → "16250", "0.000061" tetap. */
function trimRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate;
}
