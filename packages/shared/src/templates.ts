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

export type CategoryGroup = 'career' | 'money' | 'life' | 'learning' | 'obligations' | 'other';

export interface CategoryInfo {
  id: DecisionCategory;
  label: string;
  description: string;
  example: string;
  icon: string;
  group: CategoryGroup;
}

/** Template library sections, in display order. */
export const CATEGORY_GROUPS: { id: CategoryGroup; label: string; description: string }[] = [
  { id: 'career', label: 'Work & career', description: 'Jobs, offers, your own business and how you earn.' },
  { id: 'money', label: 'Money', description: 'Buying, saving, investing and debt.' },
  { id: 'life', label: 'Life & home', description: 'Where you live, who you live with, and your time.' },
  { id: 'learning', label: 'Studies & skills', description: 'Degrees, courses and certifications.' },
  { id: 'obligations', label: 'Papers & obligations', description: 'Obligations like military service that block or unlock other options.' },
  { id: 'other', label: 'Something else', description: 'A blank comparison of two paths.' },
];

export const CATEGORIES: CategoryInfo[] = [
  { id: 'relocation', label: 'Move abroad', description: 'Compare staying with relocating to another country.', example: 'What if I move from Algeria to Germany and work as a network engineer?', icon: 'plane', group: 'life' },
  { id: 'job_change', label: 'Leave my job', description: 'Weigh your current role against a new one or a break.', example: 'What if I leave my current job for a better-paid role?', icon: 'briefcase', group: 'career' },
  { id: 'business', label: 'Start a business', description: 'Model the runway, setup costs and ramp-up of your own venture.', example: 'What if I start my own consulting business?', icon: 'store', group: 'career' },
  { id: 'housing', label: 'Buy or rent', description: 'Compare buying a home with continuing to rent.', example: 'What if I buy a house instead of renting?', icon: 'home', group: 'money' },
  { id: 'investing', label: 'Invest monthly', description: 'See what a regular investment habit could add up to.', example: 'What if I invest 500 every month?', icon: 'trending-up', group: 'money' },
  { id: 'education', label: 'Learn a skill', description: 'Spend time and money on training for a future uplift.', example: 'What if I spend one year learning data engineering?', icon: 'graduation-cap', group: 'learning' },
  { id: 'city_move', label: 'Move city', description: 'Relocate within your country for work or lifestyle.', example: 'What if I relocate from Lyon to Paris?', icon: 'map-pin', group: 'life' },
  { id: 'sabbatical', label: 'Take time off', description: 'Plan a sabbatical and your return to work.', example: 'What if I take a year off to travel?', icon: 'sun', group: 'life' },
  { id: 'career_change', label: 'Change career', description: 'Retrain and switch to a different profession.', example: 'What if I change my career to become a UX designer?', icon: 'repeat', group: 'career' },
  { id: 'family', label: 'Start a family', description: 'Understand the costs and time of having children.', example: 'What if we start a family in the next two years?', icon: 'users', group: 'life' },
  { id: 'job_offer', label: 'Accept a job offer', description: 'Compare an offer with staying, including notice and commute.', example: 'What if I accept the job offer at 65k?', icon: 'briefcase', group: 'career' },
  { id: 'debt_payoff', label: 'Pay off debt', description: 'Minimum payments, paying off faster, or investing instead.', example: 'What if I pay off my student loan faster?', icon: 'landmark', group: 'money' },
  { id: 'major_purchase', label: 'Major purchase', description: 'Buy now, finance it, or wait and save.', example: 'What if I buy a new car?', icon: 'shopping-bag', group: 'money' },
  { id: 'working_hours', label: 'Change working hours', description: 'Part-time or a four-day week: less pay, more time.', example: 'What if I work a four-day week?', icon: 'clock', group: 'career' },
  { id: 'study_path', label: 'University or self-study', description: 'Full-time study versus learning while you work.', example: 'What if I do a degree full-time instead of self-study?', icon: 'graduation-cap', group: 'learning' },
  { id: 'certification', label: 'Professional certification', description: 'Fees and study time now, a higher salary later.', example: 'What if I get my CCNP certification?', icon: 'award', group: 'learning' },
  { id: 'military_service', label: 'Military service', description: 'Serve now, defer while studying, or wait for an exemption — and what each does to jobs and travel.', example: 'What if I do my military service now instead of waiting for an exemption?', icon: 'shield', group: 'obligations' },
  { id: 'study_abroad', label: 'Study abroad', description: 'Tuition, visa and living costs abroad against a degree and job at home.', example: 'What if I do a master’s in France?', icon: 'plane', group: 'learning' },
  { id: 'remote_work', label: 'Work remotely for foreign clients', description: 'Freelance or remote work paid in foreign currency, from home.', example: 'What if I freelance for clients in Europe while living in Algiers?', icon: 'globe', group: 'career' },
  { id: 'public_private', label: 'Public or private sector', description: 'A stable public job against a better-paid but riskier private one.', example: 'What if I take the public sector job instead of the private one?', icon: 'building', group: 'career' },
  { id: 'move_in_together', label: 'Move in together or marry', description: 'Shared rent and costs, a wedding, and what changes for both of you.', example: 'What if we move in together next year?', icon: 'heart', group: 'life' },
  { id: 'side_income', label: 'Start a side project', description: 'Extra income on top of your job, paid for with evenings and weekends.', example: 'What if I start a side business selling online?', icon: 'zap', group: 'money' },
  { id: 'other', label: 'Something else', description: 'Start from a blank comparison of two paths.', example: 'What if I…', icon: 'sparkles', group: 'other' },
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
    case 'job_offer': {
      return {
        title: 'Accept the job offer?',
        scenarios: [
          statusQuo(ctx, 'Stay in my current job', 'Decline the offer and continue as you are.'),
          {
            name: 'Accept the offer',
            description: 'Move to the new employer after your notice period.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              commuteHoursPerWeek: val(null, 'user', 'Weekly commute to the new workplace — needs your input'),
            },
            flows: [
              flow({ kind: 'salary_change', label: 'New salary', amount: e.annualSalary ?? null, startMonth: 2, note: e.annualSalary ? 'From your question' : 'Gross annual salary in the offer — needs your input' }),
              flow({ kind: 'one_time_income', label: 'Signing bonus', amount: null, startMonth: 2, note: 'If the offer includes one; otherwise remove this item' }),
            ],
            assumptions: [{ text: 'Benefits (pension matching, bonus, holidays) differ between employers — compare them explicitly.', category: 'question', source: 'system' }],
          },
        ],
      };
    }
    case 'debt_payoff': {
      const debtVars = () => ({
        startingDebt: val(ctx.baseline?.debt ?? null, 'user', ctx.baseline?.debt ? FROM_BASELINE : 'Outstanding balance — needs your input'),
        debtInterestRate: val(null, 'user', 'Annual interest rate on the debt — needs your input'),
      });
      return {
        title: 'Pay off debt faster?',
        scenarios: [
          {
            ...statusQuo(ctx, 'Keep minimum payments', 'Pay the required minimum and keep the rest in cash.'),
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline), ...debtVars(), debtMonthlyPayment: val(ctx.baseline?.monthlyDebtPayment ?? null, 'user', 'Your current minimum payment') },
          },
          {
            name: 'Pay it off faster',
            description: 'Put extra money towards the debt every month until it is gone.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline), ...debtVars(), debtMonthlyPayment: val(null, 'user', 'Total monthly payment including the extra amount') },
          },
          {
            name: 'Invest the difference instead',
            description: 'Keep minimum payments and invest the extra amount.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline), ...debtVars(), debtMonthlyPayment: val(ctx.baseline?.monthlyDebtPayment ?? null, 'user', 'Your current minimum payment'), monthlyInvestment: val(null, 'user', 'The extra amount you would otherwise put towards the debt') },
            assumptions: [{ text: 'Investment returns are uncertain; paying off debt is a guaranteed return equal to its interest rate.', category: 'risk', source: 'system' }],
          },
        ],
      };
    }
    case 'major_purchase': {
      return {
        title: 'Make a major purchase?',
        scenarios: [
          statusQuo(ctx, 'Don’t buy', 'Keep things as they are.'),
          {
            name: 'Buy now with savings',
            description: 'Pay in full from cash.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Purchase price', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Needs your input' }),
              flow({ kind: 'expense', label: 'Running costs', amount: null, startMonth: 0, note: 'Insurance, maintenance, fuel or energy — needs your input' }),
            ],
          },
          {
            name: 'Finance it',
            description: 'Take a loan and repay it monthly.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'loan', label: 'Purchase loan', amount: e.oneTimeAmount ?? null, startMonth: 0, rate: null, termMonths: 48, note: 'Loan amount — needs your input' }),
              flow({ kind: 'one_time_expense', label: 'Purchase price', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Needs your input' }),
              flow({ kind: 'expense', label: 'Running costs', amount: null, startMonth: 0, note: 'Needs your input' }),
            ],
          },
        ],
      };
    }
    case 'working_hours': {
      return {
        title: 'Change my working hours?',
        scenarios: [
          statusQuo(ctx, 'Keep full-time hours', 'Continue as you are.'),
          {
            name: 'Work a four-day week',
            description: 'Reduce hours to 80 % with a matching salary cut.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              workHoursPerWeek: val(32, 'system', 'Assumes 4 × 8 hours — adjust'),
            },
            flows: [
              flow({
                kind: 'salary_change',
                label: 'Reduced salary',
                amount: ctx.baseline?.annualIncome ? Math.round(ctx.baseline.annualIncome * 0.8) : null,
                startMonth: 0,
                source: ctx.baseline?.annualIncome ? 'system' : 'user',
                note: ctx.baseline?.annualIncome ? 'Assumed 80 % of your current salary — check your contract' : 'Gross salary at reduced hours — needs your input',
              }),
            ],
            assumptions: [{ text: 'Pension contributions and career progression may slow with fewer hours.', category: 'risk', source: 'system' }],
          },
        ],
      };
    }
    case 'study_path': {
      return {
        title: 'University or self-study?',
        scenarios: [
          statusQuo(ctx, 'Keep working, no study', 'Continue in your current role.'),
          {
            name: 'Study full-time',
            description: 'Stop working for a degree, then start in the new field.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'income_gap', label: 'Full-time study', amount: 0, startMonth: 0, endMonth: (e.durationMonths ?? 36), note: 'No salary while studying' }),
              flow({ kind: 'expense', label: 'Tuition', amount: null, startMonth: 0, endMonth: (e.durationMonths ?? 36), annualGrowth: 0, note: 'Monthly tuition — needs your input' }),
              flow({ kind: 'time', label: 'Study time', amount: 40, startMonth: 0, endMonth: (e.durationMonths ?? 36), source: 'system', note: 'Assumed full-time study — adjust' }),
              flow({ kind: 'salary_change', label: 'Salary after graduating', amount: null, startMonth: (e.durationMonths ?? 36) + 3, note: 'Expected starting salary — needs your input' }),
            ],
          },
          {
            name: 'Self-study while working',
            description: 'Keep your job and learn in the evenings.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'expense', label: 'Courses and materials', amount: null, startMonth: 0, endMonth: 24, annualGrowth: 0, note: 'Monthly cost — needs your input' }),
              flow({ kind: 'time', label: 'Evening study', amount: 10, startMonth: 0, endMonth: 24, source: 'system', note: 'Assumed hours per week — adjust' }),
              flow({ kind: 'salary_change', label: 'Salary after the switch', amount: null, startMonth: 27, note: 'Expected salary once qualified — needs your input' }),
            ],
            assumptions: [{ text: 'Some employers require a formal degree; check job listings in your target field.', category: 'question', source: 'system' }],
          },
        ],
      };
    }
    case 'certification': {
      const months = e.durationMonths ?? 6;
      return {
        title: 'Get a professional certification?',
        scenarios: [
          statusQuo(ctx, 'No certification', 'Continue as you are.'),
          {
            name: 'Get certified',
            description: `Study for about ${monthsLabel(months)}, then aim for a better-paid role.`,
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Exam and course fees', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Needs your input' }),
              flow({ kind: 'time', label: 'Study time', amount: 8, startMonth: 0, endMonth: months, source: 'system', note: 'Assumed hours per week — adjust' }),
              flow({ kind: 'salary_change', label: 'Salary with certification', amount: null, startMonth: months + 3, note: 'Expected salary once certified — needs your input' }),
            ],
            assumptions: [{ text: 'A salary increase is not guaranteed; look at job offers that require the certification.', category: 'risk', source: 'system' }],
          },
        ],
      };
    }
    case 'military_service': {
      const service = e.durationMonths ?? 12;
      const study = 24;
      const servicePaths: ScenarioSeed['assumptions'] = [
        { text: 'Service length, allowance and exemption rules differ by country and change over time — check the current official rules.', category: 'question', source: 'system' },
      ];
      return {
        title: 'Military service: serve now, defer, or wait for an exemption?',
        scenarios: [
          {
            ...statusQuo(ctx, 'Wait for an exemption', 'Keep working or studying without serving, and wait for a deferral, an exemption or a regularisation measure.'),
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              jobLossProbability: val(10, 'system', 'Higher than usual: without a settled service status some employers will not hire or keep you — adjust'),
              unemploymentMonths: val(6, 'system', 'Time to find work again when a job falls through — adjust'),
            },
            assumptions: [
              { text: 'Without a settled service status, some jobs, a passport or a visa may be out of reach.', category: 'risk', source: 'system' },
              { text: 'An exemption or regularisation may come — or may not. You cannot plan its timing.', category: 'risk', source: 'system' },
              ...servicePaths,
            ],
          },
          {
            name: `Serve now (${monthsLabel(service)})`,
            description: 'Do the service now, then look for work with your status settled.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              jobLossProbability: val(3, 'system', 'Settled status: fewer doors closed — adjust'),
            },
            flows: [
              flow({ kind: 'income_gap', label: 'Military service', amount: 0, startMonth: 0, endMonth: service, note: 'No regular salary while serving' }),
              flow({ kind: 'income', label: 'Service allowance', amount: null, startMonth: 0, endMonth: service, annualGrowth: 0, note: 'Monthly allowance during service, if any — needs your input' }),
              flow({ kind: 'income', label: 'Living costs covered while serving', amount: null, startMonth: 0, endMonth: service, annualGrowth: 0, note: 'Monthly food and housing you no longer pay yourself — needs your input' }),
              flow({ kind: 'time', label: 'Service', amount: 50, startMonth: 0, endMonth: service, source: 'system', note: 'Assumed hours per week away from your own plans — adjust' }),
              flow({ kind: 'salary_change', label: 'Salary after service', amount: e.annualSalary ?? null, startMonth: service + 3, note: 'Expected gross salary once your status is settled — needs your input' }),
            ],
            assumptions: [
              { text: 'A settled status opens jobs that ask for it, and makes passports and visas easier.', category: 'opportunity', source: 'system' },
              { text: 'You find work about three months after the service ends.', category: 'assumption', source: 'system' },
              ...servicePaths,
            ],
          },
          {
            name: 'Defer, finish studies, then serve',
            description: 'Use a study deferral, graduate, then serve — sometimes in a role that matches your degree.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'expense', label: 'Study costs', amount: null, startMonth: 0, endMonth: study, annualGrowth: 0, note: 'Monthly fees, books and transport — needs your input' }),
              flow({ kind: 'time', label: 'Study time', amount: 30, startMonth: 0, endMonth: study, source: 'system', note: 'Assumed hours per week — adjust' }),
              flow({ kind: 'income_gap', label: 'Military service', amount: 0, startMonth: study, endMonth: study + service, note: 'No regular salary while serving' }),
              flow({ kind: 'income', label: 'Service allowance', amount: null, startMonth: study, endMonth: study + service, annualGrowth: 0, note: 'Monthly allowance during service, if any — needs your input' }),
              flow({ kind: 'salary_change', label: 'Graduate salary after service', amount: null, startMonth: study + service + 3, note: 'Expected gross salary with the degree — needs your input' }),
            ],
            assumptions: [{ text: 'Deferrals usually have an age limit and require proof that you are enrolled.', category: 'question', source: 'system' }, ...servicePaths],
          },
        ],
      };
    }
    case 'study_abroad': {
      const dest = e.destinations?.[0] ?? { label: 'abroad', currency: null };
      const months = e.durationMonths ?? 24;
      const where = dest.label === 'abroad' ? 'abroad' : `in ${dest.label}`;
      return {
        title: `Study ${where}?`,
        scenarios: [
          statusQuo(ctx, `Stay${hereLabel}`, 'Keep working or studying where you are.'),
          {
            name: `Study ${where}`,
            description: `A ${monthsLabel(months)} programme ${where}, with a part-time student job, then a first job there.`,
            currency: dest.currency,
            variables: {
              ...systemDefaults(),
              startingCash: fromBaseline(ctx.baseline).startingCash ?? val(null, 'user', NEEDS_INPUT),
              grossAnnualIncome: val(e.annualSalary ?? null, 'user', 'Graduate salary in the destination — needs your input'),
              effectiveTaxRate: val(null, 'user', 'Tax and social contributions in the destination'),
              housingCostMonthly: val(null, 'user', 'Student rent in the destination city'),
              livingCostMonthly: val(null, 'user', 'Other monthly living costs in the destination'),
              incomeStartMonth: val(months + 4, 'system', 'Graduation plus a job search — adjust', months + 2, months + 10),
              employmentProbability: val(70, 'system', 'Assumed chance of finding a graduate job there on time — adjust'),
              extendedSearchMonths: val(6, 'system', 'Extra months if the first search fails'),
            },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Visa, flights and first deposit', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Needs your input' }),
              flow({ kind: 'expense', label: 'Tuition', amount: null, startMonth: 0, endMonth: months, annualGrowth: 0, note: 'Monthly tuition (0 if the programme is free) — needs your input' }),
              flow({ kind: 'income', label: 'Part-time student job', amount: null, startMonth: 2, endMonth: months, annualGrowth: 0, note: 'Net monthly pay; student visas often cap working hours' }),
              flow({ kind: 'time', label: 'Study time', amount: 35, startMonth: 0, endMonth: months, source: 'system', note: 'Assumed hours per week — adjust' }),
            ],
            assumptions: [
              { text: 'Many student visas require proof of funds (e.g. a blocked account) before you leave.', category: 'question', source: 'system' },
              { text: 'You can stay and work after graduating — check the post-study work rules.', category: 'assumption', source: 'system' },
              { text: 'Exchange rates, especially if you rely on money sent from home, may move a lot.', category: 'risk', source: 'system' },
            ],
          },
        ],
      };
    }
    case 'remote_work': {
      return {
        title: 'Work remotely for foreign clients?',
        scenarios: [
          statusQuo(ctx, 'Keep my local job', 'Stay employed locally and paid in your own currency.'),
          {
            name: 'Go remote / freelance',
            description: 'Leave the local job and work for clients abroad from home.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              grossAnnualIncome: val(0, 'user', 'Client income is modelled as a separate item below'),
              jobLossProbability: val(15, 'system', 'Chance per year of losing your main client — adjust'),
              unemploymentMonths: val(3, 'system', 'Time to replace a lost client — adjust'),
            },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Laptop, internet and setup', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Needs your input' }),
              flow({ kind: 'income', label: 'Client income (first months)', amount: null, startMonth: 1, endMonth: 6, annualGrowth: 0, note: 'Monthly net income while you build a client base, in your currency at the rate you actually get' }),
              flow({ kind: 'income', label: 'Client income (established)', amount: e.monthlyAmount ?? null, startMonth: 6, annualGrowth: 5, note: 'Monthly net income once established — needs your input' }),
              flow({ kind: 'expense', label: 'Platform, transfer and exchange fees', amount: null, startMonth: 1, note: 'Monthly cost of getting paid from abroad — needs your input' }),
            ],
            assumptions: [
              { text: 'Receiving foreign payments can be slow or costly; the rate you get may differ from the official one.', category: 'risk', source: 'system' },
              { text: 'No paid holidays, sick pay or employer pension.', category: 'risk', source: 'system' },
              { text: 'Earning in a stronger currency protects you if your local currency weakens.', category: 'opportunity', source: 'system' },
            ],
          },
        ],
      };
    }
    case 'public_private': {
      return {
        title: 'Public sector or private sector?',
        scenarios: [
          {
            name: 'Public sector job',
            description: 'Lower pay and slower raises, but very stable.',
            isBaseline: true,
            currency: ctx.baseline?.currency ?? null,
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              grossAnnualIncome: val(null, 'user', 'Gross salary in the public job — needs your input'),
              incomeGrowthRate: val(2, 'system', 'Slow, predictable raises — adjust', 1, 3),
              jobLossProbability: val(1, 'system', 'Public jobs are rarely lost — adjust'),
            },
            assumptions: [{ text: 'Public jobs often come with housing, pension or family benefits — add them if they apply.', category: 'question', source: 'system' }],
          },
          {
            name: 'Private sector job',
            description: 'Higher pay and faster raises, with a real chance of losing the job.',
            variables: {
              ...systemDefaults(),
              ...fromBaseline(ctx.baseline),
              grossAnnualIncome: val(e.annualSalary ?? null, 'user', 'Gross salary in the private job — needs your input'),
              incomeGrowthRate: val(4, 'system', 'Faster raises when you perform — adjust', 0, 8),
              jobLossProbability: val(8, 'system', 'Chance per year of losing the job — adjust'),
              unemploymentMonths: val(5, 'system', 'Months to find a new job — adjust'),
            },
            assumptions: [{ text: 'Private employers may pay part of the salary informally or skip social contributions — check the contract.', category: 'risk', source: 'system' }],
          },
        ],
      };
    }
    case 'move_in_together': {
      const when = e.delayMonths ?? 6;
      return {
        title: 'Move in together?',
        scenarios: [
          statusQuo(ctx, 'Keep separate homes', 'Each of you keeps your own place for now.'),
          {
            name: `Move in together in ${monthsLabel(when)}`,
            description: 'Share a home and split rent and living costs. Model your own share here.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Moving and furniture (your share)', amount: null, startMonth: when, note: 'Needs your input' }),
              flow({ kind: 'expense', label: 'Your share of the new rent', amount: null, startMonth: when, note: 'Monthly — needs your input. Set your current rent to stop at the same time below.' }),
              flow({ kind: 'income', label: 'Current rent you stop paying', amount: ctx.baseline?.monthlyHousingCost ?? null, startMonth: when, annualGrowth: 0, note: ctx.baseline?.monthlyHousingCost ? FROM_BASELINE : 'Your current monthly rent — needs your input' }),
            ],
            assumptions: [{ text: 'Shared costs are split as agreed; write down who pays what.', category: 'assumption', source: 'system' }],
          },
          {
            name: 'Get married, then move in',
            description: 'A wedding first, then a shared home.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Wedding, gifts and celebrations (your share)', amount: e.oneTimeAmount ?? null, startMonth: when + 6, note: 'Needs your input' }),
              flow({ kind: 'one_time_expense', label: 'Furnishing the home (your share)', amount: null, startMonth: when + 6, note: 'Needs your input' }),
              flow({ kind: 'expense', label: 'Your share of the new rent', amount: null, startMonth: when + 6, note: 'Monthly — needs your input' }),
              flow({ kind: 'income', label: 'Current rent you stop paying', amount: ctx.baseline?.monthlyHousingCost ?? null, startMonth: when + 6, annualGrowth: 0, note: ctx.baseline?.monthlyHousingCost ? FROM_BASELINE : 'Your current monthly rent — needs your input' }),
            ],
            assumptions: [{ text: 'Each partner can open this decision with their own numbers — share it from the decision menu.', category: 'assumption', source: 'system' }],
          },
        ],
      };
    }
    case 'side_income': {
      return {
        title: 'Start a side project?',
        scenarios: [
          statusQuo(ctx, 'No side project', 'Keep your evenings and weekends free.'),
          {
            name: 'Start the side project',
            description: 'Keep your job and build extra income in your free time.',
            variables: { ...systemDefaults(), ...fromBaseline(ctx.baseline) },
            flows: [
              flow({ kind: 'one_time_expense', label: 'Setup costs', amount: e.oneTimeAmount ?? null, startMonth: 0, note: 'Stock, tools, website — needs your input' }),
              flow({ kind: 'income', label: 'Side income', amount: e.monthlyAmount ?? null, startMonth: 3, annualGrowth: 10, note: 'Net monthly profit once it starts — needs your input' }),
              flow({ kind: 'expense', label: 'Running costs', amount: null, startMonth: 0, note: 'Monthly fees, ads, materials — needs your input' }),
              flow({ kind: 'time', label: 'Evenings and weekends', amount: 10, startMonth: 0, source: 'system', note: 'Assumed hours per week — adjust' }),
            ],
            assumptions: [{ text: 'Most side projects earn little in the first months.', category: 'risk', source: 'system' }],
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
