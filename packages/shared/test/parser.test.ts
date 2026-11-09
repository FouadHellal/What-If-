import { simulate } from '@whatif/engine';
import { describe, expect, it } from 'vitest';
import {
  classify,
  createDecisionSchema,
  draftFromQuestion,
  draftFromTemplate,
  exampleDecision,
  findPlaces,
  normalizeQuestion,
  parseAmounts,
  parseDurationMonths,
  parseQuestion,
  scenarioModelSchema,
  CATEGORIES,
} from '../src';

describe('question parsing', () => {
  it('understands a relocation question with a role', () => {
    const p = parseQuestion('What if I move from Algeria to Germany and work as a network engineer?');
    expect(p.category).toBe('relocation');
    expect(p.entities.from).toBe('Algeria');
    expect(p.entities.destinations).toEqual([{ label: 'Germany', currency: 'EUR' }]);
    expect(p.entities.role).toBe('network engineer');
  });

  it('detects several destinations and a delayed move', () => {
    const p = parseQuestion('Should I move to Germany or Canada, or stay for two years and then relocate?');
    expect(p.category).toBe('relocation');
    expect(p.entities.destinations?.map((d) => d.label)).toEqual(['Germany', 'Canada']);
    expect(p.entities.delayMonths).toBe(24);
  });

  it('classifies the canonical example decisions', () => {
    const cases: [string, string][] = [
      ['What if I leave my current job?', 'job_change'],
      ['What if I start my own business?', 'business'],
      ['What if I buy a house instead of renting?', 'housing'],
      ['What if I invest €500 every month?', 'investing'],
      ['What if I spend one year learning a new skill?', 'education'],
      ['What if I relocate from Lyon to Paris?', 'city_move'],
      ['What if I take a year off?', 'sabbatical'],
      ['What if I change my career?', 'career_change'],
      ['What if we start a family?', 'family'],
      ['What if I accept the job offer at 65k?', 'job_offer'],
      ['What if I pay off my student loan faster?', 'debt_payoff'],
      ['What if I buy a new car?', 'major_purchase'],
      ['What if I work a four-day week?', 'working_hours'],
      ['What if I get my CCNP certification?', 'certification'],
      ['What if I do a degree or self-study?', 'study_path'],
      ['What if I paint the fence?', 'other'],
    ];
    for (const [q, cat] of cases) expect(classify(q).category, q).toBe(cat);
  });

  it('extracts amounts with currencies and periods', () => {
    expect(parseAmounts('invest €500 every month')[0]).toMatchObject({ value: 500, currency: 'EUR' });
    expect(parseAmounts('a salary of 60k EUR per year')[0]).toMatchObject({ value: 60_000, currency: 'EUR', period: 'year' });
    expect(parseAmounts('rent is 1,200 $/month')[0]).toMatchObject({ value: 1_200, currency: 'USD', period: 'month' });
    expect(parseAmounts('move in 2027')).toHaveLength(0);
    expect(parseAmounts('for 18 months')).toHaveLength(0);
  });

  it('extracts durations', () => {
    expect(parseDurationMonths('spend one year learning')).toBe(12);
    expect(parseDurationMonths('take 6 months off')).toBe(6);
    expect(parseDurationMonths('a gap year')).toBe(12);
  });

  it('finds cities and maps them to countries', () => {
    const places = findPlaces('Berlin or Toronto?');
    expect(places.map((p) => [p.label, p.country, p.currency])).toEqual([
      ['Berlin', 'Germany', 'EUR'],
      ['Toronto', 'Canada', 'CAD'],
    ]);
    expect(findPlaces('What if I join a startup in the US?')[0]?.country).toBe('United States');
    expect(findPlaces('Let us think about this')).toHaveLength(0);
  });

  it('normalises questions', () => {
    expect(normalizeQuestion('move to Spain')).toBe('What if move to Spain?');
    expect(normalizeQuestion('what if I quit')).toBe('What if I quit?');
  });
});

describe('drafts', () => {
  const baseline = { currency: 'DZD', country: 'Algeria', savings: 1_000_000, annualIncome: 1_500_000, effectiveTaxRate: 25, monthlyHousingCost: 30_000, monthlyLivingCost: 60_000 };

  it('builds a valid draft from a question, using the baseline and never inventing salaries', () => {
    const d = draftFromQuestion('What if I move from Algeria to Germany and work as a network engineer?', { baseline, startDate: '2027-01' });
    expect(d.scenarios).toHaveLength(2);
    const [stay, move] = d.scenarios;
    expect(stay!.isBaseline).toBe(true);
    expect(stay!.currency).toBe('DZD');
    expect(stay!.variables.grossAnnualIncome).toMatchObject({ value: 1_500_000, source: 'user' });
    expect(move!.currency).toBe('EUR');
    expect(move!.exchangeRateToBase).toBeNull();
    expect(move!.variables.grossAnnualIncome?.value).toBeNull();
    expect(move!.variables.incomeStartMonth?.source).toBe('system');
    expect(d.missing.find((m) => m.scenario === move!.name)?.items).toEqual(expect.arrayContaining(['grossAnnualIncome', 'exchangeRate']));
    const parsed = createDecisionSchema.safeParse({ ...d, title: d.title, origin: 'parser' });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('extracts amounts mentioned in the question into the right variable', () => {
    const d = draftFromQuestion('What if I invest 500 EUR per month?', { startDate: '2027-01' });
    expect(d.category).toBe('investing');
    expect(d.scenarios[1]!.variables.monthlyInvestment?.value).toBe(500);
    const h = draftFromQuestion('What if I buy a house for 350,000 instead of renting?', { startDate: '2027-01' });
    expect(h.scenarios[1]!.variables.propertyPrice?.value).toBe(350_000);
  });

  it('produces a valid draft and a runnable simulation for every template', () => {
    for (const c of CATEGORIES) {
      const d = draftFromTemplate(c.id, { startDate: '2027-01', baseCurrency: 'EUR' });
      const parsed = createDecisionSchema.safeParse({ ...d, title: d.title.length >= 3 ? d.title : 'A decision', origin: 'template' });
      expect(parsed.success, `${c.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      for (const s of d.scenarios) {
        const r = simulate({ ...s, exchangeRateToBase: s.exchangeRateToBase ?? 1 });
        expect(Number.isFinite(r.expected.summary.finalNetWorth)).toBe(true);
      }
    }
  });
});

describe('example decision', () => {
  it('is valid, clearly labelled, and simulates', () => {
    const ex = exampleDecision('2027-01');
    expect(createDecisionSchema.safeParse(ex).success).toBe(true);
    for (const s of ex.scenarios) {
      expect(scenarioModelSchema.safeParse(s).success).toBe(true);
      expect(Object.values(s.variables).every((v) => v?.source === 'system' && v.note)).toBe(true);
      const r = simulate({ ...s, exchangeRateToBase: s.exchangeRateToBase ?? 1 });
      expect(r.warnings.filter((w) => w.code === 'missing_value').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('validation', () => {
  it('rejects negative flow amounts and inverted flow periods', () => {
    const base = { startDate: '2027-01', horizonYears: 5, currency: 'EUR', exchangeRateToBase: 1, variables: {}, flows: [] as unknown[] };
    expect(scenarioModelSchema.safeParse({ ...base, flows: [{ id: 'a', kind: 'expense', label: 'x', amount: -5, startMonth: 0, source: 'user' }] }).success).toBe(false);
    expect(scenarioModelSchema.safeParse({ ...base, flows: [{ id: 'a', kind: 'expense', label: 'x', amount: 5, startMonth: 10, endMonth: 4, source: 'user' }] }).success).toBe(false);
    expect(scenarioModelSchema.safeParse({ ...base, horizonYears: 51 }).success).toBe(false);
    expect(scenarioModelSchema.safeParse({ ...base, currency: 'eur' }).success).toBe(false);
    expect(scenarioModelSchema.safeParse({ ...base, variables: { grossAnnualIncome: { value: 1e13, source: 'user' } } }).success).toBe(false);
    expect(scenarioModelSchema.safeParse({ ...base, variables: { notAVariable: { value: 1, source: 'user' } } }).success).toBe(false);
  });
});

describe('duration vs delay', () => {
  it('does not treat a waiting period as the duration', () => {
    const p = parseQuestion('What if I stay for two years and then move to Spain?');
    expect(p.entities.delayMonths).toBe(24);
    expect(p.entities.durationMonths).toBeUndefined();
    expect(parseQuestion('What if I take a break for 6 months?').entities.durationMonths).toBe(6);
  });
});
