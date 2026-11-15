/**
 * Kustomisasi tampilan (ikon + warna) untuk Workspace, dompet, dan kategori.
 * Ikon disimpan sebagai kunci teks (nama ikon lucide, kebab-case); client memetakan kunci ke komponen.
 * Murni — dipakai server (validasi) maupun client (picker).
 */

export const APPEARANCE_ICONS = [
  // Keuangan & dompet
  'wallet',
  'landmark',
  'credit-card',
  'banknote',
  'coins',
  'piggy-bank',
  'smartphone',
  'trending-up',
  'building-2',
  // Orang & tempat
  'user',
  'users',
  'home',
  'briefcase',
  'store',
  'heart',
  'baby',
  'paw-print',
  'graduation-cap',
  // Pengeluaran sehari-hari
  'utensils',
  'coffee',
  'shopping-bag',
  'shopping-cart',
  'car',
  'bus',
  'fuel',
  'plane',
  'receipt',
  'zap',
  'wifi',
  'phone',
  'shirt',
  'stethoscope',
  'pill',
  'dumbbell',
  // Hiburan & lainnya
  'film',
  'gamepad-2',
  'music',
  'book-open',
  'gift',
  'sparkles',
  'calendar',
  'key',
  'package',
  'settings',
  'megaphone',
  'laptop',
  'wrench',
  'leaf',
  'globe',
  'tag',
] as const;

export type AppearanceIcon = (typeof APPEARANCE_ICONS)[number];

/** Palet yang ditawarkan di UI. Server tetap menerima hex #RRGGBB apa pun. */
export const APPEARANCE_COLORS = [
  '#0d9488',
  '#059669',
  '#10b981',
  '#0ea5e9',
  '#2563eb',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#64748b',
] as const;

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isAppearanceIcon(value: string): value is AppearanceIcon {
  return (APPEARANCE_ICONS as readonly string[]).includes(value);
}
