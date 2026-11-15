import AirDatepicker, {
  type AirDatepickerButton,
  type AirDatepickerLocale,
  type AirDatepickerPositionCallback,
} from 'air-datepicker';
import 'air-datepicker/air-datepicker.css';
import { CalendarDays } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { toDateInput } from '@client/lib/dates';

const LOCALE_ID: AirDatepickerLocale = {
  days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  daysShort: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
  daysMin: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
  months: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'],
  today: 'Hari ini',
  clear: 'Hapus',
  dateFormat: 'dd/MM/yyyy',
  timeFormat: 'HH:mm',
  firstDay: 1,
};

const displayFormatter = new Intl.DateTimeFormat('id-ID', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const chevron = (d: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

/** `YYYY-MM-DD` → Date lokal (tengah hari agar aman dari pergeseran zona waktu). */
function parseDateKey(value: string | undefined): Date | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}

const GAP = 6;
const EDGE = 8;

/**
 * Posisi desktop: fixed di bawah input (rata kiri), pindah ke atas bila tidak muat, dan dijepit ke tepi layar.
 * Bawaan Air Datepicker tidak pernah membalik arah sehingga kalender terpotong di bagian bawah modal/halaman.
 */
const placeBelowOrAbove: AirDatepickerPositionCallback = ({ $datepicker, $target, isViewChange }) => {
  const r = $target.getBoundingClientRect();
  const w = $datepicker.offsetWidth;
  const h = $datepicker.offsetHeight;
  const below = r.bottom + GAP;
  const fitsBelow = below + h <= window.innerHeight - EDGE;
  const fitsAbove = r.top - GAP - h >= EDGE;
  const top = fitsBelow || !fitsAbove ? Math.max(EDGE, Math.min(below, window.innerHeight - h - EDGE)) : r.top - GAP - h;
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE));
  $datepicker.style.position = 'fixed';
  $datepicker.style.left = `${left}px`;
  $datepicker.style.top = `${top}px`;
  $datepicker.dataset.side = top < r.top ? 'top' : 'bottom';
  if (!isViewChange) {
    // Animasi muncul (posisi kustom mematikan transisi bawaan).
    $datepicker.classList.remove('mt-datepicker-enter');
    void $datepicker.offsetWidth;
    $datepicker.classList.add('mt-datepicker-enter');
  }
};

function inRange(date: Date, min?: string, max?: string): boolean {
  const key = toDateInput(date);
  return (!min || key >= min) && (!max || key <= max);
}

interface DatePickerProps {
  /** Nilai `YYYY-MM-DD`; string kosong = belum dipilih. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  id?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  /** Tampilkan tombol "Hapus" (untuk tanggal opsional). */
  clearable?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * Pemilih tanggal berbasis Air Datepicker dengan tampilan mengikuti aplikasi (palet Tailwind, ikut dark mode lewat
 * variabel CSS di `index.css`). API-nya terkendali: `value`/`onChange` berupa date key `YYYY-MM-DD`. Di layar kecil
 * kalender muncul di tengah layar dengan overlay; di desktop menempel di bawah input.
 */
export function DatePicker({
  value,
  onChange,
  onBlur,
  id,
  min,
  max,
  placeholder = 'Pilih tanggal',
  clearable = false,
  invalid = false,
  disabled = false,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dpRef = useRef<AirDatepicker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const rangeRef = useRef({ min, max });
  rangeRef.current = { min, max };
  /** Kembalikan fokus ke input setelah kalender tertutup (Air Datepicker mem-blur input saat hide). */
  const refocusRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const buttons: AirDatepickerButton[] = [
      {
        content: 'Hari ini',
        className: 'adp-btn-today',
        onClick: (dp) => {
          const today = new Date();
          if (!inRange(today, rangeRef.current.min, rangeRef.current.max)) return;
          void dp.selectDate(today);
          dp.setViewDate(today);
        },
      },
    ];
    if (clearable) {
      buttons.push({
        content: 'Hapus',
        className: 'adp-btn-clear',
        onClick: (dp) => {
          dp.clear();
          dp.hide();
        },
      });
    }

    const initial = parseDateKey(value);
    const isMobile = window.matchMedia('(max-width: 639px)').matches;
    const dp = new AirDatepicker(input, {
      locale: LOCALE_ID,
      classes: 'mt-datepicker',
      isMobile,
      autoClose: true,
      toggleSelected: false,
      keyboardNav: true,
      // Dibuka lewat klik / Enter / Spasi / panah bawah (bukan saat fokus) agar fokus bisa dikembalikan tanpa membukanya lagi.
      showEvent: 'click',
      position: isMobile ? 'bottom left' : placeBelowOrAbove,
      selectedDates: initial ? [initial] : false,
      startDate: initial ?? new Date(),
      minDate: parseDateKey(min) ?? false,
      maxDate: parseDateKey(max) ?? false,
      dateFormat: (d) => displayFormatter.format(d),
      navTitles: { days: '<strong>MMMM</strong> yyyy', months: '<strong>yyyy</strong>', years: '<strong>yyyy1 – yyyy2</strong>' },
      prevHtml: chevron('m15 18-6-6 6-6'),
      nextHtml: chevron('m9 18 6-6-6-6'),
      buttons,
      onSelect: ({ date, datepicker }) => {
        const picked = Array.isArray(date) ? date[0] : date;
        onChangeRef.current(picked ? toDateInput(picked) : '');
        // autoClose menyembunyikan kalender sebelum onSelect dipanggil, jadi fokus dikembalikan dari sini.
        if (!datepicker.visible) {
          window.requestAnimationFrame(() => input.focus({ preventScroll: true }));
        } else {
          refocusRef.current = true;
        }
      },
      onShow: (done) => {
        if (!done) refocusRef.current = false;
      },
      onHide: (done) => {
        if (done || !refocusRef.current) return;
        refocusRef.current = false;
        window.requestAnimationFrame(() => input.focus({ preventScroll: true }));
      },
    });
    dpRef.current = dp;
    return () => {
      dp.destroy();
      dpRef.current = null;
    };
    // Dibuat sekali per mount; perubahan nilai/rentang disinkronkan oleh efek di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearable]);

  // Sinkronkan nilai dari luar (reset form, setValue) tanpa memicu onChange.
  useEffect(() => {
    const dp = dpRef.current;
    if (!dp) return;
    const next = parseDateKey(value);
    const current = dp.selectedDates[0];
    if (next && (!current || toDateInput(current) !== value)) {
      void dp.selectDate(next, { silent: true });
      dp.setViewDate(next);
    } else if (!next && current) {
      dp.clear({ silent: true });
    }
  }, [value]);

  useEffect(() => {
    dpRef.current?.update({ minDate: parseDateKey(min) ?? false, maxDate: parseDateKey(max) ?? false }, { silent: true });
  }, [min, max]);

  // Desktop: posisi kalender dihitung saat dibuka, jadi tutup saat kontainer di belakangnya di-scroll.
  useEffect(() => {
    function onScroll(event: Event) {
      const dp = dpRef.current;
      if (!dp?.visible || dp.$datepicker.classList.contains('-is-mobile-')) return;
      if (event.target instanceof Node && dp.$datepicker.contains(event.target)) return;
      dp.hide();
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);

  /**
   * Fase capture: berjalan sebelum listener keyboard Air Datepicker di input, jadi status `visible` masih yang
   * sebelum tombol ditekan. Saat kalender terbuka, navigasi (panah, Ctrl+panah, Enter) diserahkan ke Air Datepicker;
   * hanya Escape yang dicegat agar tidak ikut menutup modal di belakangnya.
   */
  function onKeyDownCapture(event: KeyboardEvent<HTMLInputElement>) {
    const dp = dpRef.current;
    if (!dp) return;
    if (dp.visible) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        refocusRef.current = true;
        dp.hide();
      }
      return;
    }
    if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      dp.show();
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && clearable && value) {
      event.preventDefault();
      event.stopPropagation();
      dp.clear();
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        readOnly
        inputMode="none"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        onClick={() => {
          if (dpRef.current && !dpRef.current.visible) dpRef.current.show();
        }}
        onKeyDownCapture={onKeyDownCapture}
        onBlur={onBlur}
        className={`w-full cursor-pointer rounded-xl border bg-white py-2.5 pr-10 pl-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
          invalid
            ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-500/20'
            : 'border-slate-300 hover:border-slate-400 focus:border-teal-600 focus:ring-teal-600/20'
        }`}
      />
      <CalendarDays
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}
