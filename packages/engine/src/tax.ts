/**
 * Income tax. What-If ships no tax tables: the user either gives one effective
 * rate, or defines a progressive schedule (e.g. copied from an official source).
 */
import type { TaxSchedule } from './types';

/** Annual tax on `annualGross` for a progressive schedule with an optional allowance. */
export function bracketTax(annualGross: number, schedule: TaxSchedule): number {
  const income = Math.max(0, annualGross - Math.max(0, schedule.allowance ?? 0));
  let tax = 0;
  let lower = 0;
  for (const b of schedule.brackets) {
    const upper = b.upTo ?? Infinity;
    if (income > lower) tax += (Math.min(income, upper) - lower) * (b.rate / 100);
    lower = upper;
    if (income <= upper) break;
  }
  const flat = Math.max(0, schedule.flatRate ?? 0) / 100;
  return tax + annualGross * flat;
}

/** Effective tax rate (fraction) at an annual gross income. */
export function effectiveRate(annualGross: number, schedule: TaxSchedule | null | undefined, flatPct: number): number {
  if (!schedule || schedule.brackets.length === 0) return flatPct / 100;
  if (annualGross <= 0) return 0;
  return bracketTax(annualGross, schedule) / annualGross;
}

/** Validates and normalises a schedule: ascending thresholds, rates 0–100, last bracket open-ended. */
export function normalizeSchedule(s: TaxSchedule | null | undefined): { schedule: TaxSchedule | null; issues: string[] } {
  if (!s || !Array.isArray(s.brackets) || s.brackets.length === 0) return { schedule: null, issues: [] };
  const issues: string[] = [];
  const brackets = s.brackets
    .filter((b) => b && Number.isFinite(b.rate))
    .map((b) => ({ upTo: b.upTo === null || b.upTo === undefined || !Number.isFinite(b.upTo) ? null : Math.max(0, b.upTo), rate: Math.min(100, Math.max(0, b.rate)) }));
  const open = brackets.filter((b) => b.upTo === null);
  const closed = brackets.filter((b) => b.upTo !== null).sort((a, b) => a.upTo! - b.upTo!);
  if (open.length > 1) issues.push('Only the last tax bracket can be open-ended; extra open brackets were ignored.');
  const ordered = [...closed, ...(open[0] ? [open[0]] : [{ upTo: null, rate: closed[closed.length - 1]?.rate ?? 0 }])];
  if (open.length === 0) issues.push('The highest tax bracket had a limit; income above it is taxed at that bracket’s rate.');
  return {
    schedule: { brackets: ordered, allowance: Math.max(0, s.allowance ?? 0), flatRate: Math.min(100, Math.max(0, s.flatRate ?? 0)) },
    issues,
  };
}
