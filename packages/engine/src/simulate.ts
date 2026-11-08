import { VARIABLES, getVariableDefinition } from './catalog';
import { flowPolarity, normalizeModel, resolveCase, type NormalizedModel } from './normalize';
import { project, type ProjectionContext } from './project';
import type {
  CaseName,
  CaseResult,
  GoalResult,
  GoalSpec,
  DerivedMilestone,
  ExplanationLine,
  Insight,
  Percentiles,
  Projection,
  ResolvedParams,
  ScenarioModel,
  SensitivityItem,
  SimulationOptions,
  SimulationResult,
  UncertaintyResult,
  VariableKey,
} from './types';
import { cholesky, lognormalReturn, normal, normalCdf, stream } from './random';
import {
  addMonths,
  annuityPayment,
  formatMoney,
  formatMonthLabel,
  hashString,
  percentileSorted,
  round2,
  sampleTriangular,
  stableStringify,
} from './util';

export const ENGINE_VERSION = '2.0.0';
export const MAX_RUNS = 5000;
export const DEFAULT_RUNS = 500;
export const DEFAULT_SEED = 20260101;

/** Hash of everything that determines a result. Equal hash ⇒ identical result. */
export function hashInputs(model: ScenarioModel, options: SimulationOptions = {}): string {
  return hashString(
    stableStringify({
      engine: ENGINE_VERSION,
      model,
      seed: options.seed ?? DEFAULT_SEED,
      runs: options.runs ?? DEFAULT_RUNS,
      quick: options.quick ?? false,
      goals: options.goals ?? [],
      correlations: options.correlations ?? 'default',
    }),
  );
}

export function simulate(model: ScenarioModel, options: SimulationOptions = {}): SimulationResult {
  const seed = (options.seed ?? DEFAULT_SEED) >>> 0;
  const runs = Math.max(20, Math.min(MAX_RUNS, Math.round(options.runs ?? DEFAULT_RUNS)));
  const goals = (options.goals ?? []).slice(0, 10);
  const nm = normalizeModel(model);
  const ctx: ProjectionContext = { startDate: nm.startDate, horizonMonths: nm.horizonMonths };

  const expectedParams = resolveCase(nm, 'expected');
  const expected = project(expectedParams, ctx, true);
  const cases = {} as Record<CaseName, CaseResult>;
  cases.expected = toCase('expected', expected);
  cases.best = toCase('best', project(resolveCase(nm, 'best'), ctx, true));
  cases.worst = toCase('worst', project(resolveCase(nm, 'worst'), ctx, true));

  const unc = options.quick ? null : runUncertainty(nm, ctx, seed, runs, goals, options.correlations ?? 'default');
  const uncertainty: UncertaintyResult | null = unc ? unc.result : null;
  const goalResults: GoalResult[] = goals.map((g, i) => {
    const m = g.kind === 'net_worth_at' ? Math.min(nm.horizonMonths - 1, Math.max(0, Math.round(g.month ?? nm.horizonMonths - 1))) : -1;
    const achievedInExpected = g.kind === 'cash_floor' ? expected.summary.lowestCash >= g.target : (expected.months[m]?.netWorth ?? -Infinity) >= g.target;
    return {
      ...g,
      month: g.kind === 'net_worth_at' ? m : null,
      achievedInExpected,
      probability: unc && unc.result.hasUncertainty ? round2(unc.goalHits[i] ?? 0) : null,
    };
  });
  const sensitivity = options.quick ? [] : runSensitivity(nm, ctx, expectedParams, expected.summary.finalNetWorth);
  const milestones = deriveMilestones(nm, expectedParams, expected);
  const insights = deriveInsights(nm, expected, cases, uncertainty, sensitivity);
  const explanation = explain(nm, expectedParams, expected);

  return {
    engineVersion: ENGINE_VERSION,
    inputHash: hashInputs(model, options),
    currency: nm.currency,
    startDate: nm.startDate,
    horizonYears: nm.horizonYears,
    expected,
    cases,
    uncertainty,
    sensitivity,
    milestones,
    insights,
    explanation,
    warnings: nm.warnings,
    goals: goalResults,
  };
}

function toCase(name: CaseName, p: Projection): CaseResult {
  return {
    name,
    summary: p.summary,
    netWorth: p.years.map((y) => y.netWorth),
    realNetWorth: p.years.map((y) => y.realNetWorth),
    cash: p.years.map((y) => y.cash),
  };
}

// ── Uncertainty (seeded Monte Carlo) ────────────────────────────────────────

function hasRange(v: { low: number | null; high: number | null; value: number }): boolean {
  return (v.low !== null && v.low < v.value) || (v.high !== null && v.high > v.value);
}

function sample(u: number, v: { value: number; low: number | null; high: number | null }): number {
  return sampleTriangular(u, v.low ?? v.value, v.value, v.high ?? v.value);
}

function percentiles(values: number[]): Percentiles {
  const s = [...values].sort((a, b) => a - b);
  return {
    p5: round2(percentileSorted(s, 0.05)),
    p10: round2(percentileSorted(s, 0.1)),
    p25: round2(percentileSorted(s, 0.25)),
    p50: round2(percentileSorted(s, 0.5)),
    p75: round2(percentileSorted(s, 0.75)),
    p90: round2(percentileSorted(s, 0.9)),
    p95: round2(percentileSorted(s, 0.95)),
  };
}

/** Documented default correlations between uncertain inputs (Gaussian copula). */
export const DEFAULT_CORRELATIONS: { a: VariableKey; b: VariableKey; rho: number }[] = [
  { a: 'inflationRate', b: 'incomeGrowthRate', rho: 0.5 },
  { a: 'inflationRate', b: 'housingGrowthRate', rho: 0.6 },
  { a: 'inflationRate', b: 'livingCostMonthly', rho: 0.3 },
  { a: 'inflationRate', b: 'propertyAppreciation', rho: 0.4 },
  { a: 'housingCostMonthly', b: 'livingCostMonthly', rho: 0.4 },
  { a: 'grossAnnualIncome', b: 'housingCostMonthly', rho: 0.3 },
  { a: 'propertyAppreciation', b: 'housingGrowthRate', rho: 0.5 },
];

const MAX_YEARS = 50;
const SHOCK_SLOTS = 6;

interface CopulaPlan {
  /** Positions in VARIABLES of the correlated subset. */
  indexes: number[];
  L: number[][] | null;
}

function copulaPlan(mode: 'default' | 'none'): CopulaPlan {
  if (mode === 'none') return { indexes: [], L: null };
  const keys = [...new Set(DEFAULT_CORRELATIONS.flatMap((c) => [c.a, c.b]))];
  const indexes = keys.map((k) => VARIABLES.findIndex((d) => d.key === k));
  const m = keys.map((a, i) =>
    keys.map((b, j) => (i === j ? 1 : (DEFAULT_CORRELATIONS.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))?.rho ?? 0))),
  );
  return { indexes, L: cholesky(m) };
}

/** Inverse CDF of a Poisson distribution for one uniform draw (keeps draw counts fixed). */
function poissonInv(u: number, lambda: number, cap: number): number {
  if (lambda <= 0) return 0;
  let k = 0;
  let p = Math.exp(-lambda);
  let cdf = p;
  while (u > cdf && k < cap) {
    k++;
    p *= lambda / k;
    cdf += p;
  }
  return k;
}

/** Whether anything in the model is uncertain (ranges, employment, job loss, shocks, volatility). */
export function hasStochasticRisk(nm: NormalizedModel): boolean {
  const v = nm.variables;
  const investsAnything = v.startingInvestments.value > 0 || v.monthlyInvestment.value > 0;
  return (
    VARIABLES.some((d) => hasRange(nm.variables[d.key])) ||
    nm.flows.some((f) => hasRange(fr(f))) ||
    v.employmentProbability.value < 100 ||
    v.jobLossProbability.value > 0 ||
    (v.unexpectedExpenseRate.value > 0 && v.unexpectedExpenseSize.value > 0) ||
    v.inflationVolatility.value > 0 ||
    (investsAnything && v.investmentVolatility.value > 0)
  );
}

function runUncertainty(
  nm: NormalizedModel,
  ctx: ProjectionContext,
  seed: number,
  runs: number,
  goals: GoalSpec[],
  correlations: 'default' | 'none',
): { result: UncertaintyResult; goalHits: number[] } {
  const base = resolveCase(nm, 'expected');
  const years = nm.horizonYears;
  const N = nm.horizonMonths;
  const goalMonths = goals.map((g) => (g.kind === 'net_worth_at' ? Math.min(N - 1, Math.max(0, Math.round(g.month ?? N - 1))) : -1));
  const runCtx: ProjectionContext = { ...ctx, checkpoints: goalMonths };
  const plan = copulaPlan(correlations);
  const v0 = nm.variables;
  const methodology: UncertaintyResult['methodology'] = {
    runs,
    seed,
    distribution: 'triangular',
    correlated: plan.L !== null,
    correlationPairs: plan.L ? DEFAULT_CORRELATIONS : [],
    investmentVolatility: v0.investmentVolatility.value,
    inflationVolatility: v0.inflationVolatility.value,
    jobLossProbability: v0.jobLossProbability.value,
    unemploymentMonths: v0.unemploymentMonths.value,
    unexpectedExpenseRate: v0.unexpectedExpenseRate.value,
    unexpectedExpenseSize: v0.unexpectedExpenseSize.value,
    employmentProbability: v0.employmentProbability.value,
    rangedInputs: [
      ...VARIABLES.filter((d) => hasRange(nm.variables[d.key])).map((d) => d.label),
      ...nm.flows.filter((f) => hasRange(fr(f))).map((f) => f.label),
    ],
  };

  if (!hasStochasticRisk(nm)) {
    const core = project(base, runCtx, false);
    return {
      result: {
        runs: 1,
        seed,
        hasUncertainty: false,
        netWorthBands: core.yearEndNetWorth.map((x) => percentiles([x])),
        finalNetWorth: percentiles([core.finalNetWorth]),
        shortfallProbability: core.minCash < 0 ? 1 : 0,
        lossProbability: core.finalNetWorth < core.startingNetWorth ? 1 : 0,
        samples: [round2(core.finalNetWorth)],
        methodology: { ...methodology, runs: 1 },
      },
      goalHits: goals.map((g, i) => (goalMet(g, core, i) ? 1 : 0)),
    };
  }

  const perYear: number[][] = Array.from({ length: years }, () => []);
  const finals: number[] = [];
  const goalHits = goals.map(() => 0);
  let shortfalls = 0;
  let losses = 0;
  const zs = new Array<number>(VARIABLES.length);

  for (let r = 0; r < runs; r++) {
    // Parameters: one normal per catalogue variable (fixed count, so draws align across scenarios).
    const pr = stream(seed, 'params', r);
    for (let i = 0; i < VARIABLES.length; i++) zs[i] = normal(pr);
    if (plan.L) {
      const sub = plan.indexes.map((i) => zs[i]!);
      plan.indexes.forEach((idx, row) => {
        let acc = 0;
        for (let k = 0; k <= row; k++) acc += plan.L![row]![k]! * sub[k]!;
        zs[idx] = acc;
      });
    }
    const values = { ...base.values };
    VARIABLES.forEach((def, i) => {
      const v = nm.variables[def.key];
      if (hasRange(v)) values[def.key] = sample(normalCdf(zs[i]!), v);
    });

    // Markets: yearly lognormal returns and normally varying inflation around the sampled means.
    const mk = stream(seed, 'market', r);
    const returns: number[] = [];
    const inflation: number[] = [];
    for (let y = 0; y < MAX_YEARS; y++) {
      const zr = normal(mk);
      const zi = normal(mk);
      if (y < years) {
        returns.push(lognormalReturn(zr, values.investmentReturn / 100, values.investmentVolatility / 100));
        inflation.push(Math.max(-0.1, values.inflationRate / 100 + (values.inflationVolatility / 100) * zi));
      }
    }

    // Employment: whether the first job materialises, then yearly job-loss draws.
    const em = stream(seed, 'employment', r);
    const success = em() < values.employmentProbability / 100;
    const start = Math.round(values.incomeStartMonth + (success ? 0 : values.extendedSearchMonths));
    const gaps: [number, number][] = [];
    for (let y = 0; y < MAX_YEARS; y++) {
      const uLoss = em();
      const uMonth = em();
      if (y >= years) continue;
      const m = y * 12 + Math.floor(uMonth * 12);
      if (uLoss < values.jobLossProbability / 100 && m >= start) gaps.push([m, m + Math.round(values.unemploymentMonths)]);
    }

    // Unexpected expenses: Poisson count per year, exponential sizes, random months.
    const sh = stream(seed, 'shocks', r);
    const shocks = new Map<number, number>();
    for (let y = 0; y < MAX_YEARS; y++) {
      const n = poissonInv(sh(), values.unexpectedExpenseRate, SHOCK_SLOTS);
      for (let k = 0; k < SHOCK_SLOTS; k++) {
        const uM = sh();
        const uS = sh();
        if (y >= years || k >= n || values.unexpectedExpenseSize <= 0) continue;
        const m = y * 12 + Math.floor(uM * 12);
        const size = Math.min(-values.unexpectedExpenseSize * Math.log(1 - uS * 0.999999), values.unexpectedExpenseSize * 10);
        shocks.set(m, (shocks.get(m) ?? 0) + size);
      }
    }

    const fl = stream(seed, 'flows', r);
    const flows = base.flows.map((f, i) => {
      const u = fl();
      const nf = nm.flows[i]!;
      return hasRange(fr(nf)) ? { ...f, amount: sample(u, fr(nf)) } : f;
    });

    const core = project({ ...base, values, flows, effectiveIncomeStart: start, stochastic: { returns, inflation, gaps, shocks } }, runCtx, false);
    for (let y = 0; y < years; y++) perYear[y]!.push(core.yearEndNetWorth[y] ?? core.finalNetWorth);
    finals.push(round2(core.finalNetWorth));
    if (core.minCash < 0) shortfalls++;
    if (core.finalNetWorth < core.startingNetWorth) losses++;
    goals.forEach((g, i) => {
      if (goalMet(g, core, i)) goalHits[i]!++;
    });
  }

  return {
    result: {
      runs,
      seed,
      hasUncertainty: true,
      netWorthBands: perYear.map((vals) => percentiles(vals)),
      finalNetWorth: percentiles(finals),
      shortfallProbability: round2(shortfalls / runs),
      lossProbability: round2(losses / runs),
      samples: finals,
      methodology,
    },
    goalHits: goalHits.map((h) => h / runs),
  };
}

function goalMet(g: GoalSpec, core: { checkpointNetWorth: number[]; minCash: number }, i: number): boolean {
  if (g.kind === 'cash_floor') return core.minCash >= g.target;
  const nw = core.checkpointNetWorth[i];
  return nw !== undefined && !Number.isNaN(nw) && nw >= g.target;
}

// ── Sensitivity (one-at-a-time) ──────────────────────────────────────────────

function spreadFor(key: VariableKey, value: number): [number, number] | null {
  const def = getVariableDefinition(key);
  const s = def.defaultSpread;
  let lo: number;
  let hi: number;
  if (s.type === 'relative') {
    if (value === 0) return null;
    lo = value * (1 - s.amount);
    hi = value * (1 + s.amount);
  } else {
    lo = value - s.amount;
    hi = value + s.amount;
  }
  lo = Math.max(def.min, Math.min(def.max, lo));
  hi = Math.max(def.min, Math.min(def.max, hi));
  if (lo === hi) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function runSensitivity(
  nm: NormalizedModel,
  ctx: ProjectionContext,
  base: ResolvedParams,
  baseFinal: number,
): SensitivityItem[] {
  const items: SensitivityItem[] = [];
  const evalWith = (mutate: (p: ResolvedParams) => void) => {
    const p: ResolvedParams = { values: { ...base.values }, flows: base.flows.map((f) => ({ ...f })), effectiveIncomeStart: base.effectiveIncomeStart };
    mutate(p);
    return project(p, ctx, false).finalNetWorth;
  };

  for (const def of VARIABLES) {
    if (def.polarity === 'none') continue;
    const v = nm.variables[def.key];
    let lo: number;
    let hi: number;
    let basis: SensitivityItem['basis'];
    if (hasRange(v)) {
      lo = v.low ?? v.value;
      hi = v.high ?? v.value;
      basis = 'range';
    } else {
      const sp = spreadFor(def.key, v.value);
      if (!sp) continue;
      [lo, hi] = sp;
      basis = 'default';
    }
    // Property inputs only matter when a purchase happens.
    if (def.group === 'property' && def.key !== 'propertyPrice' && nm.variables.propertyPrice.value <= 0) continue;
    if (def.group === 'start' && def.key === 'debtInterestRate' && nm.variables.startingDebt.value <= 0) continue;
    const apply = (val: number) => (p: ResolvedParams) => {
      p.values[def.key] = val;
      if (def.key === 'incomeStartMonth' || def.key === 'employmentProbability' || def.key === 'extendedSearchMonths') {
        const pr = p.values.employmentProbability / 100;
        p.effectiveIncomeStart = Math.round(p.values.incomeStartMonth + (1 - pr) * p.values.extendedSearchMonths);
      }
    };
    const atLow = evalWith(apply(lo));
    const atHigh = evalWith(apply(hi));
    const swing = Math.abs(atHigh - atLow);
    if (swing < 0.5) continue;
    items.push({ key: def.key, label: def.label, lowInput: round2(lo), highInput: round2(hi), atLow: round2(atLow), atHigh: round2(atHigh), swing: round2(swing), basis });
  }

  nm.flows.forEach((f, i) => {
    if (f.kind === 'time') return;
    let lo: number;
    let hi: number;
    let basis: SensitivityItem['basis'];
    if (hasRange(fr(f))) {
      lo = f.low ?? f.amount;
      hi = f.high ?? f.amount;
      basis = 'range';
    } else {
      if (f.amount === 0) return;
      lo = f.amount * 0.9;
      hi = f.amount * 1.1;
      basis = 'default';
    }
    const apply = (val: number) => (p: ResolvedParams) => {
      p.flows[i]!.amount = val;
    };
    const atLow = evalWith(apply(lo));
    const atHigh = evalWith(apply(hi));
    const swing = Math.abs(atHigh - atLow);
    if (swing < 0.5) return;
    items.push({ key: `flow:${f.id}`, label: f.label, lowInput: round2(lo), highInput: round2(hi), atLow: round2(atLow), atHigh: round2(atHigh), swing: round2(swing), basis });
  });

  void baseFinal;
  return items.sort((a, b) => b.swing - a.swing || a.key.localeCompare(b.key)).slice(0, 12);
}

// ── Milestones ──────────────────────────────────────────────────────────────

const NET_WORTH_STEPS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];

function deriveMilestones(nm: NormalizedModel, params: ResolvedParams, p: Projection): DerivedMilestone[] {
  const out: DerivedMilestone[] = [];
  const cur = nm.currency;
  const N = nm.horizonMonths;
  const at = (month: number) => addMonths(nm.startDate, month);
  const push = (m: Omit<DerivedMilestone, 'date'>) => out.push({ ...m, date: at(m.month) });

  push({ id: 'start', kind: 'start', month: 0, title: 'Scenario begins', detail: `Starting net worth ${formatMoney(p.summary.startingNetWorth, cur)}.` });

  for (const f of nm.flows) {
    if (f.startMonth >= N) continue;
    if (f.kind === 'one_time_expense' || f.kind === 'one_time_income') {
      push({
        id: `event:${f.id}`,
        kind: 'event',
        month: f.startMonth,
        title: f.label,
        detail: `${f.kind === 'one_time_expense' ? 'One-time cost' : 'One-time income'} of ${formatMoney(f.amount, cur)}.`,
      });
    } else {
      if (f.startMonth > 0) {
        push({ id: `flow_start:${f.id}`, kind: 'flow_start', month: f.startMonth, title: `${f.label} begins`, detail: describeFlow(f, cur) });
      }
      if (f.endMonth !== null && f.endMonth < N) {
        push({ id: `flow_end:${f.id}`, kind: 'flow_end', month: f.endMonth, title: `${f.label} ends`, detail: describeFlow(f, cur) });
      }
    }
  }

  if (nm.variables.grossAnnualIncome.value > 0 && params.effectiveIncomeStart > 0 && params.effectiveIncomeStart < N) {
    push({
      id: 'income_start',
      kind: 'income_start',
      month: params.effectiveIncomeStart,
      title: 'Salary begins',
      detail: `Expected after ${params.effectiveIncomeStart} months, including job-search risk.`,
    });
  }

  const v = params.values;
  if (v.propertyPrice > 0 && v.propertyPurchaseMonth < N) {
    const pm = Math.round(v.propertyPurchaseMonth);
    push({
      id: 'property',
      kind: 'property',
      month: pm,
      title: 'Property purchase',
      detail: `Mortgage payment about ${formatMoney(p.summary.monthlyMortgagePayment ?? 0, cur)} per month.`,
    });
    const mortgageFree = p.months.findIndex((m) => m.t > pm && m.mortgageBalance === 0 && m.propertyValue > 0);
    if (mortgageFree > 0) {
      push({ id: 'mortgage_free', kind: 'mortgage_free', month: mortgageFree, title: 'Mortgage paid off', detail: 'The property is owned outright.' });
    }
  }

  if (nm.variables.startingDebt.value > 0) {
    const free = p.months.findIndex((m) => m.debt === 0);
    if (free >= 0) push({ id: 'debt_free', kind: 'debt_free', month: free, title: 'Debt cleared', detail: 'Outstanding non-mortgage debt fully repaid.' });
  }

  // Emergency fund: cash covers the target number of months of recurring costs.
  const efm = params.values.emergencyFundMonths;
  if (efm > 0) {
    const already = p.months[0] ? p.months[0].cash >= efm * recurringCost(p.months[0]) : false;
    if (!already) {
      const ef = p.months.findIndex((m) => recurringCost(m) > 0 && m.cash >= efm * recurringCost(m));
      if (ef > 0) push({ id: 'emergency_fund', kind: 'emergency_fund', month: ef, title: `${efm}-month safety buffer`, detail: `Cash covers ${efm} months of recurring costs.` });
    }
  }

  // Salary changes and income gaps
  for (const f of nm.flows) {
    if (f.startMonth >= N) continue;
    if (f.kind === 'salary_change') push({ id: `salary:${f.id}`, kind: 'income_start', month: f.startMonth, title: f.label, detail: `New gross salary ${formatMoney(f.amount, cur)} a year.` });
    if (f.kind === 'income_gap') push({ id: `gap:${f.id}`, kind: 'event', month: f.startMonth, title: f.label, detail: f.endMonth ? `No salary for ${f.endMonth - f.startMonth} months.` : 'No salary from here on.' });
    if (f.kind === 'loan') push({ id: `loan:${f.id}`, kind: 'event', month: f.startMonth, title: f.label, detail: `Loan of ${formatMoney(f.amount, cur)} at ${f.rate ?? 0} % over ${f.termMonths ?? 60} months.` });
  }

  if (p.summary.firstShortfallMonth !== null) {
    push({
      id: 'shortfall',
      kind: 'shortfall',
      month: p.summary.firstShortfallMonth,
      title: 'Cash shortfall',
      detail: `Cash falls below zero; lowest point ${formatMoney(p.summary.lowestCash, cur)} in ${formatMonthLabel(at(p.summary.lowestCashMonth))}.`,
    });
  }

  // Net worth thresholds — keep the two highest reached to avoid clutter.
  const start = p.summary.startingNetWorth;
  const crossings: DerivedMilestone[] = [];
  if (start < 0) {
    const pos = p.months.findIndex((m) => m.netWorth >= 0);
    if (pos > 0) crossings.push({ id: 'nw:0', kind: 'net_worth', month: pos, date: at(pos), title: 'Net worth turns positive', detail: 'Assets exceed debts for the first time.' });
  }
  for (const step of NET_WORTH_STEPS) {
    if (step <= start) continue;
    const idx = p.months.findIndex((m) => m.netWorth >= step);
    if (idx > 0) {
      crossings.push({ id: `nw:${step}`, kind: 'net_worth', month: idx, date: at(idx), title: `Net worth reaches ${formatMoney(step, cur)}`, detail: 'Projected under expected assumptions.' });
    }
  }
  out.push(...crossings.slice(-2));

  push({ id: 'end', kind: 'end', month: N - 1, title: 'End of horizon', detail: `Projected net worth ${formatMoney(p.summary.finalNetWorth, cur)}.` });

  return out.sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
}

function recurringCost(m: Projection['months'][number]): number {
  return m.housing + m.living + m.otherExpenses + m.propertyCosts + m.debtPayments;
}

function describeFlow(f: NormalizedModel['flows'][number], cur: string): string {
  if (f.kind === 'time') return `${f.amount} hours per week.`;
  const amt = f.amountMode === 'percent_of_income' ? `${f.amount} % of salary` : `${formatMoney(f.amount, cur)} per month`;
  return `${f.kind === 'income' ? 'Income' : 'Cost'} of ${amt}.`;
}

// ── Insights (deterministic rules) ──────────────────────────────────────────

function deriveInsights(
  nm: NormalizedModel,
  p: Projection,
  cases: Record<CaseName, CaseResult>,
  u: UncertaintyResult | null,
  sens: SensitivityItem[],
): Insight[] {
  const out: Insight[] = [];
  const cur = nm.currency;
  const s = p.summary;
  const label = (m: number) => formatMonthLabel(addMonths(nm.startDate, m));
  const v = nm.variables;

  // Assumption gaps
  for (const w of nm.warnings) {
    if (w.code === 'missing_value') {
      out.push({ id: `gap:${w.key}`, kind: 'gap', severity: w.key === 'grossAnnualIncome' || w.key === 'livingCostMonthly' ? 'medium' : 'low', title: 'Assumption needed', detail: w.message });
    }
  }

  if (s.firstShortfallMonth !== null) {
    out.push({
      id: 'risk:shortfall',
      kind: 'risk',
      severity: 'high',
      title: 'Cash runs out under expected assumptions',
      detail: `Cash drops below zero in ${label(s.firstShortfallMonth)} and reaches ${formatMoney(s.lowestCash, cur)} at its lowest. You would need savings, credit or lower costs to bridge ${s.monthsInShortfall} month${s.monthsInShortfall === 1 ? '' : 's'}.`,
    });
  } else if (cases.worst.summary.firstShortfallMonth !== null) {
    out.push({
      id: 'risk:worst_shortfall',
      kind: 'risk',
      severity: 'medium',
      title: 'Worst case leads to a cash shortfall',
      detail: `If the unfavourable ends of your ranges materialise together, cash falls below zero in ${label(cases.worst.summary.firstShortfallMonth)}.`,
    });
  }

  if (u && u.hasUncertainty && u.shortfallProbability >= 0.1 && s.firstShortfallMonth === null) {
    out.push({
      id: 'risk:shortfall_probability',
      kind: 'risk',
      severity: u.shortfallProbability >= 0.3 ? 'high' : 'medium',
      title: 'Meaningful chance of a cash shortfall',
      detail: `In ${Math.round(u.shortfallProbability * 100)} % of ${u.runs} simulated variations of your assumptions, cash dipped below zero at some point.`,
    });
  }

  if (s.avgMonthlyNetCashFlowYear1 < 0 && s.upfrontCost < Math.abs(s.avgMonthlyNetCashFlowYear1 * 12)) {
    out.push({
      id: 'risk:negative_flow',
      kind: 'risk',
      severity: 'medium',
      title: 'Spending exceeds income in the first year',
      detail: `On average you would spend ${formatMoney(Math.abs(s.avgMonthlyNetCashFlowYear1), cur)} more than you earn each month during year one.`,
    });
  }

  if (s.upfrontCost > 0 && v.startingCash.value > 0 && s.upfrontCost > v.startingCash.value * 0.5) {
    out.push({
      id: 'risk:upfront',
      kind: 'risk',
      severity: s.upfrontCost > v.startingCash.value ? 'high' : 'medium',
      title: 'Large upfront cost relative to savings',
      detail: `First-year one-time costs of ${formatMoney(s.upfrontCost, cur)} use ${Math.round((s.upfrontCost / v.startingCash.value) * 100)} % of your current cash.`,
    });
  }

  if (s.effectiveIncomeStart > 0 && s.startingRunwayMonths !== null && s.startingRunwayMonths < s.effectiveIncomeStart + 3) {
    out.push({
      id: 'risk:runway',
      kind: 'risk',
      severity: s.startingRunwayMonths < s.effectiveIncomeStart ? 'high' : 'medium',
      title: 'Thin buffer before income starts',
      detail: `Savings cover about ${s.startingRunwayMonths.toFixed(1)} months of costs, while salary is expected to begin after ${s.effectiveIncomeStart} months.`,
    });
  }

  if (v.jobLossProbability.value >= 10) {
    out.push({
      id: 'risk:job_loss',
      kind: 'risk',
      severity: v.jobLossProbability.value >= 25 ? 'high' : 'medium',
      title: 'Income could be interrupted',
      detail: `You estimate a ${v.jobLossProbability.value} % yearly chance of losing the salary, for about ${v.unemploymentMonths.value} months each time.`,
    });
  }
  if (s.emergencyFundMonths > 0 && s.emergencyFundReachedMonth === null && (p.months[0]?.cash ?? 0) < s.emergencyFundMonths * s.avgMonthlyExpensesYear1 && s.avgMonthlyExpensesYear1 > 0) {
    out.push({
      id: 'risk:no_emergency_fund',
      kind: 'risk',
      severity: 'medium',
      title: 'Emergency fund never reached',
      detail: `Cash never covers your ${s.emergencyFundMonths}-month safety target within the horizon.`,
    });
  }
  if (v.employmentProbability.value < 75) {
    out.push({
      id: 'risk:employment',
      kind: 'risk',
      severity: v.employmentProbability.value < 50 ? 'high' : 'medium',
      title: 'Income is uncertain',
      detail: `You estimate a ${v.employmentProbability.value} % chance of securing the expected salary on time.`,
    });
  }

  if (s.monthlyMortgagePayment && s.avgMonthlyNetIncomeYear1 > 0) {
    const share = s.monthlyMortgagePayment / s.avgMonthlyNetIncomeYear1;
    if (share > 0.35) {
      out.push({
        id: 'risk:mortgage_share',
        kind: 'risk',
        severity: share > 0.5 ? 'high' : 'medium',
        title: 'Mortgage takes a large share of income',
        detail: `The mortgage payment is about ${Math.round(share * 100)} % of first-year net income.`,
      });
    }
  }

  if (v.startingDebt.value > 0 && v.debtInterestRate.value > 0 && p.months[p.months.length - 1]!.debt > v.startingDebt.value) {
    out.push({ id: 'risk:debt_growth', kind: 'risk', severity: 'high', title: 'Debt grows over time', detail: 'Repayments do not cover interest, so the outstanding debt increases.' });
  }

  const top = sens[0];
  if (top && Math.abs(s.finalNetWorth) > 0 && top.swing > Math.abs(s.finalNetWorth) * 0.3) {
    out.push({
      id: `risk:sensitivity:${top.key}`,
      kind: 'risk',
      severity: 'low',
      title: `Outcome hinges on “${top.label}”`,
      detail: `Moving it between ${formatInput(top.key, top.lowInput, cur)} and ${formatInput(top.key, top.highInput, cur)} changes final net worth by ${formatMoney(top.swing, cur)}. Validate this assumption first.`,
    });
  }

  if (u && u.hasUncertainty) {
    const width = u.finalNetWorth.p90 - u.finalNetWorth.p10;
    if (Math.abs(u.finalNetWorth.p50) > 0 && width > Math.abs(u.finalNetWorth.p50)) {
      out.push({
        id: 'risk:wide_range',
        kind: 'risk',
        severity: 'low',
        title: 'Wide range of outcomes',
        detail: `The middle 80 % of simulated outcomes spans ${formatMoney(u.finalNetWorth.p10, cur)} to ${formatMoney(u.finalNetWorth.p90, cur)}.`,
      });
    }
  }

  // Opportunities
  if (s.savingsRateYear1 !== null && s.savingsRateYear1 >= 20) {
    out.push({
      id: 'opp:savings_rate',
      kind: 'opportunity',
      severity: s.savingsRateYear1 >= 35 ? 'high' : 'medium',
      title: 'Strong savings capacity',
      detail: `About ${Math.round(s.savingsRateYear1)} % of first-year net income is left after recurring costs.`,
    });
  }

  if (s.totalInvestmentGrowth > 0 && s.finalNetWorth > 0 && s.totalInvestmentGrowth > s.finalNetWorth * 0.2) {
    out.push({
      id: 'opp:compounding',
      kind: 'opportunity',
      severity: 'medium',
      title: 'Compounding does real work',
      detail: `Investment returns contribute ${formatMoney(s.totalInvestmentGrowth, cur)} over the horizon, assuming ${v.investmentReturn.value} % a year.`,
    });
  }

  const avgCashFlow = s.avgMonthlyNetCashFlowYear1;
  if (avgCashFlow > 0 && v.monthlyInvestment.value < avgCashFlow * 0.25 && s.finalCash > s.avgMonthlyExpensesYear1 * 12) {
    out.push({
      id: 'opp:idle_cash',
      kind: 'opportunity',
      severity: 'low',
      title: 'Surplus cash stays idle',
      detail: `Cash builds up to ${formatMoney(s.finalCash, cur)}. Investing part of the monthly surplus would change the long-term picture — try raising the monthly investment.`,
    });
  }

  if (cases.best.summary.finalNetWorth - s.finalNetWorth > Math.abs(s.finalNetWorth) * 0.25 && s.finalNetWorth !== 0) {
    out.push({
      id: 'opp:upside',
      kind: 'opportunity',
      severity: 'low',
      title: 'Meaningful upside',
      detail: `If favourable assumptions hold, final net worth could reach ${formatMoney(cases.best.summary.finalNetWorth, cur)}.`,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  const kindRank = { risk: 0, gap: 1, opportunity: 2 } as const;
  return out.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || rank[a.severity] - rank[b.severity]);
}

// ── Explanation trace ───────────────────────────────────────────────────────

function explain(nm: NormalizedModel, params: ResolvedParams, p: Projection): ExplanationLine[] {
  const v = params.values;
  const cur = nm.currency;
  const lines: ExplanationLine[] = [];
  const monthlyGross = v.grossAnnualIncome / 12;
  if (v.grossAnnualIncome > 0) {
    const taxPct = p.summary.effectiveTaxRateYear1;
    const bracketed = Boolean(params.tax && params.tax.brackets.length);
    lines.push({
      label: 'Net monthly salary (year 1)',
      formula: bracketed
        ? `${formatMoney(v.grossAnnualIncome, cur)} ÷ 12 × (1 − ${taxPct.toFixed(1)} % effective, from your tax schedule)`
        : `${formatMoney(v.grossAnnualIncome, cur)} ÷ 12 × (1 − ${v.effectiveTaxRate} %)`,
      value: round2(monthlyGross * (1 - (bracketed ? taxPct : v.effectiveTaxRate) / 100)),
      unit: 'currency_month',
    });
    if (v.jobLossProbability > 0) {
      lines.push({
        label: 'Expected salary after job-loss risk',
        formula: `Salary × (1 − ${v.jobLossProbability} % × ${Math.min(v.unemploymentMonths, 12)} ÷ 12 months)`,
        value: round2(Math.max(0, 1 - (v.jobLossProbability / 100) * (Math.min(v.unemploymentMonths, 12) / 12)) * 100),
        unit: 'percent',
      });
    }
    const p100 = v.employmentProbability;
    lines.push({
      label: 'Expected salary start',
      formula:
        p100 < 100
          ? `${v.incomeStartMonth} months + (1 − ${p100} %) × ${v.extendedSearchMonths} extra months`
          : `${v.incomeStartMonth} months`,
      value: params.effectiveIncomeStart,
      unit: 'months',
    });
  }
  if (v.unexpectedExpenseRate > 0 && v.unexpectedExpenseSize > 0) {
    lines.push({
      label: 'Expected unexpected costs',
      formula: `${v.unexpectedExpenseRate} a year × ${formatMoney(v.unexpectedExpenseSize, cur)} ÷ 12, inflated`,
      value: round2((v.unexpectedExpenseRate * v.unexpectedExpenseSize) / 12),
      unit: 'currency_month',
    });
  }
  lines.push({
    label: 'Recurring costs (month 1)',
    formula: 'Housing + living costs + recurring items',
    value: round2((p.months[0]?.housing ?? 0) + (p.months[0]?.living ?? 0) + (p.months[0]?.otherExpenses ?? 0)),
    unit: 'currency_month',
  });
  if (p.summary.savingsRateYear1 !== null) {
    lines.push({
      label: 'Savings rate (year 1)',
      formula: '(Net income − recurring costs) ÷ net income',
      value: p.summary.savingsRateYear1,
      unit: 'percent',
    });
  }
  if (v.propertyPrice > 0) {
    const price = v.propertyPrice;
    const loan = price * (1 - v.downPaymentPct / 100);
    lines.push({
      label: 'Cash needed to buy (today’s price)',
      formula: `${formatMoney(price, cur)} × (${v.downPaymentPct} % down + ${v.purchaseCostsPct} % costs)`,
      value: round2(price * ((v.downPaymentPct + v.purchaseCostsPct) / 100)),
      unit: 'currency',
    });
    lines.push({
      label: 'Mortgage payment',
      formula: `Annuity on ${formatMoney(loan, cur)} at ${v.mortgageRate} % over ${v.mortgageTermYears} years`,
      value: round2(p.summary.monthlyMortgagePayment ?? annuityPayment(loan, v.mortgageRate, v.mortgageTermYears * 12)),
      unit: 'currency_month',
    });
  }
  if (v.monthlyInvestment > 0 || v.startingInvestments > 0) {
    lines.push({
      label: 'Investment growth (total)',
      formula: `Monthly compounding at ${v.investmentReturn} % a year`,
      value: p.summary.totalInvestmentGrowth,
      unit: 'currency',
    });
  }
  lines.push({
    label: 'Final net worth',
    formula: 'Cash + investments + property − mortgage − debt',
    value: p.summary.finalNetWorth,
    unit: 'currency',
  });
  lines.push({
    label: 'In today’s money',
    formula: `Final net worth ÷ (1 + ${v.inflationRate} %)^${nm.horizonYears}`,
    value: p.summary.finalRealNetWorth,
    unit: 'currency',
  });
  return lines;
}

export { flowPolarity };

function fr(f: NormalizedModel['flows'][number]): { value: number; low: number | null; high: number | null } {
  return { value: f.amount, low: f.low, high: f.high };
}

/** Human-readable value of a variable or flow input, used in insight text. */
function formatInput(key: string, value: number, currency: string): string {
  if (key.startsWith('flow:')) return formatMoney(value, currency);
  const def = getVariableDefinition(key as VariableKey);
  switch (def.unit) {
    case 'currency':
    case 'currency_month':
    case 'currency_year':
      return formatMoney(value, currency);
    case 'percent':
    case 'percent_year':
      return `${Math.round(value * 10) / 10} %`;
    case 'months':
      return `${Math.round(value)} months`;
    case 'years':
      return `${Math.round(value)} years`;
    case 'hours_week':
      return `${Math.round(value)} h/week`;
    case 'per_year':
      return `${Math.round(value * 10) / 10} a year`;
  }
}
