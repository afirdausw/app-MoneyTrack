import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CurrencyCode, TrendPoint } from '@shared/types/domain';
import { areAmountsHidden, formatMoney } from '@client/lib/privacy';
import { fromMinorUnits } from '@shared/utils/currency';

/**
 * Kolom berkelompok pemasukan vs pengeluaran per bulan.
 * Warna lolos validasi CVD (teal #0d9488 vs oranye #eb6834, ΔE 10.7); hijau-merah gagal (ΔE 5.8).
 */
const SERIES = [
  { key: 'incomeMinor', label: 'Pemasukan', color: '#0d9488' },
  { key: 'expenseMinor', label: 'Pengeluaran', color: '#eb6834' },
] as const;

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
const BAR_MAX = 24;
const BAR_GAP = 2;

const monthShort = new Intl.DateTimeFormat('id-ID', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

function monthDate(key: string): Date {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1);
}

/**
 * Skala sumbu dengan langkah "bulat" (1, 2, 5 × 10^n) sehingga setiap label tick juga bulat
 * (0 / 5 jt / 10 jt …), bukan pecahan seperti 6,3 jt. Menghasilkan ±4–6 garis.
 */
export function niceScale(value: number): { top: number; ticks: number[] } {
  if (value <= 0) return { top: 1, ticks: [0, 1] };
  const raw = value / 5;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((s) => s * exp >= raw) ?? 10) * exp;
  const count = Math.ceil(value / step);
  return { top: step * count, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/** Path kolom: ujung data membulat 4px, dasar persegi (menempel ke baseline). */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function TrendChart({ points, currency }: { points: TrendPoint[]; currency: CurrencyCode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipWidth, setTipWidth] = useState(0);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maxValue = Math.max(0, ...points.flatMap((p) => [p.incomeMinor, p.expenseMinor]));
  const { top, ticks } = niceScale(fromMinorUnits(maxValue, currency));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, points.length);
  const barW = Math.min(BAR_MAX, (band * 0.7 - BAR_GAP) / 2);
  const y = (minor: number) => PAD.top + plotH - (fromMinorUnits(minor, currency) / top) * plotH;
  const empty = maxValue === 0;

  const activePoint = active !== null ? points[active] : null;
  // Lebar tooltip mengikuti isi (nominal bisa panjang); posisinya dijepit agar tidak keluar dari area grafik.
  const half = tipWidth / 2;
  const tooltipLeft =
    active !== null ? Math.min(Math.max(PAD.left + band * (active + 0.5), half + 4), width - half - 4) : 0;

  useLayoutEffect(() => {
    if (active !== null && tipRef.current) setTipWidth(tipRef.current.offsetWidth);
  }, [active]);

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Grafik pemasukan dan pengeluaran ${points.length} bulan terakhir`}
          className="block max-w-full"
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t) => {
            const ty = PAD.top + plotH - (t / top) * plotH;
            return (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={ty} y2={ty} strokeWidth={1} style={{ stroke: "var(--color-slate-200)" }} />
                {/* Tanpa data, skala 0–1 hanya angka karangan; cukup tampilkan garis dasar 0. */}
                {/* Mode privasi juga menyembunyikan skala sumbu (tinggi batang tetap relatif). */}
                {(!empty && !areAmountsHidden()) || t === 0 ? (
                  <text x={PAD.left - 8} y={ty} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                    {t === 0 ? '0' : compact.format(t)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {points.map((p, i) => {
            const cx = PAD.left + band * i + band / 2;
            const groupW = barW * 2 + BAR_GAP;
            return (
              <g key={p.month}>
                {active === i ? (
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} style={{ fill: "var(--color-slate-100)" }} />
                ) : null}
                {SERIES.map((s, si) => {
                  const value = p[s.key];
                  const x = cx - groupW / 2 + si * (barW + BAR_GAP);
                  const barTop = y(value);
                  return <path key={s.key} d={columnPath(x, barTop, barW, PAD.top + plotH - barTop)} fill={s.color} />;
                })}
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {monthShort.format(monthDate(p.month))}
                </text>
                {/* Area hover/fokus selebar satu bulan (lebih besar dari batang). */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${monthLong.format(monthDate(p.month))}: pemasukan ${formatMoney(p.incomeMinor, currency)}, pengeluaran ${formatMoney(p.expenseMinor, currency)}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} strokeWidth={1} style={{ stroke: "var(--color-slate-300)" }} />
        </svg>

        {empty ? (
          // Diletakkan di area plot saja (bukan kolom label sumbu), dengan latar agar tidak bertabrakan dengan garis grid.
          <div
            className="pointer-events-none absolute flex items-center justify-center px-2"
            style={{ left: PAD.left, right: PAD.right, top: PAD.top, height: plotH }}
          >
            <p className="rounded-full bg-white px-3 py-1 text-center text-sm text-slate-400">
              Belum ada transaksi pada periode ini.
            </p>
          </div>
        ) : null}

        {activePoint ? (
          <div
            ref={tipRef}
            role="tooltip"
            className="pointer-events-none absolute top-1 z-10 w-max -translate-x-1/2 rounded-lg bg-slate-900/95 px-3 py-2 text-xs whitespace-nowrap text-slate-300 shadow-lg"
            style={{ left: tooltipLeft, visibility: tipWidth ? 'visible' : 'hidden' }}
          >
            <p className="mb-1.5 font-semibold text-white">{monthLong.format(monthDate(activePoint.month))}</p>
            <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
              {SERIES.map((s) => (
                <Fragment key={s.key}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="text-right font-medium text-white tabular-nums">
                    {formatMoney(activePoint[s.key], currency)}
                  </span>
                </Fragment>
              ))}
              <span className="mt-1 border-t border-white/10 pt-1">Selisih</span>
              <span className="mt-1 border-t border-white/10 pt-1 text-right font-semibold text-white tabular-nums">
                {formatMoney(activePoint.incomeMinor - activePoint.expenseMinor, currency)}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
