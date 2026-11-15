import { describe, expect, it } from 'vitest';
import { budgetPercent, budgetStatus } from '@shared/utils/budget';
import {
  advanceDateKey,
  daysBetween,
  dueStatus,
  isValidDateKey,
  monthsUntil,
} from '@shared/utils/schedule';

describe('advanceDateKey', () => {
  it('advances weekly across month and year boundaries', () => {
    expect(advanceDateKey('2026-01-28', 'weekly')).toBe('2026-02-04');
    expect(advanceDateKey('2026-12-29', 'weekly')).toBe('2027-01-05');
  });

  it('clamps monthly dates to the end of shorter months', () => {
    expect(advanceDateKey('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceDateKey('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(advanceDateKey('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  it('clamps Feb 29 on yearly bills', () => {
    expect(advanceDateKey('2028-02-29', 'yearly')).toBe('2029-02-28');
    expect(advanceDateKey('2026-11-15', 'yearly')).toBe('2027-11-15');
  });
});

describe('due dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDateKey('2026-02-28')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('26-1-1')).toBe(false);
  });

  it('classifies due status relative to today', () => {
    expect(daysBetween('2026-11-15', '2026-11-10')).toBe(-5);
    expect(dueStatus('2026-11-10', '2026-11-15')).toBe('overdue');
    expect(dueStatus('2026-11-15', '2026-11-15')).toBe('due_today');
    expect(dueStatus('2026-11-22', '2026-11-15')).toBe('due_soon');
    expect(dueStatus('2026-11-23', '2026-11-15')).toBe('upcoming');
  });

  it('counts months left including the current month', () => {
    expect(monthsUntil('2026-11-15', '2026-11-30')).toBe(1);
    expect(monthsUntil('2026-11-15', '2027-04-01')).toBe(6);
    expect(monthsUntil('2026-11-15', '2026-01-01')).toBe(1);
  });
});

describe('budget status', () => {
  it('uses 80% warning and >100% over thresholds', () => {
    expect(budgetStatus(0, null)).toBe('none');
    expect(budgetStatus(79, 100)).toBe('ok');
    expect(budgetStatus(80, 100)).toBe('warning');
    expect(budgetStatus(100, 100)).toBe('warning');
    expect(budgetStatus(101, 100)).toBe('over');
    expect(budgetPercent(150, 100)).toBe(150);
  });
});
