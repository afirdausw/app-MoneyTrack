import type { ReactNode } from 'react';

interface FormFieldProps {
  id: string;
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function getInputClassName(hasError: boolean, extraClassName = ''): string {
  const borderClass = hasError
    ? 'border-rose-500 focus:border-rose-600 focus:ring-rose-500/20'
    : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/20';

  return `w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition focus:ring-2 ${borderClass} ${extraClassName}`.trim();
}

export function FormField({ id, label, required, error, hint, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-slate-700">
          {label}
          {required ? <span className="ml-0.5 text-rose-600">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
