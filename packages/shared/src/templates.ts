import { VARIABLES, type FlowInput, type VariableInput, type VariableKey } from '@whatif/engine';
import type { DecisionCategory, ScenarioDraft, ValueSourceT } from './schemas';

/** The user's reusable baseline, taken from their profile. Every field optional. */
export interface Baseline {
  country?: string | null;
  city?: string | null;
  currency?: string | null;
  annualIncome?: number | null;
  effectiveTaxRate?: number | null;
  monthlyHousingCost?: number | null;
  monthlyLivingCost?: number | null;
  savings?: number | null;
  investments?: number | null;
  debt?: number | null;
  monthlyDebtPayment?: number | null;
  planningHorizonYears?: number | null;
}

export interface TemplateEntities {
  from?: string | null;
  destinations?: { label: string; currency: string | null }[];
  role?: string | null;
  skill?: string | null;
  durationMonths?: number | null;
  delayMonths?: number | null;
  monthlyAmount?: number | null;
  annualSalary?: number | null;
  propertyPrice?: number | null;
  oneTimeAmount?: number | null;
  currency?: string | null;
}

export interface DraftContext {
  baseline?: Baseline | null;
  startDate: string;
  horizonYears?: number;
  baseCurrency?: string;
}

export interface CategoryInfo {
  id: DecisionCategory;
  label: string;
  description: string;
  example: string;
  icon: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'relocation', label: 'Move abroad', description: 'Compare staying with relocating to another country.', example: 'What if I move from Algeria to Germany and work as a network engineer?', icon: 'plane' },
  { id: 'job_change', label: 'Leave my job', description: 'Weigh your current role against a new one or a break.', example: 'What if I leave my current job for a better-paid role?', icon: 'briefcase' },
  { id: 'business', label: 'Start a business', description: 'Model the runway, setup costs and ramp-up of your own venture.', example: 'What if I start my own consulting business?', icon: 'store' },
  { id: 'housing', label: 'Buy or rent', description: 'Compare buying a home with continuing to rent.', example: 'What if I buy a house instead of renting?', icon: 'home' },
  { id: 'investing', label: 'Invest monthly', description: 'See what a regular investment habit could add up to.', example: 'What if I invest 500 every month?', icon: 'trending-up' },
  { id: 'education', label: 'Learn a skill', description: 'Spend time and money on training for a future uplift.', example: 'What if I spend one year learning data engineering?', icon: 'graduation-cap' },
  { id: 'city_move', label: 'Move city', description: 'Relocate within your country for work or lifestyle.', example: 'What if I relocate from Lyon to Paris?', icon: 'map-pin' },
  { id: 'sabbatical', label: 'Take time off', description: 'Plan a sabbatical and your return to work.', example: 'What if I take a year off to travel?', icon: 'sun' },
  { id: 'career_change', label: 'Change career', description: 'Retrain and switch to a different profession.', example: 'What if I change my career to become a UX designer?', icon: 'repeat' },
  { id: 'family', label: 'Start a family', description: 'Understand the costs and time of having children.', example: 'What if we start a family in the next two years?', icon: 'users' },
  { id: 'other', label: 'Something else', description: 'Start from a blank comparison of two paths.', example: 'What if I…', icon: 'sparkles' },
];

export function categoryInfo(id: DecisionCategory): CategoryInfo {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]!;
}

// ── helpers ─────────────────────────────────────────────────────────────────

let flowCounter = 0;
function fid(prefix: string): string {
  flowCounter = (flowCounter + 1) % 1_000_000;
  return `${prefix}_${flowCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function val(value: number | null, source: ValueSourceT, note?: string, low?: number | null, high?: number | null): VariableInput {
  const v: VariableInput = { value, source };
  if (note) v.note = note;
  if (low !== undefined) v.low = low;
  if (high !== undefined) v.high = high;
  return v;
}

const FROM_BASELINE = 'From your baseline profile';
const NEEDS_INPUT = 'Needs your input';

/** System assumptions every scenario starts with — always labelled as such. */
function systemDefaults(): Partial<Record<VariableKey, VariableInput>> {
  const out: Partial<Record<VariableKey, VariableInput>> = {};
  for (const def of VARIABLES) {
    if (def.hasSystemDefault && def.group !== 'property') {
      out[def.key] = val(def.fallback, 'system', 'Default assumption — adjust to your situation');
    }
  }
  out.investmentReturn = val(5, 'system', 'Long-run nominal return assumption, not a forecast', 2, 8);
  out.inflationRate = val(2.5, 'system', 'Default assumption — adjust to your situation', 1.5, 4);
  return out;
}

function propertyDefaults(): Partial<Record<VariableKey, VariableInput>> {
  const out: Partial<Record<VariableKey, VariableInput>> = {};
  for (const def of VARIABLES) {
    if (def.group === 'property' && def.hasSystemDefault) {
      out[def.key] = val(def.fallback, 'system', 'Typical value — check local rules and offers');
    }
  }
  return out;
}

/** Baseline values become user-provided variables. Missing ones stay null so the UI asks for them. */
function fromBaseline(b: Baseline | null | undefined): Partial<Record<VariableKey, VariableInput>> {
  const out: Partial<Record<VariableKey, VariableInput>> = {};
  const set = (key: VariableKey, value: number | null | undefined) => {
    out[key] = value === null || value === undefined ? val(null, 'user', NEEDS_INPUT) : val(value, 'user', FROM_BASELINE);
  };
  set('startingCash', b?.savings);
  if (b?.investments) out.startingInvestments = val(b.investments, 'user', FROM_BASELINE);
  if (b?.debt) {
    out.startingDebt = val(b.debt, 'user', FROM_BASELINE);
    if (b.monthlyDebtPayment) out.debtMonthlyPayment = val(b.monthlyDebtPayment, 'user', FROM_BASELINE);
  }
  set('grossAnnualIncome', b?.annualIncome);
  set('effectiveTaxRate', b?.effectiveTaxRate);
  set('housingCostMonthly', b?.monthlyHousingCost);
  set('livingCostMonthly', b?.monthlyLivingCost);
  return out;
}

function unknown(keys: VariableKey[]): Partial<Record<VariableKey, VariableInput>> {
  const out: Partial<Record<VariableKey, VariableInput>> = {};
  for (const k of keys) out[k] = val(null, 'user', NEEDS_INPUT);
  return out;
}

function flow(f: Omit<FlowInput, 'id' | 'source'> & { source?: ValueSourceT }): FlowInput {
  return { id: fid(f.kind), source: f.source ?? 'user', ...f };
}

type ScenarioSeed = {
  name: string;
  description: string;
  isBaseline?: boolean;
  currency?: string | null;
  variables: Partial<Record<VariableKey, VariableInput>>;
  flows?: FlowInput[];
  assumptions?: { text: string; category: 'assumption' | 'risk' | 'opportunity' | 'question'; source: ValueSourceT }[];
};

function monthsLabel(m: number): string {
  if (m % 12 === 0) return `${m / 12} year${m === 12 ? '' : 's'}`;
  return `${m} month${m === 1 ? '' : 's'}`;
}

// ── template builders ───────────────────────────────────────────────────────

function statusQuo(ctx: DraftContext, name: string, description: string): ScenarioSeed {
  return {
    name,
    description,
    isBaseline: true,
    currency: ctx.baseline?.currency ?? null,
    variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
  };
}

function relocationScenario(ctx: DraftContext, dest: { label: string; currency: string | null }, e: TemplateEntities, delay = 0): ScenarioSeed {
  const role = e.role ? ` as ${e.role}` : '';
  const salaryNote = e.annualSalary ? 'From your question' : 'Expected salary in the destination — needs your input';
  return {
    name: delay > 0 ? `Move to ${dest.label} in ${monthsLabel(delay)}` : `Move to ${dest.label}`,
    description: delay > 0
      ? `Stay for ${monthsLabel(delay)} to save and prepare, then relocate to ${dest.label}${role}.`
      : `Relocate to ${dest.label}${role}.`,
    currency: dest.currency,
    variables: {
      ...systemDefaults(),
      startingCash: fromBaseline(ctx.baseline).startingCash ?? val(null, 'user', NEEDS_INPUT),
      ...(ctx.baseline?.investments ? { startingInvestments: val(ctx.baseline.investments, 'user', FROM_BASELINE) } : {}),
      grossAnnualIncome: val(e.annualSalary ?? null, 'user', salaryNote),
      effectiveTaxRate: val(null, 'user', 'Combined tax and social contributions in the destination'),
      housingCostMonthly: val(null, 'user', 'Rent in the destination city'),
      livingCostMonthly: val(null, 'user', 'Other monthly living costs in the destination'),
      incomeStartMonth: val(delay + 3, 'system', 'Assumed job-search and visa time — adjust', delay + 1, delay + 9),
      employmentProbability: val(80, 'system', 'Assumed chance of landing a role on time — adjust'),
      extendedSearchMonths: val(6, 'system', 'Extra months without salary if the first search fails'),
    },
    flows: [
      flow({ kind: 'one_time_expense', label: 'Relocation & setup', amount: e.oneTimeAmount ?? null, startMonth: delay, note: 'Visa, flights, deposit, furniture — needs your input' }),
    ],
    assumptions: [
      { text: `A work permit or visa for ${dest.label} can be obtained in the assumed time.`, category: 'assumption', source: 'system' },
      { text: 'Exchange rates may move significantly over the horizon.', category: 'risk', source: 'system' },
    ],
  };
}

export function buildFromTemplate(category: DecisionCategory, ctx: DraftContext, e: TemplateEntities = {}): { title: string; scenarios: ScenarioSeed[] } {
  const here = e.from ?? ctx.baseline?.city ?? ctx.baseline?.country ?? null;
  const hereLabel = here ? ` in ${here}` : '';
  switch (category) {
    case 'relocation':
    case 'city_move': {
      const dests = e.destinations && e.destinations.length > 0 ? e.destinations : [{ label: category === 'city_move' ? 'the new city' : 'the new country', currency: null }];
      const scenarios: ScenarioSeed[] = [statusQuo(ctx, `Stay${hereLabel}`, 'Continue on your current path — the status quo you compare against.')];
      for (const d of dests.slice(0, 4)) {
        scenarios.push(relocationScenario(ctx, { label: d.label, currency: category === 'city_move' ? null : d.currency }, e));
      }
      if (e.delayMonths && e.delayMonths > 0 && dests[0]) {
        scenarios.push(relocationScenario(ctx, dests[0], e, e.delayMonths));
      }
      const t = dests.map((d) => d.label).join(' or ');
      return { title: `Move to ${t}?`, scenarios };
    }
    case 'job_change': {
      return {
        title: 'Leave my current job?',
        scenarios: [
          statusQuo(ctx, 'Stay in my current role', 'Keep your current job and trajectory.'),
          {
            name: e.role ? `Move to a ${e.role} role` : 'Take a new role',
            description: 'Leave for a different employer or position.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              grossAnnualIncome: val(e.annualSalary ?? null, 'user', 'Salary in the new role — needs your input'),
              incomeStartMonth: val(2, 'system', 'Assumed notice and search period — adjust', 1, 6),
              employmentProbability: val(85, 'system', 'Assumed chance of landing the role — adjust'),
            },
          },
          {
            name: 'Leave and take a break first',
            description: 'Quit, take time to reset, then look for a new role.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              incomeStartMonth: val(e.durationMonths ?? 6, 'user', 'Length of the break before working again'),
              employmentProbability: val(80, 'system', 'Assumed chance of finding work on time — adjust'),
            },
          },
        ],
      };
    }
    case 'business': {
      return {
        title: 'Start my own business?',
        scenarios: [
          statusQuo(ctx, 'Keep my job', 'Stay employed and keep your current salary.'),
          {
            name: 'Start the business',
            description: 'Leave employment and build your own venture. Profit is modelled as what you can pay yourself.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              grossAnnualIncome: val(0, 'user', 'No salary while running the business'),
            },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Business setup costs', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Equipment, legal, branding — needs your input' }),
              flow({ kind: 'income', label: 'Owner’s pay from profit (year 1)', amount: null, startMonth: 6, endMonth: 18, annualGrowth: 0, note: 'What the business can pay you once revenue starts' }),
              flow({ kind: 'income', label: 'Owner’s pay from profit (year 2+)', amount: null, startMonth: 18, annualGrowth: 10, note: 'Assumes growth after the first year — adjust' }),
              flow({ kind: 'expense', label: 'Self-employed insurance & admin', amount: null, startMonth: 0, note: 'Health insurance, accounting, pension you now pay yourself' }),
            ],
            assumptions: [
              { text: 'Most new businesses take longer than planned to reach steady profit.', category: 'risk', source: 'system' },
              { text: 'Owner’s pay is shown after business taxes.', category: 'assumption', source: 'system' },
            ],
          },
        ],
      };
    }
    case 'housing': {
      return {
        title: 'Buy a home instead of renting?',
        scenarios: [
          {
            ...statusQuo(ctx, 'Keep renting', 'Continue renting and invest what you would have put into a home.'),
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline), monthlyInvestment: val(null, 'user', 'What you would invest each month instead of paying down a mortgage') },
          },
          {
            name: 'Buy a home',
            description: 'Buy with a mortgage. Rent stops from the purchase month.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              ...propertyDefaults(),
              propertyPrice: val(e.propertyPrice ?? null, 'user', e.propertyPrice ? 'From your question' : 'Price of the home in today’s money — needs your input'),
              propertyPurchaseMonth: val(e.delayMonths ?? 0, 'user', 'When you would buy'),
            },
            assumptions: [{ text: 'Mortgage rates are fixed for the full term.', category: 'assumption', source: 'system' }],
          },
        ],
      };
    }
    case 'investing': {
      const amt = e.monthlyAmount ?? null;
      return {
        title: amt ? `Invest ${amt.toLocaleString('en-US')} every month?` : 'Invest a fixed amount every month?',
        scenarios: [
          { ...statusQuo(ctx, 'Keep saving in cash', 'Surplus stays in cash.'), variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline), monthlyInvestment: val(0, 'user') } },
          {
            name: 'Invest every month',
            description: 'Move a fixed amount into a diversified investment each month.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              monthlyInvestment: val(amt, 'user', amt ? 'From your question' : 'Monthly amount — needs your input'),
            },
            assumptions: [{ text: 'Returns are an average; real markets fluctuate and can fall for years.', category: 'risk', source: 'system' }],
          },
        ],
      };
    }
    case 'education':
    case 'career_change': {
      const months = e.durationMonths ?? 12;
      const subject = category === 'education' ? (e.skill ?? 'a new skill') : (e.role ?? 'a new career');
      const isCareer = category === 'career_change';
      return {
        title: isCareer ? `Change career to ${subject}?` : `Spend ${monthsLabel(months)} learning ${subject}?`,
        scenarios: [
          statusQuo(ctx, isCareer ? 'Stay in my current career' : 'Continue as I am', 'Keep your current path.'),
          {
            name: isCareer ? `Retrain as ${subject}` : `Learn ${subject} alongside work`,
            description: isCareer
              ? `Train for ${monthsLabel(months)} without salary, then start in the new field.`
              : `Study part-time for ${monthsLabel(months)} while keeping your job.`,
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              ...(isCareer
                ? {
                    grossAnnualIncome: val(e.annualSalary ?? null, 'user', 'Starting salary in the new career — needs your input'),
                    incomeStartMonth: val(months, 'user', 'Training time before the first job', months, months + 6),
                    employmentProbability: val(70, 'system', 'Assumed chance of landing a first role on time — adjust'),
                  }
                : {}),
            },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Course or tuition fees', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Needs your input' }),
              flow({ kind: 'time', label: 'Study time', amount: isCareer ? 30 : 10, startMonth: 0, endMonth: months, source: 'system', note: 'Assumed hours per week — adjust' }),
              ...(!isCareer
                ? [flow({ kind: 'income', label: 'Salary uplift after training', amount: null, startMonth: months, annualGrowth: 2, note: 'Extra monthly net income once the new skill pays off' })]
                : []),
            ],
          },
        ],
      };
    }
    case 'sabbatical': {
      const months = e.durationMonths ?? 12;
      return {
        title: `Take ${monthsLabel(months)} off?`,
        scenarios: [
          statusQuo(ctx, 'Keep working', 'No break; continue as you are.'),
          {
            name: `Take ${monthsLabel(months)} off`,
            description: 'Pause work, then return to a comparable role.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              incomeStartMonth: val(months, 'user', 'Length of the break'),
              employmentProbability: val(85, 'system', 'Assumed chance of returning to work on time — adjust'),
              extendedSearchMonths: val(4, 'system', 'Extra search time if returning takes longer'),
            },
            flows: [
              flow({ kind: 'expense', label: 'Travel & sabbatical budget', amount: e.monthlyAmount ?? null, startMonth: 0, endMonth: months, note: 'Monthly spend on top of living costs — needs your input' }),
            ],
            assumptions: [{ text: 'You return at a similar salary to today.', category: 'assumption', source: 'system' }],
          },
        ],
      };
    }
    case 'family': {
      const start = e.delayMonths ?? 12;
      return {
        title: 'Start a family?',
        scenarios: [
          statusQuo(ctx, 'Current plan', 'No change to household size.'),
          {
            name: 'Start a family',
            description: 'Model the costs and time of a first child.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Birth & baby equipment', amount: null, startMonth: start, note: 'Needs your input' }),
              flow({ kind: 'expense', label: 'Income reduction during parental leave', amount: null, startMonth: start, endMonth: start + 12, annualGrowth: 0, note: 'Monthly net income you would lose during leave' }),
              flow({ kind: 'expense', label: 'Childcare and child costs', amount: null, startMonth: start + 12, note: 'Monthly cost — needs your input' }),
              flow({ kind: 'time', label: 'Parenting time', amount: 20, startMonth: start, source: 'system', note: 'Assumed extra hours per week — adjust' }),
            ],
          },
        ],
      };
    }
    default: {
      return {
        title: 'A new decision',
        scenarios: [
          statusQuo(ctx, 'Current path', 'Things continue as they are.'),
          { name: 'Alternative', description: 'Describe what changes in this path.', variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) } },
        ],
      };
    }
  }
}

/** Turns template seeds into complete, validated scenario drafts. */
export function materializeScenarios(seeds: ScenarioSeed[], ctx: DraftContext, baseCurrency: string): ScenarioDraft[] {
  const horizon = ctx.horizonYears ?? ctx.baseline?.planningHorizonYears ?? 10;
  return seeds.map((s) => {
    const currency = s.currency ?? baseCurrency;
    const same = currency === baseCurrency;
    return {
      name: s.name.slice(0, 120),
      description: s.description,
      isBaseline: s.isBaseline ?? false,
      startDate: ctx.startDate,
      horizonYears: horizon,
      currency,
      exchangeRateToBase: same ? 1 : null,
      exchangeRateSource: same ? null : null,
      variables: s.variables,
      flows: s.flows ?? [],
      scores: {},
      assumptions: (s.assumptions ?? []).map((a) => ({ ...a, likelihood: null, impact: null })),
    };
  });
}

export type { ScenarioSeed };
export { unknown as unknownVariables, monthsLabel };
