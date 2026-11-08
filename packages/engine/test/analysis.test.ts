import { describe, expect, it } from 'vitest';
import {
  breakEven,
  expectedNetWorthAt,
  fxParity,
  lifeQuality,
  monthNumber,
  normalizeLifeMap,
  pairwiseWin,
  prioritySensitivity,
  robustness,
  simulate,
  solveParity,
  whatWouldChangeMyMind,
  type AnalysisScenario,
  type ScenarioModel,
  type VariableInput,
  type VariableKey,
} from '../src';

const u = (value: number | null, extra: Partial<VariableInput> = {}): VariableInput => ({ value, source: 'user', ...extra });

function model(vars: Partial<Record<VariableKey, VariableInput>>, over: Partial<ScenarioModel> = {}): ScenarioModel {
  return {
    startDate: '2027-01',
    horizonYears: 5,
    currency: 'EUR',
    variables: { inflationRate: u(0), incomeGrowthRate: u(0), investmentReturn: u(0), inflationVolatility: u(0), investmentVolatility: u(0), effectiveTaxRate: u(0), ...vars },
    flows: [],
    ...over,
  };
}

function scenario(id: string, m: ScenarioModel, opts: { baseline?: boolean; fx?: number; runs?: number } = {}): AnalysisScenario {
  return { id, name: id, isBaseline: opts.baseline ?? false, model: m, result: simulate(m, { runs: opts.runs ?? 300 }), fx: opts.fx ?? 1 };
}

const stay = model({ startingCash: u(10_000), grossAnnualIncome: u(36_000), livingCostMonthly: u(2_000) });
// Move: one-off cost of 12k, salary 60k after 3 months, higher costs.
const move = model(
  { startingCash: u(10_000), grossAnnualIncome: u(60_000), livingCostMonthly: u(3_000), incomeStartMonth: u(3) },
  { flows: [{ id: 'mv', kind: 'one_time_expense', label: 'Relocation', amount: 12_000, startMonth: 0, source: 'user' }] },
);

describe('break-even', () => {
  it('finds when the alternative overtakes the baseline and its worst deficit', () => {
    const be = breakEven(scenario('move', move), scenario('stay', stay, { baseline: true }));
    // Stay saves 1,000/month. Move: −12k, then −3k/month for 3 months, then +2k/month.
    // Deficit peaks at month 2 (−12k −9k vs +3k = −24k gap); then gains 1k/month on stay.
    expect(be.maxDeficit).toBe(24_000);
    expect(be.maxDeficitAt).toBe('2027-03');
    expect(be.overtakesAt).not.toBeNull();
    expect(be.monthsToBreakEven).toBe(26);
    expect(be.monthlyGainAtEnd).toBeCloseTo(1_000, 0);
    expect(be.endAdvantage).toBeGreaterThan(0);
  });

  it('reports no break-even when the alternative never catches up', () => {
    const poor = model({ startingCash: u(10_000), grossAnnualIncome: u(30_000), livingCostMonthly: u(2_000) });
    const be = breakEven(scenario('poor', poor), scenario('stay', stay, { baseline: true }));
    expect(be.overtakesAt).toBeNull();
    expect(be.monthsToBreakEven).toBeNull();
  });
});

describe('threshold solver', () => {
  it('solves the salary at which two scenarios end level', () => {
    const s = scenario('move', move);
    const b = scenario('stay', stay);
    const t = solveParity(s, b, 'grossAnnualIncome')!;
    expect(t).not.toBeNull();
    expect(t.direction).toBe('higher_is_better');
    expect(t.parity).toBeLessThan(60_000);
    // Verify the solution: the two end level at the parity salary.
    const end = monthNumber('2027-01') + 59;
    const atParity = expectedNetWorthAt({ ...move, variables: { ...move.variables, grossAnnualIncome: u(t.parity) } }, end)!;
    expect(atParity).toBeCloseTo(expectedNetWorthAt(stay, end)!, -1);
  });

  it('solves a maximum rent and works on flows', () => {
    const t = solveParity(scenario('move', move), scenario('stay', stay), 'livingCostMonthly')!;
    expect(t.direction).toBe('lower_is_better');
    expect(t.parity).toBeGreaterThan(3_000);
    const f = solveParity(scenario('move', move), scenario('stay', stay), 'flow:mv')!;
    expect(f.label).toBe('Relocation');
    expect(f.parity).toBeGreaterThan(12_000);
  });

  it('returns null when no crossing exists nearby', () => {
    const rich = model({ startingCash: u(1_000_000), grossAnnualIncome: u(36_000), livingCostMonthly: u(2_000) });
    expect(solveParity(scenario('rich', rich), scenario('stay', stay), 'inflationRate')).toBeNull();
  });

  it('computes the exchange rate that would make scenarios equal', () => {
    const local = model({ startingCash: u(100_000), grossAnnualIncome: u(36_000), livingCostMonthly: u(2_000) }, { currency: 'CAD' });
    const fx = fxParity(scenario('ca', local, { fx: 0.7 }), scenario('stay', stay))!;
    expect(fx.current).toBe(0.7);
    expect(fx.rate).toBeGreaterThan(0);
  });
});

describe('what would change my mind', () => {
  it('lists thresholds that flip the leader, closest first', () => {
    const r = whatWouldChangeMyMind([scenario('move', move), scenario('stay', stay, { baseline: true })]);
    expect(r.leaderId).toBe('move');
    expect(r.changers.length).toBeGreaterThan(0);
    for (let i = 1; i < r.changers.length; i++) expect(r.changers[i]!.distance).toBeGreaterThanOrEqual(r.changers[i - 1]!.distance);
    const salary = r.changers.find((c) => c.scenarioId === 'move' && c.input === 'grossAnnualIncome');
    expect(salary?.side).toBe('below');
    expect(salary!.threshold).toBeLessThan(60_000);
  });
});

describe('robustness', () => {
  const uncertain = (salary: number, low: number, high: number) =>
    model({ startingCash: u(10_000), grossAnnualIncome: u(salary, { low, high }), livingCostMonthly: u(2_000), inflationVolatility: u(1) });

  it('compares scenarios future by future and labels them', () => {
    const steady = scenario('steady', uncertain(40_000, 38_000, 42_000));
    const gamble = scenario('gamble', uncertain(42_000, 20_000, 70_000));
    const r = robustness([steady, gamble]);
    expect(r.comparable).toBe(true);
    expect(r.runs).toBe(300);
    const s = r.scenarios.find((x) => x.id === 'steady')!;
    const g = r.scenarios.find((x) => x.id === 'gamble')!;
    expect(s.winProbability + g.winProbability).toBeCloseTo(1, 5);
    expect(g.labels).toContain('highest_upside');
    expect(s.labels).toContain('lowest_downside');
    expect(s.p10).toBeGreaterThan(g.p10);
    expect(g.regretP90).toBeGreaterThan(0);
    expect(pairwiseWin(steady, gamble)).toBeCloseTo(s.winProbability, 5);
  });

  it('refuses pairwise analysis when runs are not comparable', () => {
    const a = scenario('a', uncertain(40_000, 38_000, 42_000), { runs: 200 });
    const b = scenario('b', uncertain(40_000, 38_000, 42_000), { runs: 300 });
    const r = robustness([a, b]);
    expect(r.comparable).toBe(false);
    expect(r.reason).toMatch(/different settings/);
    expect(pairwiseWin(a, b)).toBeNull();
  });
});

describe('life quality', () => {
  it('weights ratings, excludes unrated dimensions and explains contributions', () => {
    const q = lifeQuality({ career: 5, family: 1 }, { career: 4, family: 4, time: 5 });
    expect(q.score).toBe(50);
    const career = q.contributions.find((c) => c.key === 'career')!;
    expect(career.points).toBe(50);
    expect(career.weightShare).toBe(0.5);
    expect(q.contributions.find((c) => c.key === 'time')!.rating).toBeNull();
    expect(lifeQuality({}, {}).score).toBeNull();
  });

  it('maps v1 factor names onto v2 dimensions', () => {
    expect(normalizeLifeMap({ financial: 4, relationships: 2, bogus: 3 })).toEqual({ stability: 4, family: 2 });
  });

  it('finds the smallest change of priorities that changes the leader', () => {
    const items = [
      { id: 'abroad', scores: { career: 5, family: 1, growth: 5 } },
      { id: 'home', scores: { career: 3, family: 5, growth: 2 } },
    ];
    const r = prioritySensitivity(items, { career: 3, family: 3, growth: 3 });
    expect(r.leaderId).toBe('abroad');
    const fam = r.flips.find((f) => f.dimension === 'family');
    expect(fam?.newLeaderId).toBe('home');
    expect(fam!.weight).toBeGreaterThan(3);
  });
});
