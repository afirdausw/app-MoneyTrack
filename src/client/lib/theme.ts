import { useSyncExternalStore } from 'react';

/**
 * Tema terang/gelap. Pilihan user disimpan per perangkat (localStorage); bila belum pernah memilih,
 * ikut pengaturan sistem (`prefers-color-scheme`) dan berubah otomatis mengikuti sistem.
 * Tema diterapkan lewat kelas `dark` di <html> — palet gelapnya ada di `index.css`.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mt:theme';
const listeners = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current: Theme = typeof window !== 'undefined' ? (readStored() ?? systemTheme()) : 'light';

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  // Warna bilah status browser/PWA ikut tema.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1120' : '#0f766e');
}

/** Panggil sekali sebelum render pertama agar tidak berkedip terang. */
export function initTheme(): void {
  apply(current);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readStored()) return; // user sudah memilih sendiri
    current = systemTheme();
    apply(current);
    listeners.forEach((l) => l());
  });
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage diblokir: tetap berlaku selama sesi ini
  }
  apply(theme);
  listeners.forEach((l) => l());
}

const TRANSITION_MS = 1500;
/** Cepat di awal lalu melambat di akhir ("tambah pelan"). */
const TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Ganti tema dengan animasi lingkaran dari/ke tombol pemicu (View Transitions API):
 * - terang → gelap: lingkaran gelap muncul dari tombol lalu membesar menutup layar;
 * - gelap → terang: tampilan gelap menyusut dari seluruh layar kembali ke tombol.
 * Resolve setelah animasi selesai (dipakai untuk menahan tombol & menunda ganti ikon).
 * Tanpa dukungan browser atau dengan `prefers-reduced-motion`, tema langsung berganti.
 */
export async function switchThemeAnimated(next: Theme, origin: HTMLElement): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) {
    setTheme(next);
    return;
  }

  const rect = origin.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  // Jari-jari sampai sudut layar terjauh dari tombol.
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const toDark = next === 'dark';
  const root = document.documentElement;
  // Saat menyusut, snapshot lama (gelap) yang dianimasikan, jadi harus di atas snapshot baru.
  root.dataset.themeTransition = toDark ? 'grow' : 'shrink';

  const transition = document.startViewTransition(() => setTheme(next));
  try {
    await transition.ready;
    const small = `circle(0px at ${x}px ${y}px)`;
    const full = `circle(${radius}px at ${x}px ${y}px)`;
    root.animate(
      { clipPath: toDark ? [small, full] : [full, small] },
      {
        duration: TRANSITION_MS,
        easing: TRANSITION_EASING,
        fill: 'forwards',
        pseudoElement: toDark ? '::view-transition-new(root)' : '::view-transition-old(root)',
      }
    );
    await transition.finished;
  } catch {
    // Transisi dibatalkan browser: tema sudah diterapkan di callback, cukup lanjut.
  } finally {
    delete root.dataset.themeTransition;
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => 'light'
  );
}
