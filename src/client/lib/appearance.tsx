import {
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Building2,
  Bus,
  Calendar,
  Car,
  Coffee,
  Coins,
  CreditCard,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  House,
  Key,
  Landmark,
  Laptop,
  Leaf,
  type LucideIcon,
  Megaphone,
  Music,
  Package,
  PawPrint,
  Phone,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Settings,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Stethoscope,
  Store,
  Tag,
  TrendingUp,
  User,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';
import type { WalletKind, WorkspaceType } from '@shared/types/domain';
import { type AppearanceIcon, HEX_COLOR_PATTERN, isAppearanceIcon } from '@shared/utils/appearance';

/** Kunci ikon (disimpan di DB) → komponen lucide. */
export const ICON_COMPONENT: Record<AppearanceIcon, LucideIcon> = {
  wallet: Wallet,
  landmark: Landmark,
  'credit-card': CreditCard,
  banknote: Banknote,
  coins: Coins,
  'piggy-bank': PiggyBank,
  smartphone: Smartphone,
  'trending-up': TrendingUp,
  'building-2': Building2,
  user: User,
  users: Users,
  home: House,
  briefcase: Briefcase,
  store: Store,
  heart: Heart,
  baby: Baby,
  'paw-print': PawPrint,
  'graduation-cap': GraduationCap,
  utensils: Utensils,
  coffee: Coffee,
  'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart,
  car: Car,
  bus: Bus,
  fuel: Fuel,
  plane: Plane,
  receipt: Receipt,
  zap: Zap,
  wifi: Wifi,
  phone: Phone,
  shirt: Shirt,
  stethoscope: Stethoscope,
  pill: Pill,
  dumbbell: Dumbbell,
  film: Film,
  'gamepad-2': Gamepad2,
  music: Music,
  'book-open': BookOpen,
  gift: Gift,
  sparkles: Sparkles,
  calendar: Calendar,
  key: Key,
  package: Package,
  settings: Settings,
  megaphone: Megaphone,
  laptop: Laptop,
  wrench: Wrench,
  leaf: Leaf,
  globe: Globe,
  tag: Tag,
};

export interface Appearance {
  icon: AppearanceIcon;
  color: string;
}

/** Tampilan bawaan Workspace bila belum dikustomisasi. */
export const WORKSPACE_DEFAULT_APPEARANCE: Record<WorkspaceType, Appearance> = {
  personal: { icon: 'user', color: '#0d9488' },
  shared: { icon: 'users', color: '#6366f1' },
  business: { icon: 'briefcase', color: '#f97316' },
};

/** Tampilan bawaan dompet sesuai jenisnya. */
export const WALLET_DEFAULT_APPEARANCE: Record<WalletKind, Appearance> = {
  bank: { icon: 'landmark', color: '#2563eb' },
  ewallet: { icon: 'smartphone', color: '#0ea5e9' },
  cash: { icon: 'banknote', color: '#059669' },
  investment: { icon: 'trending-up', color: '#8b5cf6' },
  other: { icon: 'wallet', color: '#64748b' },
};

/** Gabungkan nilai tersimpan (boleh null/tidak dikenal) dengan bawaan. */
export function resolveAppearance(
  stored: { icon?: string | null; color?: string | null },
  fallback: Appearance
): Appearance {
  return {
    icon: stored.icon && isAppearanceIcon(stored.icon) ? stored.icon : fallback.icon,
    color: stored.color && HEX_COLOR_PATTERN.test(stored.color) ? stored.color : fallback.color,
  };
}

export function workspaceAppearance(ws: { type: WorkspaceType; icon: string | null; color: string | null }): Appearance {
  return resolveAppearance(ws, WORKSPACE_DEFAULT_APPEARANCE[ws.type]);
}

export function walletAppearance(w: { kind: WalletKind; icon: string | null; color: string | null }): Appearance {
  return resolveAppearance(w, WALLET_DEFAULT_APPEARANCE[w.kind]);
}

/** Kategori selalu punya ikon & warna tersimpan; nilai lama/tak dikenal jatuh ke "tag" abu-abu. */
export function categoryAppearance(c: { icon: string | null; color: string | null }): Appearance {
  return resolveAppearance(c, { icon: 'tag', color: '#64748b' });
}

const BADGE_SIZE = {
  xs: { box: 'h-6 w-6 rounded-md', icon: 'h-3.5 w-3.5' },
  sm: { box: 'h-8 w-8 rounded-lg', icon: 'h-4 w-4' },
  md: { box: 'h-10 w-10 rounded-xl', icon: 'h-5 w-5' },
  lg: { box: 'h-14 w-14 rounded-2xl', icon: 'h-7 w-7' },
} as const;

/** Kotak berwarna dengan ikon putih — identitas visual Workspace / dompet / kategori. */
export function AppearanceBadge({
  appearance,
  size = 'sm',
  variant = 'solid',
  className = '',
}: {
  appearance: Appearance;
  size?: keyof typeof BADGE_SIZE;
  /** `soft`: latar tipis + ikon berwarna (untuk daftar yang padat). */
  variant?: 'solid' | 'soft';
  className?: string;
}) {
  const Icon = ICON_COMPONENT[appearance.icon];
  const s = BADGE_SIZE[size];
  const style =
    variant === 'solid'
      ? { backgroundColor: appearance.color, color: '#fff' }
      : { backgroundColor: `${appearance.color}1f`, color: appearance.color };
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${s.box} ${className}`} style={style}>
      <Icon className={s.icon} />
    </span>
  );
}
