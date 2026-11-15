import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/**
 * Wadah yang tingginya beranimasi mengikuti isi (mis. ganti grafik ↔ tabel), alih-alih melompat.
 * Isi diukur dengan ResizeObserver; tinggi luar ditransisikan. Perubahan pertama tidak dianimasikan.
 */
export function AutoHeight({ children, className = '' }: { children: ReactNode; className?: string }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    setHeight(inner.offsetHeight);
    const timer = window.setTimeout(() => setAnimate(true), 50);
    const observer = new ResizeObserver(() => setHeight(inner.offsetHeight));
    observer.observe(inner);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={`overflow-hidden ${animate ? 'transition-[height] duration-300 ease-out-soft' : ''} ${className}`}
      style={{ height }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
