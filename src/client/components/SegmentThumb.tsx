import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';

/**
 * Latar aktif yang meluncur untuk segmented control / tab. Letakkan sebagai anak pertama container (`relative`)
 * yang berisi tombol `role="radio"`/`role="tab"`; thumb mengukur tombol yang `aria-checked`/`aria-selected` lalu
 * berpindah ke sana dengan transisi (`.segment-thumb` di index.css). Tombol cukup mengganti warna teks saat aktif
 * dan memakai `relative` agar berada di atas thumb.
 *
 * Contoh: `<div role="radiogroup" className="relative grid …"><SegmentThumb className="bg-white shadow-xs" />…</div>`
 */
export function SegmentThumb({ className = 'bg-white shadow-xs' }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  // Posisi pertama langsung ditempatkan tanpa meluncur dari pojok kiri.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const thumb = ref.current;
    const parent = thumb?.parentElement;
    if (!thumb || !parent) return;

    function place() {
      const active = parent!.querySelector<HTMLElement>(':scope > [aria-checked="true"], :scope > [aria-selected="true"]');
      if (!active) {
        setStyle((s) => ({ ...s, opacity: 0 }));
        return;
      }
      setStyle({
        opacity: 1,
        width: active.offsetWidth,
        height: active.offsetHeight,
        transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
      });
    }

    place();
    // Timer (bukan rAF) agar tetap jalan meski tab sedang tidak dirender.
    const timer = window.setTimeout(() => setReady(true), 50);
    // Ikuti perubahan pilihan (atribut aria) dan ukuran (teks, layar) tanpa bergantung pada render parent.
    const mutation = new MutationObserver(place);
    mutation.observe(parent, { subtree: true, attributes: true, attributeFilter: ['aria-checked', 'aria-selected'] });
    const resize = new ResizeObserver(place);
    resize.observe(parent);
    return () => {
      window.clearTimeout(timer);
      mutation.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      style={style}
      className={`pointer-events-none absolute top-0 left-0 rounded-lg ${ready ? 'segment-thumb' : ''} ${className}`}
    />
  );
}
