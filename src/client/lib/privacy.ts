import { useSyncExternalStore } from 'react';
import type { CurrencyCode } from '@shared/types/domain';
import { formatMoney as formatMoneyRaw } from '@shared/utils/currency';

/**
 * Mode privasi: sembunyikan nominal di layar (mis. saat membuka aplikasi di tempat umum).
 * Disimpan per perangkat di localStorage — sengaja bukan di server, karena kebutuhannya
 * tergantung di mana layar sedang dibuka, bukan siapa usernya.
 */
const STORAGE_KEY = 'mt:hide-amounts';
const MASK = '•••••';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let hidden = typeof window !== 'undefined' ? readStored() : false;
const listeners = new Set<() => void>();

export function setAmountsHidden(value: boolean): void {
  hidden = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Mode privat / storage diblokir: tetap berlaku selama sesi ini.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Status mode privasi. Cukup dipanggil di komponen induk (AppShell): saat berubah, seluruh pohon di bawahnya
 * ikut render ulang sehingga semua `formatMoney` di bawah ini membaca nilai terbaru.
 */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => false);
}

export function areAmountsHidden(): boolean {
  return hidden;
}

/**
 * Pengganti `formatMoney` untuk menampilkan saldo/nominal tersimpan. Saat mode privasi aktif,
 * angka diganti titik tapi simbol mata uang tetap ("Rp •••••").
 * Jangan dipakai untuk menggemakan nominal yang sedang diketik user (pakai versi `@shared` langsung).
 */
export function formatMoney(amountMinor: number, currency: CurrencyCode): string {
  if (!hidden) return formatMoneyRaw(amountMinor, currency);
  return formatMoneyRaw(0, currency).replace(/[\d.,]+/, MASK);
}
