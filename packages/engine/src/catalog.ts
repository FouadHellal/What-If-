import type { Polarity, VariableKey, VariableUnit } from './types';

export type VariableGroup = 'start' | 'income' | 'living' | 'investing' | 'property' | 'time';

export interface VariableDefinition {
  key: VariableKey;
  label: string;
  group: VariableGroup;
  unit: VariableUnit;
  polarity: Polarity;
  /** Value the engine uses when the user provides nothing. */
  fallback: number;
  /**
   * True when the fallback is a genuine, documented system assumption
   * (e.g. 2.5 % inflation). False when the fallback is simply "nothing" (0)
   * and the variable needs real user input to be meaningful.
   */
  hasSystemDefault: boolean;
  /** Missing value should be called out to the user. */
  important: boolean;
  min: number;
  max: number;
  /** Spread used by the sensitivity analysis when no explicit range was given. */
  defaultSpread: { type: 'relative'; amount: number } | { type: 'absolute'; amount: number };
  description: string;
}

const MONEY_MAX = 1e12;

function money(
  key: VariableKey,
  label: string,
  group: VariableGroup,
  unit: 'currency' | 'currency_month' | 'currency_year',
  polarity: Polarity,
  important: boolean,
  description: string,
  min = 0,
): VariableDefinition {
  return {
    key,
    label,
    group,
    unit,
    polarity,
    fallback: 0,
    hasSystemDefault: false,
    important,
    min,
    max: MONEY_MAX,
    defaultSpread: { type: 'relative', amount: 0.1 },
    description,
  };
}

function rate(
  key: VariableKey,
  label: string,
  group: VariableGroup,
  polarity: Polarity,
  fallback: number,
  hasSystemDefault: boolean,
  important: boolean,
  description: string,
  min = -50,
  max = 100,
  spread = 1,
): VariableDefinition {
  return {
    key,
    label,
    group,
    unit: 'percent_year',
    polarity,
    fallback,
    hasSystemDefault,
    important,
    min,
    max,
    defaultSpread: { type: 'absolute', amount: spread },
    description,
  };
}

export const VARIABLES: readonly VariableDefinition[] = [
  // ── Starting position ────────────────────────────────────────────
  money('startingCash', 'Cash savings today', 'start', 'currency', 'higher', true,
    'Cash and easily accessible savings at the start of the scenario.', -MONEY_MAX),
  money('startingInvestments', 'Investments today', 'start', 'currency', 'higher', false,
    'Value of invested assets (funds, shares, pension pots you count) at the start.'),
  money('startingDebt', 'Outstanding debt', 'start', 'currency', 'lower', false,
    'Consumer loans, student debt or other non-mortgage debt at the start.'),
  rate('debtInterestRate', 'Debt interest rate', 'start', 'lower', 0, false, false,
    'Annual interest charged on outstanding debt.', 0, 100),
  {
    ...money('debtMonthlyPayment', 'Debt repayment', 'start', 'currency_month', 'none', false,
      'Monthly repayment towards outstanding debt until it is cleared.'),
  },

  // ── Income ───────────────────────────────────────────────────────
  money('grossAnnualIncome', 'Gross annual salary', 'income', 'currency_year', 'higher', true,
    'Expected salary before tax. Leave empty if this scenario has no salary.'),
  {
    key: 'effectiveTaxRate',
    label: 'Effective tax & social contributions',
    group: 'income',
    unit: 'percent',
    polarity: 'lower',
    fallback: 0,
    hasSystemDefault: false,
    important: true,
    min: 0,
    max: 100,
    defaultSpread: { type: 'absolute', amount: 3 },
    description:
      'Share of gross salary paid in income tax and social contributions combined. ' +
      'The engine does not ship tax tables — enter the rate that applies to you.',
  },
  rate('incomeGrowthRate', 'Annual salary growth', 'income', 'higher', 2, true, false,
    'Average yearly raise, applied at the start of each scenario year.', -50, 100, 1),
  {
    key: 'incomeStartMonth',
    label: 'Months until salary starts',
    group: 'income',
    unit: 'months',
    polarity: 'lower',
    fallback: 0,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 600,
    defaultSpread: { type: 'absolute', amount: 2 },
    description: 'Job-search, notice period or training time before the salary begins.',
  },
  {
    key: 'employmentProbability',
    label: 'Probability of landing the job',
    group: 'income',
    unit: 'percent',
    polarity: 'higher',
    fallback: 100,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 100,
    defaultSpread: { type: 'absolute', amount: 10 },
    description:
      'Chance that the salary starts on time. If it does not, the extended search period applies.',
  },
  {
    key: 'extendedSearchMonths',
    label: 'Extra search time if it falls through',
    group: 'income',
    unit: 'months',
    polarity: 'lower',
    fallback: 6,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 120,
    defaultSpread: { type: 'absolute', amount: 2 },
    description: 'Additional months without salary when the first job search is unsuccessful.',
  },

  // ── Living costs ─────────────────────────────────────────────────
  money('housingCostMonthly', 'Rent or housing cost', 'living', 'currency_month', 'lower', true,
    'Monthly rent (or equivalent housing cost). Stops automatically if a property is purchased.'),
  money('livingCostMonthly', 'Other living costs', 'living', 'currency_month', 'lower', true,
    'Food, transport, utilities, insurance, leisure — everything except housing.'),
  rate('inflationRate', 'Inflation', 'living', 'lower', 2.5, true, false,
    'Annual increase of living costs. Also used to express results in today’s money.', -10, 100, 1),

  // ── Saving & investing ───────────────────────────────────────────
  money('monthlyInvestment', 'Monthly investment', 'investing', 'currency_month', 'none', false,
    'Amount moved from cash into investments each month — only when cash is available.'),
  rate('investmentReturn', 'Investment return', 'investing', 'higher', 5, true, false,
    'Average nominal annual return on investments, before inflation. Not guaranteed.', -50, 100, 2),
  rate('cashInterestRate', 'Interest on cash', 'investing', 'higher', 0, true, false,
    'Annual interest earned on positive cash balances.', 0, 100, 0.5),

  // ── Property ─────────────────────────────────────────────────────
  money('propertyPrice', 'Property price (today)', 'property', 'currency', 'lower', false,
    'Purchase price in today’s money. Leave at 0 if this scenario does not include buying.'),
  {
    key: 'propertyPurchaseMonth',
    label: 'Purchase month',
    group: 'property',
    unit: 'months',
    polarity: 'none',
    fallback: 0,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 600,
    defaultSpread: { type: 'absolute', amount: 6 },
    description: 'Months from scenario start until the purchase.',
  },
  {
    key: 'downPaymentPct',
    label: 'Down payment',
    group: 'property',
    unit: 'percent',
    polarity: 'none',
    fallback: 20,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 100,
    defaultSpread: { type: 'absolute', amount: 5 },
    description: 'Share of the price paid upfront from cash.',
  },
  {
    key: 'purchaseCostsPct',
    label: 'Purchase costs',
    group: 'property',
    unit: 'percent',
    polarity: 'lower',
    fallback: 5,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 50,
    defaultSpread: { type: 'absolute', amount: 1 },
    description: 'Transfer taxes, notary and agent fees as a share of the price.',
  },
  rate('mortgageRate', 'Mortgage interest rate', 'property', 'lower', 4, true, false,
    'Fixed annual interest rate on the mortgage.', 0, 50, 1),
  {
    key: 'mortgageTermYears',
    label: 'Mortgage term',
    group: 'property',
    unit: 'years',
    polarity: 'none',
    fallback: 25,
    hasSystemDefault: true,
    important: false,
    min: 1,
    max: 50,
    defaultSpread: { type: 'absolute', amount: 5 },
    description: 'Repayment period of the mortgage.',
  },
  rate('propertyAppreciation', 'Property value growth', 'property', 'higher', 2, true, false,
    'Average annual change in the property’s market value.', -50, 100, 1),
  {
    ...rate('ownershipCostPct', 'Ownership costs', 'property', 'lower', 1.5, true, false,
      'Maintenance, property tax and insurance per year, as a share of the property value.', 0, 20, 0.5),
  },

  // ── Time ─────────────────────────────────────────────────────────
  {
    key: 'workHoursPerWeek',
    label: 'Working hours',
    group: 'time',
    unit: 'hours_week',
    polarity: 'none',
    fallback: 40,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 112,
    defaultSpread: { type: 'absolute', amount: 5 },
    description: 'Hours worked per week while the salary is active.',
  },
  {
    key: 'commuteHoursPerWeek',
    label: 'Commute',
    group: 'time',
    unit: 'hours_week',
    polarity: 'none',
    fallback: 0,
    hasSystemDefault: true,
    important: false,
    min: 0,
    max: 112,
    defaultSpread: { type: 'absolute', amount: 2 },
    description: 'Hours spent commuting per week while working.',
  },
];

export const VARIABLE_KEYS = VARIABLES.map((v) => v.key) as VariableKey[];

const BY_KEY = new Map(VARIABLES.map((v) => [v.key, v]));

export function getVariableDefinition(key: VariableKey): VariableDefinition {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown variable: ${key}`);
  return def;
}

export function isVariableKey(key: string): key is VariableKey {
  return BY_KEY.has(key as VariableKey);
}

export const VARIABLE_GROUPS: { id: VariableGroup; label: string; description: string }[] = [
  { id: 'start', label: 'Starting position', description: 'What you have and owe today.' },
  { id: 'income', label: 'Income', description: 'Salary, taxes and the risk of the income not materialising.' },
  { id: 'living', label: 'Living costs', description: 'Recurring monthly spending and inflation.' },
  { id: 'investing', label: 'Saving & investing', description: 'How surplus cash is put to work.' },
  { id: 'property', label: 'Property', description: 'Optional home purchase with a mortgage.' },
  { id: 'time', label: 'Time', description: 'How the week is spent while working.' },
];

/** Hours per week assumed for sleep (8 h × 7). Free time = 168 − sleep − work − commute − commitments. */
export const SLEEP_HOURS_PER_WEEK = 56;
export const HOURS_PER_WEEK = 168;

/** Absolute cap on any money amount accepted by the engine. */
export const MAX_MONEY = MONEY_MAX;
export const MAX_HORIZON_YEARS = 50;
export const MIN_HORIZON_YEARS = 1;
