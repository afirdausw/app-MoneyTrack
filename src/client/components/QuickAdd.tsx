import { ArrowRight, Sparkles } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { TransactionPrefill } from '@client/components/TransactionDialog';
import type { WorkspaceWallet } from '@shared/types/domain';
import { formatMoney, toMinorUnits } from '@shared/utils/currency';
import { parseQuickInput } from '@shared/utils/quick-parser';

const EXAMPLES = ['makan siang 25rb gopay', '+gaji 5.5jt bca', 'bensin 30rb tunai'];

/** Cocokkan petunjuk dompet dari teks ("gopay", "tunai") dengan nama/jenis dompet di Workspace. */
export function matchWallet(hint: string | null, wallets: WorkspaceWallet[]): WorkspaceWallet | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const byName = wallets.find((w) => {
    const name = w.name.toLowerCase();
    return name.includes(h) || name.split(/\s+/).some((part) => part.length >= 3 && h.includes(part));
  });
  if (byName) return byName;
  if (['tunai', 'cash', 'kas'].includes(h)) return wallets.find((w) => w.kind === 'cash') ?? null;
  return null;
}

interface QuickAddProps {
  wallets: WorkspaceWallet[];
  disabled?: boolean;
  onContinue: (prefill: TransactionPrefill) => void;
}

export function QuickAdd({ wallets, disabled = false, onContinue }: QuickAddProps) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseQuickInput(text) : null;
  const wallet = parsed ? matchWallet(parsed.walletHint, wallets) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed) return;
    const currency = wallet?.currency ?? parsed.currency;
    onContinue({
      type: parsed.type,
      amountMinor: parsed.amount !== null ? toMinorUnits(parsed.amount, currency) : null,
      title: parsed.description,
      walletId: wallet?.id ?? null,
    });
    setText('');
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Catat Cepat</h2>
          <p className="text-xs text-slate-500">Ketik satu baris, cek lagi di form, lalu simpan.</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          aria-label="Teks transaksi cepat"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          maxLength={200}
          placeholder={disabled ? 'Role viewer hanya bisa melihat' : 'contoh: makan siang 25rb gopay'}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={disabled || !parsed}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="hidden sm:inline">Lanjut</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      {parsed ? (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <Chip tone={parsed.type === 'income' ? 'emerald' : 'rose'}>
            {parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}
          </Chip>
          <Chip>
            {parsed.amount !== null
              ? formatMoney(toMinorUnits(parsed.amount, parsed.currency), parsed.currency)
              : 'Nominal belum terbaca'}
          </Chip>
          {parsed.description ? <Chip>{parsed.description}</Chip> : null}
          {parsed.walletHint ? (
            <Chip tone={wallet ? 'teal' : 'amber'}>
              {wallet ? `Dompet: ${wallet.name}` : `“${parsed.walletHint}” belum ada di dompet`}
            </Chip>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={disabled}
              onClick={() => setText(example)}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const CHIP_TONE = {
  slate: 'bg-slate-100 text-slate-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
  teal: 'bg-teal-50 text-teal-800',
  amber: 'bg-amber-50 text-amber-800',
} as const;

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: keyof typeof CHIP_TONE }) {
  return <span className={`rounded-full px-2.5 py-1 font-medium ${CHIP_TONE[tone]}`}>{children}</span>;
}
