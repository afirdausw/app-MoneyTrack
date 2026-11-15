import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Eye, Paperclip } from 'lucide-react';
import { ICON_COMPONENT } from '@client/lib/appearance';
import { formatDayHeading, toDateInput } from '@client/lib/dates';
import type { TransactionItem } from '@shared/types/domain';
import { isAppearanceIcon } from '@shared/utils/appearance';
import { formatMoney } from '@client/lib/privacy';

interface TransactionListProps {
  items: TransactionItem[];
  onSelect: (item: TransactionItem) => void;
  /** Kelompokkan per tanggal (halaman Transaksi). Dashboard cukup daftar datar. */
  grouped?: boolean;
}

const TYPE_STYLE = {
  income: { icon: ArrowDownLeft, amount: 'text-emerald-700', sign: '+', bubble: 'bg-emerald-50 text-emerald-700' },
  expense: { icon: ArrowUpRight, amount: 'text-rose-700', sign: '−', bubble: 'bg-rose-50 text-rose-700' },
  transfer: { icon: ArrowLeftRight, amount: 'text-slate-700', sign: '', bubble: 'bg-slate-100 text-slate-600' },
} as const;

const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

export function TransactionList({ items, onSelect, grouped = false }: TransactionListProps) {
  if (!grouped) {
    return (
      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <TransactionRow key={item.id} item={item} onSelect={onSelect} />
        ))}
      </ul>
    );
  }

  const groups: Array<{ key: string; heading: string; items: TransactionItem[] }> = [];
  for (const item of items) {
    const key = toDateInput(new Date(item.occurredAt));
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, heading: formatDayHeading(item.occurredAt), items: [item] });
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="mb-1.5 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {group.heading}
          </h3>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {group.items.map((item) => (
              <TransactionRow key={item.id} item={item} onSelect={onSelect} showTime />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TransactionRow({
  item,
  onSelect,
  showTime = false,
}: {
  item: TransactionItem;
  onSelect: (item: TransactionItem) => void;
  showTime?: boolean;
}) {
  const style = TYPE_STYLE[item.type];
  // Ikon kategori bila ada; arah uang tetap terbaca dari tanda & warna nominal.
  const Icon =
    item.type !== 'transfer' && item.category && isAppearanceIcon(item.category.icon)
      ? ICON_COMPONENT[item.category.icon]
      : style.icon;
  const subtitle =
    item.type === 'transfer'
      ? `${item.wallet.name} → ${item.targetWallet?.name ?? '?'}`
      : [item.category?.name ?? 'Tanpa kategori', item.wallet.name].join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-slate-50 sm:px-4"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.bubble}`}
          style={item.category ? { backgroundColor: `${item.category.color}1a`, color: item.category.color } : undefined}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
            {item.receiptCount > 0 ? (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Ada struk" />
            ) : null}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {subtitle}
            {showTime ? ` · ${timeFormatter.format(new Date(item.occurredAt))}` : ''}
          </span>
          {item.project || item.invoice ? (
            <span className="mt-0.5 mr-1 inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
              {[item.project?.name, item.invoice?.number].filter(Boolean).join(' · ')}
            </span>
          ) : null}
          {item.sourceWorkspaceName ? (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
              <Eye className="h-3 w-3" />
              Dari {item.sourceWorkspaceName}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className={`block text-sm font-semibold tabular-nums ${style.amount}`}>
            {style.sign}
            {formatMoney(item.amountMinor, item.currency)}
          </span>
          {showTime ? null : (
            <span className="block text-[11px] text-slate-400">{formatDayHeading(item.occurredAt)}</span>
          )}
        </span>
      </button>
    </li>
  );
}
