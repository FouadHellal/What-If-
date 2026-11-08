import { describe, expect, it } from 'vitest';
import {
  EngineInputError,
  annuityPayment,
  compareScenarios,
  hashInputs,
  priorityFit,
  projectedValueAt,
  simulate,
  type ScenarioModel,
  type VariableInput,
  type VariableKey,
} from '../src';

const u = (value: number | null, extra: Partial<VariableInput> = {}): VariableInput => ({ value, source: 'user', ...extra });

function model(vars: Partial<Record<VariableKey, VariableInput>>, over: Partial<ScenarioModel> = {}): ScenarioModel {
  return {
    startDate: '2027-01',
    horizonYears: 1,
    currency: 'EUR',
    variables: {
      inflationRate: u(0),
      incomeGrowthRate: u(0),
      investmentReturn: u(0),
      ...vars,
    },
    flows: [],
    ...over,
  };
}

describe('core cash-flow arithmetic', () => {
  it('accumulates net salary minus costs exactly', () => {
    const r = simulate(
      model({
        startingCash: u(10_000),
        grossAnnualIncome: u(60_000),
        effectiveTaxRate: u(25),
        housingCostMonthly: u(1_000),
        livingCostMonthly: u(1_000),
      }),
    );
    // net salary 3 750 − 2 000 costs = 1 750 / month
    expect(r.expected.summary.finalCash).toBe(10_000 + 12 * 1_750);
    expect(r.expected.summary.finalNetWorth).toBe(31_000);
    expect(r.expected.summary.totalTaxes).toBe(15_000);
    expect(r.expected.summary.avgMonthlyNetIncomeYear1).toBe(3_750);
    expect(r.expected.summary.savingsRateYear1).toBeCloseTo((1_750 / 3_750) * 100, 1);
    expect(r.expected.months).toHaveLength(12);
    expect(r.expected.years).toHaveLength(1);
  });

  it('applies salary growth and inflation once per scenario year', () => {
    const r = simulate(
      model(
        { grossAnnualIncome: u(12_000), incomeGrowthRate: u(10), livingCostMonthly: u(100), inflationRate: u(10) },
        { horizonYears: 2 },
      ),
    );
    expect(r.expected.months[11]!.grossIncome).toBe(1_000);
    expect(r.expected.months[12]!.grossIncome).toBe(1_100);
    expect(r.expected.months[12]!.living).toBe(110);
  });

  it('compounds investments monthly to the stated annual return', () => {
    const r = simulate(model({ startingInvestments: u(1_000), investmentReturn: u(12) }));
    expect(r.expected.summary.finalInvestments).toBeCloseTo(1_120, 2);
  });

  it('only invests cash that is actually available', () => {
    const r = simulate(model({ startingCash: u(300), monthlyInvestment: u(500) }));
    expect(r.expected.months[0]!.investmentContribution).toBe(300);
    expect(r.expected.months[1]!.investmentContribution).toBe(0);
    expect(r.expected.summary.lowestCash).toBeGreaterThanOrEqual(0);
  });
it('does not invest during loss-making months unless cash covers six months of costs', () => {    const thin = simulate(model({ startingCash: u(5_000), livingCostMonthly: u(1_000), monthlyInvestment: u(500) }));    expect(thin.expected.months[0]!.investmentContribution).toBe(0);    const rich = simulate(model({ startingCash: u(20_000), livingCostMonthly: u(1_000), monthlyInvestment: u(500) }));    expect(rich.expected.months[0]!.investmentContribution).toBe(500);    const earning = simulate(model({ startingCash: u(0), grossAnnualIncome: u(36_000), livingCostMonthly: u(1_000), monthlyInvestment: u(500) }));    expect(earning.expected.months[0]!.investmentContribution).toBe(500);  });

  it('computes free time from working, commuting and time commitments', () => {
    const r = simulate(
      model(
        { grossAnnualIncome: u(1), workHoursPerWeek: u(40), commuteHoursPerWeek: u(5) },
        { flows: [{ id: 'study', kind: 'time', label: 'Evening course', amount: 10, startMonth: 0, endMonth: 6, source: 'user' }] },
      ),
    );
    expect(r.expected.months[0]!.freeHoursPerWeek).toBe(168 - 56 - 45 - 10);
    expect(r.expected.months[6]!.freeHoursPerWeek).toBe(168 - 56 - 45);
  });
});

describe('flows', () => {
  it('handles one-time and percent-of-income flows', () => {
    const r = simulate(
      model(
        { startingCash: u(5_000), grossAnnualIncome: u(24_000) },
        {
          flows: [
            { id: 'move', kind: 'one_time_expense', label: 'Relocation', amount: 3_000, startMonth: 2, source: 'user' },
            { id: 'pension', kind: 'expense', label: 'Pension', amount: 5, amountMode: 'percent_of_income', startMonth: 0, source: 'user' },
          ],
        },
      ),
    );
    expect(r.expected.months[2]!.oneTimeExpenses).toBe(3_000);
    expect(r.expected.months[0]!.otherExpenses).toBe(100);
    expect(r.expected.summary.finalCash).toBe(5_000 + 24_000 - 3_000 - 1_200);
    expect(r.milestones.some((m) => m.title === 'Relocation' && m.date === '2027-03')).toBe(true);
  });

  it('stops recurring flows at their end month (exclusive)', () => {
    const r = simulate(
      model({}, { flows: [{ id: 'tuition', kind: 'expense', label: 'Tuition', amount: 100, startMonth: 1, endMonth: 4, source: 'user' }] }),
    );
    const costs = r.expected.months.map((m) => m.otherExpenses);
    expect(costs.slice(0, 6)).toEqual([0, 100, 100, 100, 0, 0]);
  });
});

describe('property and debt', () => {
  it('uses the standard annuity formula', () => {
    expect(annuityPayment(200_000, 6, 360)).toBeCloseTo(1_199.1, 1);
    expect(annuityPayment(12_000, 0, 12)).toBe(1_000);
  });

  it('buys a property, stops rent and pays the mortgage off', () => {
    const r = simulate(
      model(
        {
          startingCash: u(100_000),
          grossAnnualIncome: u(120_000),
          housingCostMonthly: u(1_500),
          propertyPrice: u(300_000),
          propertyPurchaseMonth: u(12),
          downPaymentPct: u(20),
          purchaseCostsPct: u(5),
          mortgageRate: u(3),
          mortgageTermYears: u(5),
          propertyAppreciation: u(0),
          ownershipCostPct: u(0),
        },
        { horizonYears: 8 },
      ),
    );
    const m = r.expected.months;
    expect(m[11]!.housing).toBe(1_500);
    expect(m[12]!.housing).toBe(0);
    expect(m[12]!.oneTimeExpenses).toBe(75_000);
    expect(m[12]!.mortgageBalance).toBe(240_000);
    expect(r.expected.summary.monthlyMortgagePayment).toBeCloseTo(annuityPayment(240_000, 3, 60), 2);
    expect(m[m.length - 1]!.mortgageBalance).toBe(0);
    expect(r.milestones.some((x) => x.kind === 'mortgage_free')).toBe(true);
    expect(r.milestones.some((x) => x.kind === 'property' && x.date === '2028-01')).toBe(true);
  });

  it('repays debt with interest and reports when it is cleared', () => {
    const r = simulate(model({ startingDebt: u(1_000), debtInterestRate: u(0), debtMonthlyPayment: u(250), startingCash: u(2_000) }));
    expect(r.expected.months[3]!.debt).toBe(0);
    expect(r.expected.months[4]!.debtPayments).toBe(0);
    expect(r.milestones.find((x) => x.kind === 'debt_free')?.month).toBe(3);
  });

  it('flags debt that grows because repayments do not cover interest', () => {
    const r = simulate(model({ startingDebt: u(10_000), debtInterestRate: u(20), debtMonthlyPayment: u(50) }, { horizonYears: 3 }));
    expect(r.insights.some((i) => i.id === 'risk:debt_growth')).toBe(true);
  });
});

describe('edge cases', () => {
  it('handles zero income with a shortfall risk', () => {
    const r = simulate(model({ startingCash: u(1_000), livingCostMonthly: u(500), grossAnnualIncome: u(0) }));
    expect(r.expected.summary.firstShortfallMonth).toBe(2);
    expect(r.expected.summary.savingsRateYear1).toBeNull();
    expect(r.insights[0]!.id).toBe('risk:shortfall');
  });

  it('reports missing important assumptions instead of inventing them', () => {
    const r = simulate(model({}));
    const missing = r.warnings.filter((w) => w.code === 'missing_value').map((w) => w.key);
    expect(missing).toEqual(expect.arrayContaining(['grossAnnualIncome', 'effectiveTaxRate', 'livingCostMonthly']));
    expect(r.insights.some((i) => i.kind === 'gap')).toBe(true);
  });

  it('clamps negative expenses to zero with a warning', () => {
    const r = simulate(
      model({ livingCostMonthly: u(-500) }, { flows: [{ id: 'x', kind: 'expense', label: 'Gym', amount: -40, startMonth: 0, source: 'user' }] }),
    );
    expect(r.expected.months[0]!.living).toBe(0);
    expect(r.expected.months[0]!.otherExpenses).toBe(0);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['clamped', 'negative_flow']));
  });

  it('supports very long horizons and clamps unsupported ones', () => {
    const long = simulate(model({ grossAnnualIncome: u(50_000), livingCostMonthly: u(2_000) }, { horizonYears: 50 }));
    expect(long.expected.months).toHaveLength(600);
    expect(long.uncertainty?.netWorthBands).toHaveLength(50);
    const tooLong = simulate(model({}, { horizonYears: 120 }));
    expect(tooLong.horizonYears).toBe(50);
    expect(tooLong.warnings.some((w) => w.code === 'horizon_clamped')).toBe(true);
    const tooShort = simulate(model({}, { horizonYears: 0 }));
    expect(tooShort.horizonYears).toBe(1);
  });

  it('stays finite with extremely large values', () => {
    const r = simulate(
      model(
        { startingCash: u(1e15), grossAnnualIncome: u(1e12), incomeGrowthRate: u(500), investmentReturn: u(100), startingInvestments: u(1e12) },
        { horizonYears: 50 },
      ),
    );
    expect(Number.isFinite(r.expected.summary.finalNetWorth)).toBe(true);
    expect(r.expected.months.every((m) => Number.isFinite(m.netWorth))).toBe(true);
    expect(r.warnings.some((w) => w.key === 'startingCash' && w.code === 'clamped')).toBe(true);
    expect(r.warnings.some((w) => w.key === 'incomeGrowthRate')).toBe(true);
  });

  it('ignores non-numeric values', () => {
    const r = simulate(model({ grossAnnualIncome: u(Number.NaN), startingCash: u(Number.POSITIVE_INFINITY) }));
    expect(r.expected.summary.finalNetWorth).toBe(0);
    expect(r.warnings.some((w) => w.code === 'invalid_value')).toBe(true);
  });

  it('rejects structurally invalid models', () => {
    expect(() => simulate({ ...model({}), startDate: '2027-13' })).toThrow(EngineInputError);
    expect(() => simulate({ ...model({}), currency: 'euro' })).toThrow(EngineInputError);
    expect(() => simulate({ ...model({}), horizonYears: Number.NaN })).toThrow(EngineInputError);
  });

  it('normalises inverted ranges', () => {
    const r = simulate(model({ grossAnnualIncome: u(50_000, { low: 60_000, high: 40_000 }) }));
    expect(r.warnings.filter((w) => w.code === 'range_adjusted')).toHaveLength(2);
  });
});

describe('cases and uncertainty', () => {
  const uncertain = model(
    {
      startingCash: u(20_000),
      grossAnnualIncome: u(55_000, { low: 45_000, high: 65_000 }),
      effectiveTaxRate: u(35),
      livingCostMonthly: u(1_400, { low: 1_200, high: 1_800 }),
      housingCostMonthly: u(1_100),
      incomeStartMonth: u(3, { low: 2, high: 6 }),
      employmentProbability: u(80),
      extendedSearchMonths: u(6),
      investmentReturn: u(5, { low: 2, high: 8 }),
      monthlyInvestment: u(400),
    },
    { horizonYears: 10 },
  );

  it('orders best ≥ expected ≥ worst', () => {
    const r = simulate(uncertain);
    expect(r.cases.best.summary.finalNetWorth).toBeGreaterThan(r.cases.expected.summary.finalNetWorth);
    expect(r.cases.expected.summary.finalNetWorth).toBeGreaterThan(r.cases.worst.summary.finalNetWorth);
  });

  it('weights the salary start by employment probability', () => {
    const r = simulate(uncertain);
    expect(r.expected.summary.effectiveIncomeStart).toBe(Math.round(3 + 0.2 * 6));
    expect(r.cases.best.summary.effectiveIncomeStart).toBe(2);
    expect(r.cases.worst.summary.effectiveIncomeStart).toBe(12);
  });

  it('produces ordered percentile bands and probabilities', () => {
    const r = simulate(uncertain);
    const u2 = r.uncertainty!;
    expect(u2.hasUncertainty).toBe(true);
    expect(u2.runs).toBe(500);
    for (const b of u2.netWorthBands) {
      expect(b.p5).toBeLessThanOrEqual(b.p10);
      expect(b.p10).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
      expect(b.p90).toBeLessThanOrEqual(b.p95);
    }
    expect(u2.shortfallProbability).toBeGreaterThanOrEqual(0);
    expect(u2.shortfallProbability).toBeLessThanOrEqual(1);
    expect(u2.finalNetWorth.p50).toBeGreaterThan(r.cases.worst.summary.finalNetWorth);
    expect(u2.finalNetWorth.p50).toBeLessThan(r.cases.best.summary.finalNetWorth);
  });

  it('collapses bands when nothing is uncertain', () => {
    const r = simulate(model({ grossAnnualIncome: u(40_000), livingCostMonthly: u(1_000) }, { horizonYears: 3 }));
    expect(r.uncertainty!.hasUncertainty).toBe(false);
    expect(r.uncertainty!.finalNetWorth.p10).toBe(r.uncertainty!.finalNetWorth.p90);
    expect(r.uncertainty!.finalNetWorth.p50).toBe(r.expected.summary.finalNetWorth);
  });

  it('ranks sensitivity by swing and uses explicit ranges', () => {
    const r = simulate(uncertain);
    expect(r.sensitivity.length).toBeGreaterThan(2);
    for (let i = 1; i < r.sensitivity.length; i++) {
      expect(r.sensitivity[i - 1]!.swing).toBeGreaterThanOrEqual(r.sensitivity[i]!.swing);
    }
    const salary = r.sensitivity.find((s) => s.key === 'grossAnnualIncome')!;
    expect(salary.basis).toBe('range');
    expect(salary.lowInput).toBe(45_000);
    expect(salary.atHigh).toBeGreaterThan(salary.atLow);
  });
});

describe('determinism and reproducibility', () => {
  const m = model(
    { startingCash: u(5_000), grossAnnualIncome: u(40_000, { low: 30_000, high: 50_000 }), effectiveTaxRate: u(30), livingCostMonthly: u(1_500) },
    { horizonYears: 15 },
  );

  it('produces identical results for identical inputs', () => {
    const a = simulate(m, { seed: 42 });
    const b = simulate(structuredClone(m), { seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes only the uncertainty analysis when the seed changes', () => {
    const a = simulate(m, { seed: 1 });
    const b = simulate(m, { seed: 2 });
    expect(a.expected).toEqual(b.expected);
    expect(a.uncertainty!.finalNetWorth).not.toEqual(b.uncertainty!.finalNetWorth);
  });

  it('hashes inputs independent of key order', () => {
    const reordered: ScenarioModel = { flows: [], variables: { ...m.variables }, currency: 'EUR', horizonYears: 15, startDate: '2027-01' };
    expect(hashInputs(m)).toBe(hashInputs(reordered));
    expect(hashInputs(m)).not.toBe(hashInputs({ ...m, horizonYears: 16 }));
    expect(hashInputs(m, { seed: 1 })).not.toBe(hashInputs(m, { seed: 2 }));
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(m);
    simulate(m);
    expect(m).toEqual(copy);
  });
});

describe('comparison', () => {
  const stay = model({ startingCash: u(10_000), grossAnnualIncome: u(30_000), livingCostMonthly: u(1_500) }, { horizonYears: 5, currency: 'USD' });
  const move = model(
    { startingCash: u(9_000), grossAnnualIncome: u(80_000), effectiveTaxRate: u(35), livingCostMonthly: u(2_200), incomeStartMonth: u(4) },
    { horizonYears: 5, currency: 'EUR', flows: [{ id: 'move', kind: 'one_time_expense', label: 'Move', amount: 5_000, startMonth: 0, source: 'user' }] },
  );

  it('converts currencies and finds when an alternative overtakes the baseline', () => {
    const a = simulate(stay);
    const b = simulate(move);
    const cmp = compareScenarios(
      [
        { id: 'stay', name: 'Stay', isBaseline: true, result: a, exchangeRateToBase: 1 },
        { id: 'move', name: 'Move', isBaseline: false, result: b, exchangeRateToBase: 1.1 },
      ],
      'USD',
    );
    const mv = cmp.scenarios.find((s) => s.id === 'move')!;
    expect(mv.fxRate).toBe(1.1);
    expect(mv.metrics.finalNetWorth).toBeCloseTo(b.expected.summary.finalNetWorth * 1.1, 1);
    expect(mv.overtakesBaselineAt).not.toBeNull();
    expect(mv.deltaVsBaseline).toBeCloseTo(mv.metrics.finalNetWorth - cmp.scenarios[0]!.metrics.finalNetWorth, 1);
    expect(cmp.leaders.finalNetWorth).toBe('move');
    expect(cmp.leaders.upfrontCost).toBe('stay');
    expect(cmp.series[0]!.date).toBe('2027-01');
  });

  it('keeps scenarios isolated', () => {
    const a1 = simulate(stay);
    const before = JSON.stringify(a1);
    const changed = simulate({ ...move, variables: { ...move.variables, grossAnnualIncome: u(1_000_000) } });
    compareScenarios(
      [
        { id: 'stay', name: 'Stay', isBaseline: true, result: a1, exchangeRateToBase: 1 },
        { id: 'move', name: 'Move', isBaseline: false, result: changed, exchangeRateToBase: 1 },
      ],
      'USD',
    );
    expect(JSON.stringify(a1)).toBe(before);
    expect(JSON.stringify(simulate(stay))).toBe(before);
  });

  it('aligns scenarios with different start dates and horizons', () => {
    const later = simulate({ ...stay, startDate: '2029-01', horizonYears: 2 });
    const now = simulate(stay);
    const cmp = compareScenarios(
      [
        { id: 'a', name: 'Now', isBaseline: true, result: now, exchangeRateToBase: 1 },
        { id: 'b', name: 'Later', isBaseline: false, result: later, exchangeRateToBase: 1 },
      ],
      'USD',
    );
    expect(cmp.series[0]!.values.b).toBeNull();
    expect(cmp.series.find((p) => p.date === '2029-01')!.values.b).not.toBeNull();
  });

  it('looks up projected values for reality check-ins', () => {
    const r = simulate(stay);
    expect(projectedValueAt(r, '2027-01')).toBe(r.expected.months[0]!.netWorth);
    expect(projectedValueAt(r, '2040-01')).toBeNull();
  });

  it('scores priority fit', () => {
    expect(priorityFit({ financial: 5, time: 1 }, { financial: 5, time: 5 })).toBe(50);
    expect(priorityFit({ financial: 5 }, {})).toBe(100);
    expect(priorityFit({}, {})).toBeNull();
    expect(priorityFit({ financial: 3 }, { financial: 0 })).toBeNull();
  });
});
