import { Check, RotateCcw } from 'lucide-react';
import { type Appearance, AppearanceBadge, ICON_COMPONENT, resolveAppearance } from '@client/lib/appearance';
import { APPEARANCE_COLORS, APPEARANCE_ICONS, type AppearanceIcon } from '@shared/utils/appearance';

export interface AppearanceValue {
  /** null = pakai bawaan. */
  icon: AppearanceIcon | null;
  color: string | null;
}

interface AppearancePickerProps {
  value: AppearanceValue;
  onChange: (value: AppearanceValue) => void;
  /** Tampilan bawaan (mis. sesuai mode Workspace / jenis dompet). */
  fallback: Appearance;
  /** Teks pratinjau di samping ikon. */
  previewLabel: string;
  previewHint?: string;
  /** Tampilkan tombol "Pakai bawaan" (Workspace & dompet; kategori selalu punya nilai). */
  allowReset?: boolean;
  disabled?: boolean;
}

/** Pemilih ikon + warna dengan pratinjau langsung. */
export function AppearancePicker({
  value,
  onChange,
  fallback,
  previewLabel,
  previewHint,
  allowReset = false,
  disabled = false,
}: AppearancePickerProps) {
  const current = resolveAppearance(value, fallback);
  const isDefault = value.icon === null && value.color === null;

  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-xs font-medium text-slate-700">Tampilan</legend>

      <div className="flex items-center gap-3">
        <AppearanceBadge appearance={current} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{previewLabel || 'Pratinjau'}</p>
          {previewHint ? <p className="truncate text-xs text-slate-500">{previewHint}</p> : null}
        </div>
        {allowReset && !isDefault ? (
          <button
            type="button"
            onClick={() => onChange({ icon: null, color: null })}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Bawaan
          </button>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="Warna" className="flex flex-wrap gap-2">
        {APPEARANCE_COLORS.map((c) => {
          const active = current.color.toLowerCase() === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Warna ${c}`}
              onClick={() => onChange({ ...value, color: c })}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                active ? 'ring-2 ring-offset-2' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c, ['--tw-ring-color' as string]: c }}
            >
              {active ? <Check className="h-4 w-4 text-white" /> : null}
            </button>
          );
        })}
      </div>

      <div
        role="radiogroup"
        aria-label="Ikon"
        className="grid max-h-44 grid-cols-7 gap-1.5 overflow-y-auto overscroll-contain sm:grid-cols-10"
      >
        {APPEARANCE_ICONS.map((key) => {
          const Icon = ICON_COMPONENT[key];
          const active = current.icon === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Ikon ${key}`}
              onClick={() => onChange({ ...value, icon: key })}
              className={`flex aspect-square items-center justify-center rounded-lg border transition ${
                active ? 'border-transparent text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              style={active ? { backgroundColor: current.color } : undefined}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
