import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, getInputClassName } from '@client/components/FormField';
import { apiFetch } from '@client/lib/api';
import type { QuickParseResult } from '@shared/types/domain';
import { formatMoney, toMinorUnits } from '@shared/utils/currency';
import { parseQuickInput } from '@shared/utils/quick-parser';
import { type QuickInputFormValues, quickInputSchema } from '@shared/validation/quick-input';

const SAMPLE_PROMPTS = [
  'makan siang 25rb gopay',
  '+gaji freelance 5.5jt bca',
  'hosting server $12.50 wise',
];

export function QuickInputTester() {
  const [serverResult, setServerResult] = useState<QuickParseResult | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<QuickInputFormValues>({
    resolver: zodResolver(quickInputSchema),
    mode: 'onTouched',
    defaultValues: { input: 'makan siang 25rb gopay' },
  });

  const currentInput = watch('input') ?? '';
  const livePreview = parseQuickInput(currentInput);

  async function onSubmit(values: QuickInputFormValues) {
    const data = await apiFetch<QuickParseResult>('/api/utils/parse-quick-input', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    setServerResult(data);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Quick Input Teks Cepat</h2>
          <p className="text-xs text-slate-500">
            Validasi wajib otomatis memakai <code className="text-teal-700">react-hook-form + zod</code>.
          </p>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <FormField id="quick-input" error={errors.input?.message}>
            <input
              id="quick-input"
              type="text"
              placeholder="Contoh: makan siang 25rb gopay"
              aria-invalid={Boolean(errors.input)}
              className={getInputClassName(Boolean(errors.input))}
              {...register('input')}
            />
          </FormField>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
        >
          <span>{isSubmitting ? 'Memproses...' : 'Uji ke API'}</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {SAMPLE_PROMPTS.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => setValue('input', sample, { shouldValidate: true, shouldTouch: true })}
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
          >
            {sample}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-4">
        <div>
          <span className="block text-slate-400">Jenis</span>
          <span
            className={`font-semibold ${
              livePreview.type === 'income' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {livePreview.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}
          </span>
        </div>
        <div>
          <span className="block text-slate-400">Nominal</span>
          <span className="font-semibold text-slate-900">
            {livePreview.amount !== null
              ? formatMoney(
                  toMinorUnits(livePreview.amount, livePreview.currency),
                  livePreview.currency
                )
              : 'Belum terdeteksi'}
          </span>
        </div>
        <div>
          <span className="block text-slate-400">Deskripsi</span>
          <span className="font-semibold text-slate-900">{livePreview.description || '-'}</span>
        </div>
        <div>
          <span className="block text-slate-400">Dompet</span>
          <span className="font-semibold text-slate-900">{livePreview.walletHint ?? '-'}</span>
        </div>
      </div>

      {serverResult ? (
        <p className="mt-2 text-xs text-emerald-700">
          Respons API Hono terverifikasi: <code>{serverResult.type}</code> ·{' '}
          <code>{serverResult.amount ?? 0}</code> {serverResult.currency}
        </p>
      ) : null}
    </section>
  );
}
