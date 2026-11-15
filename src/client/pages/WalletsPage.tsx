import { Eye, EyeOff, Link2, Plus, Settings2 } from 'lucide-react';
import { AppearanceBadge, walletAppearance } from '@client/lib/appearance';
import { VISIBILITY_LABEL, WALLET_KIND_LABEL } from '@client/lib/labels';
import type { WorkspaceSummary, WorkspaceWallet } from '@shared/types/domain';
import { formatMoney } from '@client/lib/privacy';
import { canManageWorkspace } from '@shared/utils/permissions';

interface WalletsPageProps {
  workspace: WorkspaceSummary;
  wallets: WorkspaceWallet[];
  loading: boolean;
  onCreate: () => void;
  onLink: () => void;
  onManage: (wallet: WorkspaceWallet) => void;
}

export function WalletsPage({ workspace, wallets, loading, onCreate, onLink, onManage }: WalletsPageProps) {
  const canManage = canManageWorkspace(workspace.role);
  const totals = new Map<string, number>();
  for (const w of wallets) totals.set(w.currency, (totals.get(w.currency) ?? 0) + w.balanceMinor);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">Total saldo di {workspace.name}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
            {totals.size === 0 ? (
              <span className="text-2xl font-bold tracking-tight text-slate-900">
                {formatMoney(0, workspace.primaryCurrency)}
              </span>
            ) : (
              [...totals.entries()].map(([currency, total]) => (
                <span key={currency} className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {formatMoney(total, currency as WorkspaceWallet['currency'])}
                </span>
              ))
            )}
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onLink}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:flex-none"
            >
              <Link2 className="h-4 w-4" /> Tautkan Dompet Saya
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 sm:flex-none"
            >
              <Plus className="h-4 w-4" /> Tambah Dompet
            </button>
          </div>
        ) : null}
      </div>

      {loading && wallets.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">Memuat dompet...</p>
      ) : wallets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-12 text-center text-sm text-slate-500">
          {canManage ? 'Belum ada dompet. Tambahkan rekening, e-wallet, atau kas tunai.' : 'Belum ada dompet di Workspace ini.'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {wallets.map((wallet) => {
            const VisibilityIcon = wallet.visibilityMode === 'full_transparent' ? Eye : EyeOff;
            return (
              <li key={wallet.id}>
                <button
                  type="button"
                  onClick={() => onManage(wallet)}
                  className="group flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <AppearanceBadge appearance={walletAppearance(wallet)} size="md" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{wallet.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {WALLET_KIND_LABEL[wallet.kind]}
                          {wallet.isMine ? '' : ` · milik ${wallet.ownerName}`}
                        </span>
                      </span>
                    </span>
                    <Settings2 className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-500" />
                  </div>
                  <p
                    className={`mt-4 text-xl font-bold tracking-tight tabular-nums ${
                      wallet.balanceMinor < 0 ? 'text-rose-700' : 'text-slate-900'
                    }`}
                  >
                    {formatMoney(wallet.balanceMinor, wallet.currency)}
                  </p>
                  <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                    <VisibilityIcon className="h-3 w-3" />
                    {VISIBILITY_LABEL[wallet.visibilityMode].title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
