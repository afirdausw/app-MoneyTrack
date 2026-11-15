import { useEffect, useState } from 'react';

const SIZE_CLASS = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
} as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Foto profil (dari akun Google); jatuh ke inisial nama bila tidak ada atau gagal dimuat. */
export function UserAvatar({
  name,
  avatarUrl,
  size = 'md',
  className = '',
}: {
  name: string;
  avatarUrl: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatarUrl]);

  const base = `${SIZE_CLASS[size]} shrink-0 rounded-full ring-1 ring-slate-200 ${className}`;

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        // Server foto Google (lh3.googleusercontent.com) kadang menolak permintaan yang membawa Referer.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${base} object-cover`}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      className={`${base} inline-flex items-center justify-center bg-teal-100 font-semibold text-teal-800`}
    >
      {initialsOf(name)}
    </span>
  );
}
