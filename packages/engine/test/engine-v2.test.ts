import { describe, expect, it } from 'vitest';
import { annuityPayment, simulate, type ScenarioModel, type VariableInput, type VariableKey } from '../src';
import { bracketTax, effectiveRate } from '../src/tax';
import { cholesky, lognormalReturn, normal, normalCdf, stream } from '../src/random';
import { createRandom } from '../src/util';

const u = (value: number | null, extra: Partial<VariableInput> = {}): VariableInput => ({ value, source: 'user', ...extra });

/** A fully deterministic base: no inflation, growth, returns or volatility. */
function model(vars: Partial<Record<VariableKey, VariableInput>>, over: Partial<ScenarioModel> = {}): ScenarioModel {
  return {
    startDate: '2027-01',
    horizonYears: 2,
    currency: 'EUR',
    variables: { inflationRate: u(0), incomeGrowthRate: u(0), investmentReturn: u(0), inflationVolatility: u(0), investmentVolatility: u(0), ...vars },
    flows: [],
    ...over,
  };
}

describe('career transitions', () => {
  it('replaces the salary from a salary change and stops it during an income gap', () => {
    const r = simulate(
      model(
        { grossAnnualIncome: u(36_000) },
        {
          flows: [
            { id: 'study', kind: 'income_gap', label: 'Retraining', amount: null, startMonth: 6, endMonth: 12, source: 'user' },
            { id: 'new', kind: 'salary_change', label: 'New career', amount: 60_000, startMonth: 12, annualGrowth: 0, source: 'user' },
          ],
        },
      ),
    );
    const g = r.expected.months.map((m) => m.grossIncome);
    expect(g[5]).toBe(3_000);
    expect(g[6]).toBe(0);
    expect(g[11]).toBe(0);
    expect(g[12]).toBe(5_000);
    expect(r.milestones.some((m) => m.title === 'New career' && m.month === 12)).toBe(true);
    expect(r.warnings.some((w) => w.code === 'missing_flow_amount')).toBe(false);
  });

  it('applies salary growth to a salary change from its own start', () => {
    const r = simulate(model({ incomeGrowthRate: u(10) }, { horizonYears: 3, flows: [{ id: 'j', kind: 'salary_change', label: 'Job', amount: 12_000, startMonth: 6, source: 'user' }] }));
    expect(r.expected.months[6]!.grossIncome).toBe(1_000);
    expect(r.expected.months[18]!.grossIncome).toBe(1_100);
  });
});

describe('loans', () => {
  it('disburses the principal, repays it as an annuity and counts it as debt', () => {
    const r = simulate(model({}, { horizonYears: 3, flows: [{ id: 'l', kind: 'loan', label: 'Study loan', amount: 12_000, rate: 6, termMonths: 24, startMonth: 0, source: 'user' }] }));
    const m = r.expected.months;
    expect(m[0]!.oneTimeIncome).toBe(12_000);
    expect(m[0]!.debt).toBe(12_000);
    expect(m[1]!.debtPayments).toBeCloseTo(annuityPayment(12_000, 6, 24), 2);
    expect(m[24]!.debt).toBe(0);
    expect(m[25]!.debtPayments).toBe(0);
    // Net worth falls by exactly the interest paid.
    const totalPaid = m.reduce((a, x) => a + x.debtPayments, 0);
    expect(r.expected.summary.finalNetWorth).toBeCloseTo(12_000 - totalPaid, 0);
  });

  it('assumes a 60-month term when none is given, with a warning', () => {
    const r = simulate(model({}, { flows: [{ id: 'l', kind: 'loan', label: 'Loan', amount: 6_000, startMonth: 0, source: 'user' }] }));
    expect(r.warnings.some((w) => w.code === 'loan_term_default')).toBe(true);
  });
});

describe('tax', () => {
  const schedule = { brackets: [{ upTo: 10_000, rate: 0 }, { upTo: 40_000, rate: 20 }, { upTo: null, rate: 40 }], allowance: 0, flatRate: 0 };

  it('computes progressive tax bracket by bracket', () => {
    expect(bracketTax(5_000, schedule)).toBe(0);
    expect(bracketTax(40_000, schedule)).toBe(6_000);
    expect(bracketTax(50_000, schedule)).toBe(10_000);
    expect(bracketTax(50_000, { ...schedule, allowance: 10_000 })).toBe(6_000);
    expect(bracketTax(50_000, { ...schedule, flatRate: 10 })).toBe(15_000);
    expect(effectiveRate(50_000, schedule, 30)).toBeCloseTo(0.2);
    expect(effectiveRate(50_000, null, 30)).toBeCloseTo(0.3);
  });

  it('uses the schedule instead of the flat rate when one is given', () => {
    const r = simulate(model({ grossAnnualIncome: u(50_000), effectiveTaxRate: u(50) }, { tax: schedule }));
    expect(r.expected.months[0]!.taxes).toBeCloseTo(10_000 / 12, 2);
    expect(r.expected.summary.effectiveTaxRateYear1).toBe(20);
    expect(r.explanation[0]!.formula).toContain('tax schedule');
  });

  it('repairs malformed schedules', () => {
    const r = simulate(model({ grossAnnualIncome: u(50_000) }, { tax: { brackets: [{ upTo: 40_000, rate: 20 }, { upTo: 10_000, rate: 0 }] } }));
    expect(r.warnings.some((w) => w.code === 'tax_schedule')).toBe(true);
    // Sorted to 0 % up to 10k, 20 % up to 40k, and 20 % above (last rate continues): 8,000 a year.
    expect(r.expected.months[0]!.taxes).toBeCloseTo(8_000 / 12, 2);
  });
});

describe('living costs', () => {
  it('lets rent grow at its own rate instead of inflation', () => {
    const r = simulate(model({ housingCostMonthly: u(1_000), livingCostMonthly: u(1_000), inflationRate: u(2), housingGrowthRate: u(10) }, { horizonYears: 2 }));
    expect(r.expected.months[12]!.housing).toBe(1_100);
    expect(r.expected.months[12]!.living).toBe(1_020);
    const follows = simulate(model({ housingCostMonthly: u(1_000), inflationRate: u(2) }, { horizonYears: 2 }));
    expect(follows.expected.months[12]!.housing).toBe(1_020);
  });

  it('includes the expected cost of unexpected expenses in the deterministic case', () => {
    const r = simulate(model({ unexpectedExpenseRate: u(2), unexpectedExpenseSize: u(1_200) }));
    expect(r.expected.months[0]!.unexpectedExpenses).toBe(200);
    expect(r.explanation.some((l) => l.label === 'Expected unexpected costs' && l.value === 200)).toBe(true);
  });

  it('deducts expected income lost to job-loss risk', () => {
    const r = simulate(model({ grossAnnualIncome: u(12_000), jobLossProbability: u(10), unemploymentMonths: u(6) }));
    // 10 % chance per year × 6 of 12 months lost = 5 % expected reduction
    expect(r.expected.months[0]!.grossIncome).toBeCloseTo(950, 6);
    expect(r.insights.some((i) => i.id === 'risk:job_loss')).toBe(true);
  });

  it('uses the configured emergency-fund target', () => {
    const r = simulate(model({ startingCash: u(0), grossAnnualIncome: u(24_000), livingCostMonthly: u(1_000), emergencyFundMonths: u(3) }, { horizonYears: 3 }));
    expect(r.expected.summary.emergencyFundMonths).toBe(3);
    expect(r.expected.summary.emergencyFundReachedMonth).toBe(2);
    expect(r.milestones.find((m) => m.kind === 'emergency_fund')?.title).toBe('3-month safety buffer');
  });
});

describe('random building blocks', () => {
  it('approximates the normal CDF accurately', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 4);
  });

  it('draws standard normals with mean 0 and variance 1', () => {
    const r = createRandom(7);
    const xs = Array.from({ length: 20_000 }, () => normal(r));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeGreaterThan(0.95);
    expect(variance).toBeLessThan(1.05);
  });

  it('keeps the arithmetic mean of lognormal returns', () => {
    const r = createRandom(3);
    const xs = Array.from({ length: 40_000 }, () => lognormalReturn(normal(r), 0.05, 0.15));
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0.05, 2);
    expect(Math.min(...xs)).toBeGreaterThan(-1);
  });

  it('factors correlation matrices and rejects invalid ones', () => {
    const L = cholesky([
      [1, 0.5],
      [0.5, 1],
    ])!;
    expect(L[1]![0]).toBeCloseTo(0.5);
    expect(L[1]![1]).toBeCloseTo(Math.sqrt(0.75));
    expect(cholesky([[1, 2], [2, 1]])).toBeNull();
  });

  it('derives independent, reproducible streams', () => {
    const a1 = stream(42, 'market', 0)();
    const a2 = stream(42, 'market', 0)();
    const b = stream(42, 'params', 0)();
    const c = stream(42, 'market', 1)();
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toBe(c);
  });
});

describe('uncertainty v2', () => {
  const base = (vars: Partial<Record<VariableKey, VariableInput>> = {}) =>
    model(
      {
        startingCash: u(10_000),
        startingInvestments: u(20_000),
        grossAnnualIncome: u(50_000, { low: 40_000, high: 60_000 }),
        effectiveTaxRate: u(30),
        livingCostMonthly: u(1_800, { low: 1_500, high: 2_200 }),
        monthlyInvestment: u(300),
        investmentReturn: u(5),
        investmentVolatility: u(12),
        inflationRate: u(2.5, { low: 1.5, high: 4 }),
        inflationVolatility: u(1),
        incomeGrowthRate: u(2, { low: 0, high: 4 }),
        ...vars,
      },
      { horizonYears: 10 },
    );

  it('reports all percentiles and the methodology used', () => {
    const r = simulate(base(), { runs: 1000 });
    const f = r.uncertainty!.finalNetWorth;
    expect(f.p10).toBeLessThan(f.p25);
    expect(f.p25).toBeLessThan(f.p50);
    expect(f.p50).toBeLessThan(f.p75);
    expect(f.p75).toBeLessThan(f.p90);
    expect(r.uncertainty!.samples).toHaveLength(1000);
    const m = r.uncertainty!.methodology;
    expect(m.correlated).toBe(true);
    expect(m.correlationPairs.length).toBeGreaterThan(3);
    expect(m.rangedInputs).toEqual(expect.arrayContaining(['Gross annual salary', 'Inflation']));
  });

  it('is exactly reproducible for a seed and different for another', () => {
    const a = simulate(base(), { seed: 11, runs: 300 });
    const b = simulate(base(), { seed: 11, runs: 300 });
    const c = simulate(base(), { seed: 12, runs: 300 });
    expect(a.uncertainty!.samples).toEqual(b.uncertainty!.samples);
    expect(a.uncertainty!.samples).not.toEqual(c.uncertainty!.samples);
    expect(a.expected).toEqual(c.expected);
  });

  it('uses common random numbers: a strictly better scenario wins in every simulated future', () => {
    const worse = simulate(base(), { runs: 400 });
    const better = simulate(base({ grossAnnualIncome: u(55_000, { low: 45_000, high: 65_000 }) }), { runs: 400 });
    const wins = better.uncertainty!.samples.filter((v, i) => v > worse.uncertainty!.samples[i]!).length;
    expect(wins).toBe(400);
  });

  it('widens the outcome range with investment volatility', () => {
    const calm = simulate(base({ investmentVolatility: u(2) }), { runs: 800 });
    const wild = simulate(base({ investmentVolatility: u(25) }), { runs: 800 });
    const width = (r: typeof calm) => r.uncertainty!.finalNetWorth.p90 - r.uncertainty!.finalNetWorth.p10;
    expect(width(wild)).toBeGreaterThan(width(calm) * 1.2);
  });

  it('draws job losses and unexpected expenses that lower outcomes on average', () => {
    const safe = simulate(base(), { runs: 600 });
    const risky = simulate(base({ jobLossProbability: u(30), unemploymentMonths: u(6), unexpectedExpenseRate: u(2), unexpectedExpenseSize: u(1_500) }), { runs: 600 });
    expect(risky.uncertainty!.finalNetWorth.p50).toBeLessThan(safe.uncertainty!.finalNetWorth.p50);
    expect(risky.uncertainty!.finalNetWorth.p10).toBeLessThan(safe.uncertainty!.finalNetWorth.p10);
    expect(risky.uncertainty!.methodology.jobLossProbability).toBe(30);
  });

  it('can treat inputs as independent', () => {
    const r = simulate(base(), { runs: 200, correlations: 'none' });
    expect(r.uncertainty!.methodology.correlated).toBe(false);
    expect(r.uncertainty!.methodology.correlationPairs).toEqual([]);
  });

  it('computes goal probabilities that fall as targets rise', () => {
    const r = simulate(base(), {
      runs: 800,
      goals: [
        { id: 'easy', label: 'Easy', kind: 'net_worth_at', target: 0 },
        { id: 'hard', label: 'Hard', kind: 'net_worth_at', target: 400_000 },
        { id: 'mid', label: 'Mid by year 5', kind: 'net_worth_at', target: 80_000, month: 59 },
        { id: 'cash', label: 'Never short', kind: 'cash_floor', target: 0 },
      ],
    });
    const [easy, hard, mid, cash] = r.goals;
    expect(easy!.probability).toBeGreaterThan(0.95);
    expect(hard!.probability).toBeLessThan(easy!.probability!);
    expect(mid!.month).toBe(59);
    expect(mid!.probability).toBeGreaterThanOrEqual(0);
    expect(mid!.probability).toBeLessThanOrEqual(1);
    expect(cash!.achievedInExpected).toBe(true);
  });

  it('caps runs at 5,000 and stays fast', () => {
    const t0 = performance.now();
    const r = simulate(base(), { runs: 99_999 });
    expect(r.uncertainty!.runs).toBe(5_000);
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
});
