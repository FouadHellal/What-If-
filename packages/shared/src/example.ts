import type { FlowInput, VariableInput, VariableKey } from '@whatif/engine';
import type { CreateDecisionInput } from './schemas';

/**
 * The first-run example decision. Every number is illustrative — chosen to be
 * plausible for demonstration, not researched data — and labelled as such.
 * Example decisions are stored with `is_example = true` and can be removed in one click.
 */
const NOTE = 'Illustrative example value';
const ex = (value: number | null, low?: number, high?: number, note = NOTE): VariableInput => ({
  value,
  source: 'system',
  note,
  ...(low !== undefined ? { low } : {}),
  ...(high !== undefined ? { high } : {}),
});

type Vars = Partial<Record<VariableKey, VariableInput>>;
const f = (x: Omit<FlowInput, 'source' | 'note'> & { note?: string }): FlowInput => ({ source: 'system', note: x.note ?? NOTE, ...x });

export function exampleDecision(startDate: string): CreateDecisionInput & {
  milestones: { title: string; description: string; offsetMonths: number; scenarioIndex: number | null }[];
  journal: { type: 'reasoning' | 'expectation'; title: string; body: string }[];
} {
  const stay: Vars = {
    startingCash: ex(2_500_000, undefined, undefined, 'Illustrative savings of a mid-career engineer'),
    grossAnnualIncome: ex(1_800_000, 1_650_000, 2_000_000),
    effectiveTaxRate: ex(26),
    incomeGrowthRate: ex(6, 3, 9),
    housingCostMonthly: ex(40_000, 35_000, 50_000),
    livingCostMonthly: ex(55_000, 50_000, 65_000),
    inflationRate: ex(5, 3, 8),
    monthlyInvestment: ex(10_000),
    investmentReturn: ex(7, 4, 10),
    workHoursPerWeek: ex(40),
    commuteHoursPerWeek: ex(6),
  };
  const germany: Vars = {
    startingCash: ex(17_000, undefined, undefined, 'Same savings as today, converted at the illustrative rate'),
    grossAnnualIncome: ex(56_000, 50_000, 64_000, 'Illustrative salary for a network engineer in Berlin'),
    effectiveTaxRate: ex(37, 34, 40, 'Illustrative tax and social contributions'),
    incomeGrowthRate: ex(3, 2, 4.5),
    incomeStartMonth: ex(3, 2, 6),
    employmentProbability: ex(80),
    extendedSearchMonths: ex(6),
    housingCostMonthly: ex(1_150, 950, 1_450),
    livingCostMonthly: ex(950, 850, 1_150),
    inflationRate: ex(2.5, 1.5, 4),
    monthlyInvestment: ex(500),
    investmentReturn: ex(5, 2, 8),
    workHoursPerWeek: ex(40),
    commuteHoursPerWeek: ex(4),
  };
  const canada: Vars = {
    startingCash: ex(25_400, undefined, undefined, 'Same savings as today, converted at the illustrative rate'),
    grossAnnualIncome: ex(84_000, 72_000, 95_000, 'Illustrative salary for a network engineer in Montréal'),
    effectiveTaxRate: ex(31, 28, 35),
    incomeGrowthRate: ex(3, 2, 4.5),
    incomeStartMonth: ex(4, 3, 8),
    employmentProbability: ex(75),
    extendedSearchMonths: ex(6),
    housingCostMonthly: ex(1_650, 1_400, 2_000),
    livingCostMonthly: ex(1_300, 1_150, 1_550),
    inflationRate: ex(2.5, 1.5, 4),
    monthlyInvestment: ex(600),
    investmentReturn: ex(5, 2, 8),
    workHoursPerWeek: ex(40),
    commuteHoursPerWeek: ex(5),
  };

  return {
    title: 'What if I relocate to Germany instead of staying in Algeria?',
    question: 'What if I move from Algeria to Germany and work as a network engineer?',
    description:
      'An example decision that shows how What-If works. All values are illustrative and marked as such — edit them, or remove the example from Settings → Data at any time.',
    category: 'relocation',
    baseCurrency: 'EUR',
    horizonYears: 10,
    origin: 'template',
    scenarios: [
      {
        name: 'Stay in Algiers',
        description: 'Keep my current role and keep saving locally.',
        isBaseline: true,
        startDate,
        horizonYears: 10,
        currency: 'DZD',
        exchangeRateToBase: 0.0068,
        exchangeRateSource: 'system',
        variables: stay,
        flows: [],
        scores: { financial: 3, career: 2, time: 4, relationships: 5, lifestyle: 3, growth: 2 },
        assumptions: [
          { text: 'Salary keeps pace with local inflation.', category: 'assumption', source: 'system', likelihood: null, impact: null },
          { text: 'The dinar may weaken further against the euro, shrinking savings in euro terms.', category: 'risk', source: 'system', likelihood: 'medium', impact: 'medium' },
        ],
      },
      {
        name: 'Move to Berlin',
        description: 'Relocate on an EU Blue Card and work as a network engineer.',
        isBaseline: false,
        startDate,
        horizonYears: 10,
        currency: 'EUR',
        exchangeRateToBase: 1,
        exchangeRateSource: null,
        variables: germany,
        flows: [
          f({ id: 'ex_de_move', kind: 'one_time_expense', label: 'Relocation & setup', amount: 6_500, low: 4_500, high: 9_000, startMonth: 0, note: 'Visa, flights, deposit and furniture — illustrative' }),
          f({ id: 'ex_de_lang', kind: 'expense', label: 'German classes', amount: 120, startMonth: 0, endMonth: 12, annualGrowth: 0 }),
          f({ id: 'ex_de_lang_t', kind: 'time', label: 'Language study', amount: 6, startMonth: 0, endMonth: 12 }),
          f({ id: 'ex_de_home', kind: 'one_time_expense', label: 'Visit family (yearly flights)', amount: 600, startMonth: 11 }),
        ],
        scores: { financial: 4, career: 5, time: 3, relationships: 2, lifestyle: 4, growth: 5 },
        assumptions: [
          { text: 'An employer sponsors the Blue Card within four months.', category: 'assumption', source: 'system', likelihood: null, impact: null },
          { text: 'Finding an apartment in Berlin can take months; temporary housing costs more.', category: 'risk', source: 'system', likelihood: 'high', impact: 'medium' },
          { text: 'EU work experience opens roles across the single market.', category: 'opportunity', source: 'system', likelihood: 'medium', impact: 'high' },
        ],
      },
      {
        name: 'Move to Montréal',
        description: 'Apply through Express Entry and settle in Québec.',
        isBaseline: false,
        startDate,
        horizonYears: 10,
        currency: 'CAD',
        exchangeRateToBase: 0.67,
        exchangeRateSource: 'system',
        variables: canada,
        flows: [
          f({ id: 'ex_ca_move', kind: 'one_time_expense', label: 'Relocation & setup', amount: 9_500, low: 7_000, high: 13_000, startMonth: 0, note: 'Immigration fees, flights, deposit — illustrative' }),
          f({ id: 'ex_ca_cold', kind: 'one_time_expense', label: 'Winter equipment', amount: 900, startMonth: 9 }),
        ],
        scores: { financial: 4, career: 4, time: 3, relationships: 2, lifestyle: 3, growth: 4 },
        assumptions: [
          { text: 'French language skills help with Québec immigration and work.', category: 'opportunity', source: 'system', likelihood: null, impact: null },
          { text: 'Immigration processing times vary and may exceed the plan.', category: 'risk', source: 'system', likelihood: 'medium', impact: 'high' },
        ],
      },
    ],
    milestones: [
      { title: 'Language certificate (B1)', description: 'Pass a recognised German exam.', offsetMonths: 10, scenarioIndex: 1 },
      { title: 'Permanent residence eligibility', description: 'Blue Card holders can apply after about 21–27 months.', offsetMonths: 27, scenarioIndex: 1 },
      { title: 'Revisit the decision', description: 'Compare real numbers with the plan.', offsetMonths: 12, scenarioIndex: null },
    ],
    journal: [
      {
        type: 'reasoning',
        title: 'Why I’m considering a move',
        body: 'I want broader career options and to save in a stronger currency. I’m worried about being far from family and about the first months without income.',
      },
    ],
  };
}
