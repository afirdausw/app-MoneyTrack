import { describe, expect, it } from 'vitest';
import { effectiveInvoiceStatus, nextInvoiceNumber, statusAfterPayment } from '@shared/utils/invoice';
import { invoiceSchema } from '@shared/validation/business';
import { transactionInputSchema } from '@shared/validation/finance';

describe('invoice status', () => {
  it('derives stored status from payments', () => {
    expect(statusAfterPayment('sent', 0, 100)).toBe('sent');
    expect(statusAfterPayment('sent', 40, 100)).toBe('partial');
    expect(statusAfterPayment('partial', 100, 100)).toBe('paid');
    expect(statusAfterPayment('paid', 0, 100)).toBe('sent');
    expect(statusAfterPayment('draft', 0, 100)).toBe('draft');
    // Nominal invoice dinaikkan setelah lunas → kembali sebagian.
    expect(statusAfterPayment('paid', 100, 150)).toBe('partial');
  });

  it('shows overdue only for sent, unpaid invoices past their due date', () => {
    const today = '2026-11-15';
    const base = { paidMinor: 0, amountMinor: 100 };
    expect(effectiveInvoiceStatus({ ...base, status: 'sent', dueDate: '2026-11-14' }, today)).toBe('overdue');
    expect(effectiveInvoiceStatus({ ...base, status: 'partial', paidMinor: 50, dueDate: '2026-11-01' }, today)).toBe('overdue');
    expect(effectiveInvoiceStatus({ ...base, status: 'sent', dueDate: '2026-11-15' }, today)).toBe('sent');
    expect(effectiveInvoiceStatus({ ...base, status: 'draft', dueDate: '2026-01-01' }, today)).toBe('draft');
    expect(effectiveInvoiceStatus({ ...base, status: 'paid', paidMinor: 100, dueDate: '2026-01-01' }, today)).toBe('paid');
  });

  it('numbers invoices per month', () => {
    expect(nextInvoiceNumber('2026-11', [])).toBe('INV-202611-001');
    expect(nextInvoiceNumber('2026-11', ['INV-202611-001', 'INV-202611-007', 'INV-202610-099', 'CUSTOM-1'])).toBe(
      'INV-202611-008'
    );
  });
});

describe('business validation', () => {
  it('rejects due dates before the issue date', () => {
    const base = { title: 'Desain logo', amountMinor: 1_000_000, issuedAt: '2026-11-15' };
    expect(invoiceSchema.safeParse({ ...base, dueDate: '2026-11-01' }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, dueDate: '2026-11-30' }).success).toBe(true);
    expect(invoiceSchema.safeParse({ ...base, number: 'INV 1' }).success).toBe(false);
  });

  it('only income can pay an invoice and transfers are never project-linked', () => {
    const base = { walletId: 1, amountMinor: 1000, title: 'x' };
    expect(transactionInputSchema.safeParse({ ...base, type: 'expense', invoiceId: 3 }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...base, type: 'income', invoiceId: 3 }).success).toBe(true);
    expect(
      transactionInputSchema.safeParse({ ...base, type: 'transfer', transferTargetWalletId: 2, projectId: 1 }).success
    ).toBe(false);
  });
});
