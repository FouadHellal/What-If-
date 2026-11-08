import { LIFE_DIMENSIONS, lifeQuality, type LifeKey } from './analysis';
import type { CaseName, SimulationResult } from './types';
import { addMonths, monthNumber, monthNumberToDate, round2 } from './util';

/** Life-quality dimensions a person can weigh, scored 1–5 per scenario (v2: ten dimensions). */
export const PRIORITY_FACTORS = LIFE_DIMENSIONS;

export type PriorityKey = LifeKey;
export type PriorityWeights = Partial<Record<string, number>>;
export type ScenarioScores = Partial<Record<string, number>>;

/**
 * Weighted fit of a scenario against personal priorities (0–100).
 * score_k ∈ [1,5], weight_k ∈ [0,5] (default 3). Unscored dimensions are excluded,
 * v1 factor names are mapped onto v2 dimensions. Null when nothing is scored.
 */
export function priorityFit(scores: ScenarioScores, weights: PriorityWeights): number | null {
  return lifeQuality(scores, weights).score;
}

export interface ComparableScenario {
  id: string;
  name: string;
  isBaseline: boolean;
  result: SimulationResult;
  /** Units of base currency per one unit of the scenario's currency. */
  exchangeRateToBase: number;
  scores?: ScenarioScores;
}

export interface ComparedScenario {
  id: string;
  name: string;
  isBaseline: boolean;
  currency: string;
  fxRate: number;
  metrics: ComparisonMetrics;
  /** Month (absolute YYYY-MM) from which this scenario stays ahead of the baseline. */
  overtakesBaselineAt: string | null;
  /** Difference in final net worth vs. baseline, in base currency. */
  deltaVsBaseline: number | null;
  fit: number | null;
}

export interface ComparisonMetrics {
  finalNetWorth: number;
  finalRealNetWorth: number;
  bestFinalNetWorth: number;
  worstFinalNetWorth: number;
  p10FinalNetWorth: number | null;
  p90FinalNetWorth: number | null;
  upfrontCost: number;
  avgMonthlyNetIncomeYear1: number;
  avgMonthlyExpensesYear1: number;
  avgMonthlyNetCashFlowYear1: number;
  totalNetIncome: number;
  totalExpenses: number;
  lowestCash: number;
  shortfallProbability: number | null;
  avgFreeHoursPerWeek: number;
  horizonYears: number;
  riskCount: number;
  opportunityCount: number;
}

export interface MetricDefinition {
  key: keyof ComparisonMetrics;
  label: string;
  unit: 'currency' | 'currency_month' | 'percent' | 'hours_week' | 'years' | 'count';
  better: 'higher' | 'lower' | 'none';
  group: 'outcome' | 'cashflow' | 'risk' | 'life';
}

export const COMPARISON_METRICS: MetricDefinition[] = [
  { key: 'finalNetWorth', label: 'Net worth at horizon', unit: 'currency', better: 'higher', group: 'outcome' },
  { key: 'finalRealNetWorth', label: 'In today’s money', unit: 'currency', better: 'higher', group: 'outcome' },
  { key: 'worstFinalNetWorth', label: 'Worst case', unit: 'currency', better: 'higher', group: 'outcome' },
  { key: 'bestFinalNetWorth', label: 'Best case', unit: 'currency', better: 'higher', group: 'outcome' },
  { key: 'upfrontCost', label: 'Upfront cost (year 1)', unit: 'currency', better: 'lower', group: 'cashflow' },
  { key: 'avgMonthlyNetIncomeYear1', label: 'Monthly net income (year 1)', unit: 'currency_month', better: 'higher', group: 'cashflow' },
  { key: 'avgMonthlyExpensesYear1', label: 'Monthly costs (year 1)', unit: 'currency_month', better: 'lower', group: 'cashflow' },
  { key: 'avgMonthlyNetCashFlowYear1', label: 'Monthly surplus (year 1)', unit: 'currency_month', better: 'higher', group: 'cashflow' },
  { key: 'totalNetIncome', label: 'Total net income', unit: 'currency', better: 'higher', group: 'cashflow' },
  { key: 'lowestCash', label: 'Lowest cash balance', unit: 'currency', better: 'higher', group: 'risk' },
  { key: 'shortfallProbability', label: 'Chance of a cash shortfall', unit: 'percent', better: 'lower', group: 'risk' },
  { key: 'riskCount', label: 'Flagged risks', unit: 'count', better: 'lower', group: 'risk' },
  { key: 'avgFreeHoursPerWeek', label: 'Free hours per week', unit: 'hours_week', better: 'higher', group: 'life' },
];

export interface AlignedSeriesPoint {
  date: string;
  values: Record<string, number | null>;
}

export interface Comparison {
  baseCurrency: string;
  scenarios: ComparedScenario[];
  /** Yearly net worth for each scenario, aligned on calendar month and converted to base currency. */
  series: AlignedSeriesPoint[];
  /** Per metric, the id of the scenario with the most favourable value (ties → null). */
  leaders: Partial<Record<keyof ComparisonMetrics, string | null>>;
}

export type SeriesField = 'netWorth' | 'realNetWorth' | 'cash' | 'netIncome' | 'totalExpenses' | 'freeHoursPerWeek';

/**
 * Compares scenarios in a common base currency. Inputs are not mutated, and each
 * scenario's numbers come only from its own result — scenarios never influence each other.
 */
export function compareScenarios(
  items: ComparableScenario[],
  baseCurrency: string,
  weights: PriorityWeights = {},
  options: { field?: SeriesField; caseName?: CaseName } = {},
): Comparison {
  const field = options.field ?? 'netWorth';
  const baseline = items.find((i) => i.isBaseline) ?? null;

  const scenarios: ComparedScenario[] = items.map((item) => {
    const fx = item.result.currency === baseCurrency ? 1 : item.exchangeRateToBase > 0 ? item.exchangeRateToBase : 1;
    const r = item.result;
    const s = r.expected.summary;
    const c = (n: number) => round2(n * fx);
    const metrics: ComparisonMetrics = {
      finalNetWorth: c(s.finalNetWorth),
      finalRealNetWorth: c(s.finalRealNetWorth),
      bestFinalNetWorth: c(r.cases.best.summary.finalNetWorth),
      worstFinalNetWorth: c(r.cases.worst.summary.finalNetWorth),
      p10FinalNetWorth: r.uncertainty?.hasUncertainty ? c(r.uncertainty.finalNetWorth.p10) : null,
      p90FinalNetWorth: r.uncertainty?.hasUncertainty ? c(r.uncertainty.finalNetWorth.p90) : null,
      upfrontCost: c(s.upfrontCost),
      avgMonthlyNetIncomeYear1: c(s.avgMonthlyNetIncomeYear1),
      avgMonthlyExpensesYear1: c(s.avgMonthlyExpensesYear1),
      avgMonthlyNetCashFlowYear1: c(s.avgMonthlyNetCashFlowYear1),
      totalNetIncome: c(s.totalNetIncome),
      totalExpenses: c(s.totalExpenses),
      lowestCash: c(s.lowestCash),
      shortfallProbability: r.uncertainty ? r.uncertainty.shortfallProbability : null,
      avgFreeHoursPerWeek: s.avgFreeHoursPerWeek,
      horizonYears: r.horizonYears,
      riskCount: r.insights.filter((i) => i.kind === 'risk').length,
      opportunityCount: r.insights.filter((i) => i.kind === 'opportunity').length,
    };
    return {
      id: item.id,
      name: item.name,
      isBaseline: item.isBaseline,
      currency: r.currency,
      fxRate: fx,
      metrics,
      overtakesBaselineAt: null,
      deltaVsBaseline: null,
      fit: item.scores ? priorityFit(item.scores, weights) : null,
    };
  });

  // Monthly alignment on absolute month numbers.
  const monthly = new Map<string, Map<number, number>>();
  let minM = Infinity;
  let maxM = -Infinity;
  for (const item of items) {
    const fx = scenarios.find((s) => s.id === item.id)!.fxRate;
    const start = monthNumber(item.result.startDate);
    const m = new Map<number, number>();
    for (const pt of item.result.expected.months) {
      const abs = start + pt.t;
      m.set(abs, pt[field] * (field === 'freeHoursPerWeek' ? 1 : fx));
      minM = Math.min(minM, abs);
      maxM = Math.max(maxM, abs);
    }
    monthly.set(item.id, m);
  }

  if (baseline) {
    const b = monthly.get(baseline.id)!;
    const bNW = new Map<number, number>();
    const bStart = monthNumber(baseline.result.startDate);
    for (const pt of baseline.result.expected.months) bNW.set(bStart + pt.t, pt.netWorth * scenarios.find((s) => s.id === baseline.id)!.fxRate);
    void b;
    for (const sc of scenarios) {
      if (sc.id === baseline.id) continue;
      const item = items.find((i) => i.id === sc.id)!;
      const start = monthNumber(item.result.startDate);
      let lastBehind: number | null = null;
      let firstCommon: number | null = null;
      let lastCommon: number | null = null;
      for (const pt of item.result.expected.months) {
        const abs = start + pt.t;
        const bv = bNW.get(abs);
        if (bv === undefined) continue;
        if (firstCommon === null) firstCommon = abs;
        lastCommon = abs;
        if (pt.netWorth * sc.fxRate < bv) lastBehind = abs;
      }
      if (firstCommon !== null && lastCommon !== null) {
        if (lastBehind === null) sc.overtakesBaselineAt = monthNumberToDate(firstCommon);
        else if (lastBehind < lastCommon) sc.overtakesBaselineAt = monthNumberToDate(lastBehind + 1);
      }
      const bs = scenarios.find((s) => s.id === baseline.id)!;
      sc.deltaVsBaseline = round2(sc.metrics.finalNetWorth - bs.metrics.finalNetWorth);
    }
  }

  // Yearly series sampled every 12 months from the earliest start (plus the start point).
  const series: AlignedSeriesPoint[] = [];
  if (Number.isFinite(minM)) {
    for (let abs = minM; abs <= maxM; abs += 12) {
      const point: AlignedSeriesPoint = { date: monthNumberToDate(abs), values: {} };
      for (const item of items) point.values[item.id] = round2Nullable(monthly.get(item.id)!.get(abs));
      series.push(point);
    }
    const lastSampled = minM + Math.floor((maxM - minM) / 12) * 12;
    if (lastSampled !== maxM) {
      const point: AlignedSeriesPoint = { date: monthNumberToDate(maxM), values: {} };
      for (const item of items) point.values[item.id] = round2Nullable(monthly.get(item.id)!.get(maxM));
      series.push(point);
    }
  }

  const leaders: Comparison['leaders'] = {};
  if (scenarios.length > 1) {
    for (const def of COMPARISON_METRICS) {
      if (def.better === 'none') continue;
      let bestId: string | null = null;
      let bestVal: number | null = null;
      let tie = false;
      for (const s of scenarios) {
        const val = s.metrics[def.key];
        if (val === null || val === undefined) continue;
        if (bestVal === null || (def.better === 'higher' ? val > bestVal : val < bestVal)) {
          bestVal = val;
          bestId = s.id;
          tie = false;
        } else if (val === bestVal) tie = true;
      }
      leaders[def.key] = tie ? null : bestId;
    }
  }

  return { baseCurrency, scenarios, series, leaders };
}

function round2Nullable(n: number | undefined): number | null {
  return n === undefined ? null : round2(n);
}

/** Projected value of a field at a calendar month, used to compare plans against reality. */
export function projectedValueAt(result: SimulationResult, date: string, field: SeriesField = 'netWorth'): number | null {
  const offset = monthNumber(date) - monthNumber(result.startDate);
  const pt = result.expected.months[offset];
  if (!pt) return null;
  return pt[field];
}

export { addMonths };
