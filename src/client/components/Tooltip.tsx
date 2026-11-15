import {
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 350;
/** Durasi animasi keluar; sama dengan `tip-out` di index.css. */
const EXIT_MS = 110;
/** Pindah ke pemicu lain dalam jeda ini → tooltip berikutnya langsung muncul (seperti toolbar native). */
const WARM_MS = 400;
const GAP = 8;
const EDGE = 8;
/** Posisi awal sebelum diukur: fixed agar tidak menggeser tata letak halaman. */
const HIDDEN: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/** Waktu terakhir sebuah tooltip tertutup (dibagi semua instance). */
let lastClosedAt = 0;

type Phase = 'closed' | 'open' | 'closing';

interface TooltipProps {
  /** Teks tooltip. Kosong = tanpa tooltip (anak dirender apa adanya). */
  label: string;
  /** Satu elemen pemicu (tombol, badge, tautan). */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  /** Sisi yang diutamakan; otomatis pindah bila tidak muat. */
  side?: 'top' | 'bottom';
}

/**
 * Tooltip modern pengganti atribut `title` bawaan browser: pil gelap dengan panah, muncul setelah jeda singkat saat
 * hover (langsung saat fokus keyboard, atau saat berpindah dari tooltip lain), membesar halus dari arah pemicu dan
 * memudar saat ditutup. Dirender lewat portal sehingga tidak terpotong `overflow`, dan dihubungkan ke pemicu lewat
 * `aria-describedby`. Tidak muncul saat disentuh (layar sentuh tidak punya hover).
 */
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('closed');
  const [style, setStyle] = useState<CSSProperties>(HIDDEN);
  const [placement, setPlacement] = useState<{ side: 'top' | 'bottom'; arrowLeft: number }>({ side, arrowLeft: 0 });
  const phaseRef = useRef<Phase>('closed');
  const open = phase === 'open';

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (phaseRef.current !== 'open') {
      go('closed');
      return;
    }
    lastClosedAt = Date.now();
    go('closing');
    timer.current = window.setTimeout(() => go('closed'), EXIT_MS);
  }, [go]);

  function showAfter(delay: number) {
    window.clearTimeout(timer.current);
    const wait = Date.now() - lastClosedAt < WARM_MS ? 0 : delay;
    if (wait === 0) go('open');
    else timer.current = window.setTimeout(() => go('open'), wait);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Tutup saat Escape atau saat halaman di-scroll (posisi pemicu berubah).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (phase === 'closed') {
      setStyle(HIDDEN);
      return;
    }
    if (phase !== 'open') return; // saat keluar, tetap di posisi terakhir
    const trigger = wrapRef.current?.firstElementChild as HTMLElement | null;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const r = trigger.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const fitsTop = r.top - GAP - h >= EDGE;
    const fitsBottom = r.bottom + GAP + h <= window.innerHeight - EDGE;
    const finalSide = side === 'top' ? (fitsTop || !fitsBottom ? 'top' : 'bottom') : fitsBottom || !fitsTop ? 'bottom' : 'top';
    const center = r.left + r.width / 2;
    const left = Math.min(Math.max(center - w / 2, EDGE), window.innerWidth - w - EDGE);
    const arrowLeft = Math.min(Math.max(center - left, 10), w - 10);
    setPlacement({ side: finalSide, arrowLeft });
    setStyle({
      position: 'fixed',
      left,
      top: finalSide === 'top' ? r.top - GAP - h : r.bottom + GAP,
      // Membesar dari titik panah; muncul dari arah pemicu.
      transformOrigin: `${arrowLeft}px ${finalSide === 'top' ? '100%' : '0%'}`,
      ['--tip-dy' as string]: finalSide === 'top' ? '4px' : '-4px',
    });
  }, [phase, side, label]);

  if (!label) return children;

  return (
    <span
      ref={wrapRef}
      className="contents"
      onPointerEnter={(e: PointerEvent) => {
        if (e.pointerType !== 'touch') showAfter(SHOW_DELAY_MS);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // Hanya fokus dari keyboard (bukan klik mouse) yang langsung memunculkan tooltip.
        if ((e.target as HTMLElement).matches(':focus-visible')) showAfter(0);
      }}
      onBlur={hide}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {phase !== 'closed'
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              data-state={open ? 'open' : 'closed'}
              style={style}
              className="mt-tooltip pointer-events-none z-[60] max-w-64 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs leading-snug font-medium text-white shadow-lg shadow-slate-900/20"
            >
              {label}
              <span
                aria-hidden="true"
                className={`absolute h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900 ${
                  placement.side === 'top' ? '-bottom-1' : '-top-1'
                }`}
                style={{ left: placement.arrowLeft }}
              />
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
