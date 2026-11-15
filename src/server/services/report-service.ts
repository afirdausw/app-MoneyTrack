import { and, asc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { categories, invoices, projects, transactions, users, wallets } from '@server/db/schema';
import type { DbClient } from '@server/lib/http';
import { type CellValue, type Sheet, type SheetColumn } from '@server/lib/xlsx';
import type { CurrencyCode, ReportSummary, TrendPoint, WorkspaceSummary } from '@shared/types/domain';
import { CURRENCY_META } from '@shared/utils/currency';
import { dateKeyToDate } from '@shared/utils/schedule';

/** Rentang [awal hari `from`, awal hari setelah `to`) dalam waktu lokal server. */
export function dateRange(fromKey: string, toKey: string): { from: Date; to: Date } {
  const from = dateKeyToDate(fromKey);
  from.setHours(0, 0, 0, 0);
  const to = dateKeyToDate(toKey);
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export async function reportSummary(
  db: DbClient,
  workspace: WorkspaceSummary,
  fromKey: string,
  toKey: string
): Promise<ReportSummary> {
  const { from, to } = dateRange(fromKey, toKey);
  const inPeriod = and(
    eq(transactions.workspaceId, workspace.id),
    gte(transactions.occurredAt, from),
    lt(transactions.occurredAt, to),
    ne(transactions.type, 'transfer')
  );
  const total = sql<string>`coalesce(sum(${transactions.convertedAmountMinor}), 0)`;
  const n = sql<number>`count(*)`.mapWith(Number);

  const [byCategory, byWallet, byProject] = await Promise.all([
    db
      .select({
        type: transactions.type,
        categoryId: categories.id,
        name: categories.name,
        color: categories.color,
        icon: categories.icon,
        total,
        count: n,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(inPeriod)
      .groupBy(transactions.type, categories.id, categories.name, categories.color, categories.icon),
    db
      .select({ type: transactions.type, walletId: wallets.id, name: wallets.name, total })
      .from(transactions)
      .innerJoin(wallets, eq(transactions.walletId, wallets.id))
      .where(inPeriod)
      .groupBy(transactions.type, wallets.id, wallets.name),
    db
      .select({ type: transactions.type, projectId: projects.id, name: projects.name, total })
      .from(transactions)
      .innerJoin(projects, eq(transactions.projectId, projects.id))
      .where(inPeriod)
      .groupBy(transactions.type, projects.id, projects.name),
  ]);

  const sumType = (type: 'income' | 'expense') =>
    byCategory.filter((r) => r.type === type).reduce((acc, r) => acc + Number(r.total), 0);
  const income = sumType('income');
  const expense = sumType('expense');

  /** Gabungkan baris per-jenis menjadi satu baris per entitas dengan kolom pemasukan & pengeluaran. */
  function pivot<K extends 'walletId' | 'projectId'>(
    rows: Array<{ type: string; name: string; total: string } & Record<K, number>>,
    key: K
  ) {
    const map = new Map<number, { id: number; name: string; incomeMinor: number; expenseMinor: number }>();
    for (const r of rows) {
      const id = r[key];
      const entry = map.get(id) ?? { id, name: r.name, incomeMinor: 0, expenseMinor: 0 };
      if (r.type === 'income') entry.incomeMinor += Number(r.total);
      else entry.expenseMinor += Number(r.total);
      map.set(id, entry);
    }
    return [...map.values()].sort((a, b) => b.incomeMinor + b.expenseMinor - (a.incomeMinor + a.expenseMinor));
  }

  return {
    from: fromKey,
    to: toKey,
    currency: workspace.primaryCurrency,
    incomeMinor: income,
    expenseMinor: expense,
    netMinor: income - expense,
    transactionCount: byCategory.reduce((acc, r) => acc + r.count, 0),
    categories: byCategory
      .map((r) => ({
        type: r.type as 'income' | 'expense',
        categoryId: r.categoryId,
        name: r.name ?? 'Tanpa kategori',
        color: r.color ?? '#94a3b8',
        /** Transaksi tanpa kategori memakai ikon tag abu-abu. */
        icon: r.icon ?? 'tag',
        totalMinor: Number(r.total),
        count: r.count,
      }))
      .sort((a, b) => b.totalMinor - a.totalMinor),
    wallets: pivot(byWallet, 'walletId'),
    projects: pivot(byProject, 'projectId'),
  };
}

/** Pemasukan & pengeluaran per bulan untuk `months` bulan terakhir s.d. `endMonth` (termasuk bulan kosong). */
export async function reportTrend(
  db: DbClient,
  workspaceId: number,
  endMonth: string,
  months: number
): Promise<TrendPoint[]> {
  const [endYear, endMon] = endMonth.split('-').map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(endYear, endMon - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const [firstYear, firstMon] = keys[0]!.split('-').map(Number) as [number, number];
  const from = new Date(firstYear, firstMon - 1, 1);
  const to = new Date(endYear, endMon, 1);

  const rows = await db
    .select({
      type: transactions.type,
      occurredAt: transactions.occurredAt,
      amount: transactions.convertedAmountMinor,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        gte(transactions.occurredAt, from),
        lt(transactions.occurredAt, to),
        ne(transactions.type, 'transfer')
      )
    );

  // Kelompokkan per bulan di Node (zona waktu lokal), bukan di SQL, agar konsisten dengan filter bulan lain.
  const points = new Map(keys.map((k) => [k, { month: k, incomeMinor: 0, expenseMinor: 0 }]));
  for (const row of rows) {
    const d = row.occurredAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const point = points.get(key);
    if (!point) continue;
    if (row.type === 'income') point.incomeMinor += row.amount;
    else point.expenseMinor += row.amount;
  }
  return [...points.values()];
}

const TYPE_LABEL: Record<string, string> = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer' };

/** Data ekspor transaksi periode: sheet "Transaksi" (+ "Ringkasan Kategori" untuk XLSX). */
export async function exportSheets(
  db: DbClient,
  workspace: WorkspaceSummary,
  fromKey: string,
  toKey: string
): Promise<{ transactions: Sheet; summary: Sheet }> {
  const { from, to } = dateRange(fromKey, toKey);
  const targetWallet = alias(wallets, 'export_target_wallet');
  const rows = await db
    .select({
      occurredAt: transactions.occurredAt,
      type: transactions.type,
      title: transactions.title,
      category: categories.name,
      wallet: wallets.name,
      targetWallet: targetWallet.name,
      amountMinor: transactions.amountMinor,
      currency: transactions.currencyCode,
      rate: transactions.exchangeRateToWorkspace,
      convertedMinor: transactions.convertedAmountMinor,
      project: projects.name,
      invoice: invoices.invoiceNumber,
      notes: transactions.notes,
      createdBy: users.name,
    })
    .from(transactions)
    .innerJoin(wallets, eq(transactions.walletId, wallets.id))
    .leftJoin(targetWallet, eq(transactions.transferTargetWalletId, targetWallet.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(projects, eq(transactions.projectId, projects.id))
    .leftJoin(invoices, eq(transactions.invoiceId, invoices.id))
    .innerJoin(users, eq(transactions.createdByUserId, users.id))
    .where(and(eq(transactions.workspaceId, workspace.id), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)))
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));

  const primary = workspace.primaryCurrency;
  const major = (minor: number, currency: CurrencyCode) => minor / 10 ** CURRENCY_META[currency].decimals;
  const amountFormat = (currency: CurrencyCode) => (CURRENCY_META[currency].decimals > 0 ? 'decimal' : 'int');
  // Kolom nominal asli bisa campuran mata uang → format desimal agar USD tetap terbaca benar.
  const mixedCurrency = rows.some((r) => r.currency !== primary);

  const columns: SheetColumn[] = [
    { header: 'Tanggal', width: 17, format: 'date' },
    { header: 'Jenis', width: 12 },
    { header: 'Keterangan', width: 32 },
    { header: 'Kategori', width: 20 },
    { header: 'Dompet', width: 18 },
    { header: 'Dompet Tujuan', width: 18 },
    { header: 'Nominal', width: 15, format: mixedCurrency ? 'decimal' : amountFormat(primary) },
    { header: 'Mata Uang', width: 10 },
    { header: 'Kurs', width: 12 },
    { header: `Nominal (${primary})`, width: 17, format: amountFormat(primary) },
    { header: 'Project', width: 22 },
    { header: 'Invoice', width: 16 },
    { header: 'Catatan', width: 30 },
    { header: 'Dicatat oleh', width: 18 },
  ];

  const data: CellValue[][] = rows.map((r) => {
    const currency = r.currency as CurrencyCode;
    // Pengeluaran ditulis negatif agar kolom bisa langsung dijumlah menjadi arus kas bersih.
    const sign = r.type === 'expense' ? -1 : 1;
    return [
      r.occurredAt,
      TYPE_LABEL[r.type] ?? r.type,
      r.title,
      r.category,
      r.wallet,
      r.targetWallet,
      sign * major(r.amountMinor, currency),
      currency,
      currency === primary ? null : Number(r.rate),
      r.type === 'transfer' ? null : sign * major(r.convertedMinor, primary),
      r.project,
      r.invoice,
      r.notes,
      r.createdBy,
    ];
  });

  const summary = await reportSummary(db, workspace, fromKey, toKey);
  const summarySheet: Sheet = {
    name: 'Ringkasan Kategori',
    columns: [
      { header: 'Jenis', width: 14 },
      { header: 'Kategori', width: 26 },
      { header: 'Jumlah Transaksi', width: 16, format: 'int' },
      { header: `Total (${primary})`, width: 18, format: amountFormat(primary) },
    ],
    rows: [
      ...summary.categories.map((c) => [TYPE_LABEL[c.type], c.name, c.count, major(c.totalMinor, primary)]),
      [],
      ['Total pemasukan', null, null, major(summary.incomeMinor, primary)],
      ['Total pengeluaran', null, null, major(summary.expenseMinor, primary)],
      ['Selisih', null, null, major(summary.netMinor, primary)],
    ],
  };

  return { transactions: { name: 'Transaksi', columns, rows: data }, summary: summarySheet };
}
