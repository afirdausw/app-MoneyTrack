import { Download, WifiOff } from 'lucide-react';
import { useInstallPrompt, useOnlineStatus } from '@client/lib/pwa';

/** Banner tipis di atas layar saat perangkat offline. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-slate-900 print:hidden px-4 py-2 text-xs font-medium text-white"
    >
      <WifiOff className="h-3.5 w-3.5" />
      Kamu sedang offline — data belum bisa dimuat atau disimpan sampai koneksi kembali.
    </div>
  );
}

/** Tombol "Pasang Aplikasi" — hanya muncul bila browser menawarkan instalasi PWA. */
export function InstallAppButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'menu' }) {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return variant === 'sidebar' ? (
    <button
      type="button"
      onClick={() => void install()}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
    >
      <Download className="h-3.5 w-3.5" /> Pasang Aplikasi
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void install()}
      className="flex w-full items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3.5 text-left text-sm font-semibold text-teal-900"
    >
      <Download className="h-5 w-5" />
      <span className="flex-1">
        Pasang MoneyTrack
        <span className="block text-xs font-normal text-teal-700">Buka dari layar utama HP seperti aplikasi biasa.</span>
      </span>
    </button>
  );
}
