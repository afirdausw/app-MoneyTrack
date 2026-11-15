import { X } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/** Durasi animasi keluar; harus sama dengan `duration-200` di kelas transisi. */
const EXIT_MS = 200;
/** Tarikan melewati porsi tinggi sheet ini menutup modal. */
const DISMISS_RATIO = 0.3;
/** Kecepatan lempar ke bawah (px/ms) yang menutup modal walau tarikannya pendek. */
const DISMISS_VELOCITY = 0.5;
/** Gerakan minimum sebelum dianggap drag, agar tap biasa tidak terganggu. */
const DRAG_SLOP = 4;
/** Elemen yang tetap berfungsi normal (tidak memulai drag) saat disentuh. */
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="tab"], [contenteditable="true"]';

type DragStart = (event: ReactPointerEvent<HTMLElement>) => void;
/** Diisi `Modal` agar `ModalHeader` bisa menjadi area tarik bottom sheet. */
const SheetDragContext = createContext<DragStart | null>(null);

function isBottomSheetLayout(): boolean {
  // Sama dengan breakpoint `sm` Tailwind: di bawahnya modal tampil sebagai bottom sheet.
  return !window.matchMedia('(min-width: 640px)').matches;
}

interface ModalProps {
  /** false memicu animasi tutup; `onExited` dipanggil setelah animasi selesai. */
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  labelledBy: string;
  size?: 'md' | 'lg';
  children: ReactNode;
}

/**
 * Dialog dengan animasi masuk/keluar: bottom sheet di HP, kartu tengah di layar lebar.
 * Konten disusun dengan `ModalHeader`, `ModalBody` (area yang bisa di-scroll), dan `ModalFooter`.
 */
export function Modal({ open, onClose, onExited, labelledBy, size = 'lg', children }: ModalProps) {
  const [visible, setVisible] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  // Animasi masuk butuh satu frame dalam keadaan tersembunyi agar transisi berjalan.
  useEffect(() => {
    if (!open) {
      setVisible(false);
      const timer = window.setTimeout(() => onExitedRef.current?.(), EXIT_MS);
      return () => window.clearTimeout(timer);
    }
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Kunci scroll halaman di belakang modal, kembalikan fokus saat modal hilang.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const { overflow, paddingRight } = document.body.style;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      previousFocus?.focus?.();
    };
  }, []);

  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  /**
   * Tarik-untuk-menutup ala BottomSheetDialog Android: sheet mengikuti jari, lalu menutup bila
   * ditarik cukup jauh atau dilempar cepat; selain itu kembali ke posisi semula.
   * Gaya ditulis langsung ke DOM (bukan state) agar mulus tanpa re-render tiap frame.
   */
  const startDrag: DragStart = (event) => {
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (!sheet || !backdrop || !isBottomSheetLayout()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest(INTERACTIVE)) return;

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const height = sheet.getBoundingClientRect().height;
    let dragging = false;
    let offset = 0;
    let lastY = startY;
    let lastTime = event.timeStamp;
    let velocity = 0;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < DRAG_SLOP) return;
        dragging = true;
        handle.setPointerCapture(pointerId);
        sheet.style.transition = 'none';
        backdrop.style.transition = 'none';
      }
      // Ke atas diberi hambatan kecil saja, seperti sheet yang sudah terbuka penuh.
      offset = dy > 0 ? dy : dy / 6;
      sheet.style.transform = `translateY(${offset}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - Math.max(0, offset) / height));
      const dt = e.timeStamp - lastTime;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastTime = e.timeStamp;
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (!dragging) return;
      // Kembalikan transisi kelas; perubahan berikut (kembali ke 0 atau ke bawah) jadi beranimasi.
      sheet.style.transition = '';
      backdrop.style.transition = '';
      backdrop.style.opacity = '';
      const shouldClose =
        e.type !== 'pointercancel' && (offset > height * DISMISS_RATIO || (offset > 0 && velocity > DISMISS_VELOCITY));
      if (shouldClose) {
        // Lanjut turun dari posisi jari: `translate` kelas menuju 100% sementara offset ini ikut beranimasi ke 0.
        sheet.style.transform = `translateY(${offset}px)`;
        onCloseRef.current();
        window.requestAnimationFrame(() => {
          sheet.style.transform = '';
        });
      } else {
        sheet.style.transform = '';
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const widthClass = size === 'md' ? 'sm:max-w-md' : 'sm:max-w-xl';

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={backdropRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl transition duration-200 ease-out motion-reduce:transition-none sm:max-h-[85dvh] sm:rounded-2xl ${widthClass} ${
          visible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-3 sm:scale-95'
        }`}
      >
        <SheetDragContext.Provider value={startDrag}>{children}</SheetDragContext.Provider>
      </div>
    </div>,
    document.body
  );
}

interface ModalHeaderProps {
  id: string;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
}

export function ModalHeader({ id, title, description, onClose, children }: ModalHeaderProps) {
  const startDrag = useContext(SheetDragContext);
  return (
    <div
      onPointerDown={startDrag ?? undefined}
      // Di HP seluruh header (pegangan + judul) adalah area tarik; matikan gestur scroll bawaan browser di sini.
      className="shrink-0 touch-none border-b border-slate-100 px-5 pt-4 select-none sm:touch-auto sm:px-6 sm:pt-5 sm:select-auto"
    >
      {/* Pegangan bottom sheet di HP; area sentuhnya diperlebar lewat padding header. */}
      <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 cursor-grab rounded-full bg-slate-300 active:cursor-grabbing sm:hidden" />
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="-mr-1.5 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>
  );
}

export function ModalBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
  );
}

/**
 * Di HP tombol aksi langsung di footer dibagi rata (mis. Batal | Simpan = 50% : 50%);
 * di layar lebar (≥ sm) tombol selebar isinya dan rata kanan.
 * Elemen pembungkus atau tombol ber-`mr-auto` (mis. Hapus di kiri) tetap selebar isinya.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 justify-end gap-2 max-sm:[&>button:not(.mr-auto)]:min-w-0 max-sm:[&>button:not(.mr-auto)]:flex-1 max-sm:[&>button:not(.mr-auto)]:justify-center max-sm:[&>button:not(.mr-auto)]:px-3 border-t border-slate-100 bg-slate-50/80 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6">
      {children}
    </div>
  );
}
