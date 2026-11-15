import { Check, ChevronDown, Search } from 'lucide-react';
import {
  Children,
  type CSSProperties,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
  /** Paksa kolom pencarian tampil/tersembunyi. Bawaan: tampil bila opsi lebih dari 6. */
  searchable?: boolean;
}

interface OptionItem {
  value: string;
  label: string;
  disabled: boolean;
}

const SEARCH_THRESHOLD = 6;
const MAX_LIST_HEIGHT = 288;
const GAP = 6;

/** Teks polos dari children <option> (mis. `{w.name} · {formatMoney(...)}`). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function readOptions(children: ReactNode): OptionItem[] {
  const items: OptionItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (el.type === 'option') {
      const label = textOf(el.props.children);
      items.push({ value: String(el.props.value ?? label), label, disabled: Boolean(el.props.disabled) });
    } else if (el.props.children) {
      items.push(...readOptions(el.props.children)); // fragment / optgroup
    }
  });
  return items;
}

const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;

/**
 * Select modern pengganti `<select>` bawaan: trigger bergaya input, daftar melayang (portal) dengan pencarian
 * dan navigasi keyboard.
 *
 * Drop-in: tetap menerima `<option>` sebagai children dan API `<select>` biasa — termasuk `register()` React Hook
 * Form — karena di baliknya ada `<select>` asli tersembunyi yang memegang nilai. Memilih opsi mengisi select asli
 * lalu memicu event `change`, jadi `onChange` / RHF berjalan seperti biasa.
 */
export const Select = forwardRef(function Select(
  { hasError = false, searchable, className = '', children, id, disabled, value, defaultValue, onChange, ...rest }: SelectProps,
  forwardedRef: ForwardedRef<HTMLSelectElement>
) {
  const options = readOptions(children);
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [current, setCurrent] = useState<string>(() =>
    value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : ''
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({});

  const selectedValue = value !== undefined ? String(value) : current;
  const selected = options.find((o) => o.value === selectedValue);
  // Opsi kosong yang dinonaktifkan (mis. "Pilih dompet") dipakai sebagai placeholder, bukan pilihan.
  const placeholder = options.find((o) => o.value === '' && o.disabled)?.label ?? 'Pilih...';
  const choices = options.filter((o) => !(o.value === '' && o.disabled));
  const showSearch = searchable ?? choices.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const filtered = q ? choices.filter((o) => o.label.toLowerCase().includes(q)) : choices;

  /**
   * Ref gabungan: pasang pengintai properti `value` di elemen select asli agar perubahan dari luar
   * (RHF `reset` / `setValue` menulis `el.value` langsung, tanpa event) ikut memperbarui tampilan.
   */
  const setNativeRef = useCallback(
    (el: HTMLSelectElement | null) => {
      nativeRef.current = el;
      if (el && !Object.prototype.hasOwnProperty.call(el, 'value')) {
        Object.defineProperty(el, 'value', {
          configurable: true,
          get() {
            return valueDescriptor.get!.call(this);
          },
          set(next: string) {
            valueDescriptor.set!.call(this, next);
            setCurrent(valueDescriptor.get!.call(this) as string);
          },
        });
        setCurrent(el.value);
      }
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef]
  );

  // Opsi bisa datang belakangan (data dimuat async): sinkronkan dengan nilai yang dipegang select asli.
  useEffect(() => {
    if (value === undefined && nativeRef.current) setCurrent(nativeRef.current.value);
  }, [children, value]);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - GAP;
    const above = rect.top - GAP;
    const openUp = below < 220 && above > below;
    const width = Math.max(rect.width, 200);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPosition({
      position: 'fixed',
      left,
      width,
      maxHeight: Math.min(MAX_LIST_HEIGHT + (showSearch ? 52 : 0), (openUp ? above : below) - 8),
      ...(openUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    });
  }, [showSearch]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  // Tutup saat klik/sentuh di luar trigger & daftar.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // Saat dibuka: sorot opsi terpilih & fokus ke pencarian (kecuali di layar sentuh, agar keyboard tidak muncul).
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, choices.findIndex((o) => o.value === selectedValue)));
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (showSearch && !touch) searchRef.current?.focus();
    else listRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function close(refocus = true) {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  }

  function choose(option: OptionItem) {
    if (option.disabled) return;
    const el = nativeRef.current;
    if (el) {
      valueDescriptor.set!.call(el, option.value);
      // Event `change` asli → onChange React & handler RHF berjalan dengan `event.target.value` yang baru.
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setCurrent(option.value);
    close();
  }

  function move(delta: number) {
    if (filtered.length === 0) return;
    let next = active;
    for (let i = 0; i < filtered.length; i++) {
      next = (next + delta + filtered.length) % filtered.length;
      if (!filtered[next]!.disabled) break;
    }
    setActive(next);
  }

  function onListKey(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(filtered.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        if (filtered[active]) choose(filtered[active]);
        break;
      case 'Escape':
        // Jangan sampai ikut menutup modal di belakangnya.
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
    }
  }

  function onTriggerKey(event: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <select
        ref={setNativeRef}
        {...rest}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={rest['aria-label']}
        aria-invalid={hasError || undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKey}
        className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm outline-none transition focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
          hasError
            ? 'border-rose-500 focus-visible:ring-rose-500/20'
            : open
              ? 'border-teal-600 ring-2 ring-teal-600/20'
              : 'border-slate-300 hover:border-slate-400 focus-visible:border-teal-600 focus-visible:ring-teal-600/20'
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected && selected.value !== '' ? 'text-slate-900' : selected ? 'text-slate-700' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open
        ? createPortal(
            <div
              ref={listRef}
              tabIndex={-1}
              onKeyDown={onListKey}
              style={position}
              className="z-50 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 outline-none animate-pop"
            >
              {showSearch ? (
                <div className="border-b border-slate-100 p-2">
                  <div className="relative">
                    <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                      }}
                      placeholder="Cari..."
                      aria-label="Cari opsi"
                      aria-controls={listboxId}
                      autoComplete="off"
                      className="w-full rounded-lg bg-slate-50 py-2 pr-3 pl-8 text-sm outline-none placeholder:text-slate-400 focus:bg-slate-100"
                    />
                  </div>
                </div>
              ) : null}
              <div id={listboxId} role="listbox" aria-labelledby={id} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                {filtered.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400">Tidak ada yang cocok.</p>
                ) : (
                  filtered.map((option, index) => {
                    const isSelected = option.value === selectedValue;
                    const isActive = index === active;
                    return (
                      <div
                        key={`${option.value}-${index}`}
                        role="option"
                        data-index={index}
                        aria-selected={isSelected}
                        aria-disabled={option.disabled || undefined}
                        onPointerEnter={() => setActive(index)}
                        onClick={() => choose(option)}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          option.disabled
                            ? 'cursor-not-allowed text-slate-300'
                            : isActive
                              ? 'bg-slate-100 text-slate-900'
                              : 'text-slate-700'
                        } ${isSelected ? 'font-semibold text-teal-800' : ''}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {isSelected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-700" /> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
});
