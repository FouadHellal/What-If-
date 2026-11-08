/**
 * Core types for the What-If simulation engine.
 *
 * The engine is a pure, deterministic function of its inputs: the same
 * ScenarioModel + SimulationOptions always produce the same SimulationResult.
 * No I/O, no clock, no global randomness.
 */

/** Where a value came from. Shown to the user next to every assumption. */
export type ValueSource = 'user' | 'ai' | 'external' | 'system';

export type VariableUnit =
  | 'currency' // a stock amount (e.g. starting savings)
  | 'currency_month' // amount per month
  | 'currency_year' // amount per year
  | 'percent' // percentage points, e.g. 32 means 32 %
  | 'percent_year' // annual rate in percentage points
  | 'months'
  | 'years'
  | 'hours_week';

/**
 * Polarity tells the engine which direction is favourable, so that it can
 * build best / worst cases from ranges. `none` variables are excluded from
 * best/worst construction (they are choices, not uncertainties).
 */
export type Polarity = 'higher' | 'lower' | 'none';

export type VariableKey =
  // starting position
  | 'startingCash'
  | 'startingInvestments'
  | 'startingDebt'
  | 'debtInterestRate'
  | 'debtMonthlyPayment'
  // income
  | 'grossAnnualIncome'
  | 'effectiveTaxRate'
  | 'incomeGrowthRate'
  | 'incomeStartMonth'
  | 'employmentProbability'
  | 'extendedSearchMonths'
  // living costs
  | 'housingCostMonthly'
  | 'livingCostMonthly'
  | 'inflationRate'
  // saving & investing
  | 'monthlyInvestment'
  | 'investmentReturn'
  | 'cashInterestRate'
  // property
  | 'propertyPrice'
  | 'propertyPurchaseMonth'
  | 'downPaymentPct'
  | 'purchaseCostsPct'
  | 'mortgageRate'
  | 'mortgageTermYears'
  | 'propertyAppreciation'
  | 'ownershipCostPct'
  // time
  | 'workHoursPerWeek'
  | 'commuteHoursPerWeek';

export interface VariableInput {
  /** `null` means "not provided" — the engine uses the catalog fallback and emits a warning when the variable is important. */
  value: number | null;
  /** Unfavourable/favourable bounds are derived from low/high using polarity. */
  low?: number | null;
  high?: number | null;
  source: ValueSource;
  note?: string | null;
}

export type FlowKind = 'income' | 'expense' | 'one_time_income' | 'one_time_expense' | 'time';

export interface FlowInput {
  id: string;
  kind: FlowKind;
  label: string;
  /**
   * For money flows: amount per month (recurring) or total amount (one-time), in scenario currency.
   * For `percent_of_income` mode: percent of gross monthly salary.
   * For time flows: hours per week.
   */
  amount: number | null;
  low?: number | null;
  high?: number | null;
  amountMode?: 'fixed' | 'percent_of_income';
  /** Month index (0 = scenario start) when the flow begins / occurs. */
  startMonth: number;
  /** Exclusive end month index. `null` = until the end of the horizon. Ignored for one-time flows. */
  endMonth?: number | null;
  /** Annual growth in percentage points. `null` = inflation for expenses, 0 for income. */
  annualGrowth?: number | null;
  source: ValueSource;
  note?: string | null;
}

export interface ScenarioModel {
  /** First simulated month, `YYYY-MM`. */
  startDate: string;
  horizonYears: number;
  /** ISO 4217 code of all money values in this scenario. */
  currency: string;
  /** Units of the decision's base currency per 1 unit of `currency`. 1 when they match. */
  exchangeRateToBase?: number;
  variables: Partial<Record<VariableKey, VariableInput>>;
  flows: FlowInput[];
}

export interface SimulationOptions {
  /** Seed for the Monte Carlo uncertainty analysis. Stored with every run for reproducibility. */
  seed?: number;
  /** Number of Monte Carlo runs. */
  runs?: number;
  /** Skip uncertainty + sensitivity (used for fast intermediate calculations). */
  quick?: boolean;
}

export type CaseName = 'expected' | 'best' | 'worst';

/** A fully resolved set of numbers that a single deterministic projection runs on. */
export interface ResolvedParams {
  values: Record<VariableKey, number>;
  /** Effective month when salary starts (after job-search delay and employment outcome). */
  effectiveIncomeStart: number;
  flows: ResolvedFlow[];
}

export interface ResolvedFlow {
  id: string;
  kind: FlowKind;
  label: string;
  amount: number;
  amountMode: 'fixed' | 'percent_of_income';
  startMonth: number;
  endMonth: number | null;
  annualGrowth: number | null;
}

export interface MonthPoint {
  /** Month index from scenario start. */
  t: number;
  /** `YYYY-MM` */
  date: string;
  grossIncome: number;
  taxes: number;
  netIncome: number;
  housing: number;
  living: number;
  otherExpenses: number;
  oneTimeExpenses: number;
  oneTimeIncome: number;
  propertyCosts: number;
  debtPayments: number;
  totalExpenses: number;
  netCashFlow: number;
  investmentContribution: number;
  investmentGrowth: number;
  cash: number;
  investments: number;
  propertyValue: number;
  mortgageBalance: number;
  debt: number;
  netWorth: number;
  realNetWorth: number;
  freeHoursPerWeek: number;
}

export interface YearPoint {
  year: number; // index 0..horizon-1
  label: string; // calendar year of the period end, e.g. "2028"
  endDate: string;
  grossIncome: number;
  taxes: number;
  netIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  investmentContribution: number;
  investmentGrowth: number;
  cash: number;
  investments: number;
  propertyValue: number;
  mortgageBalance: number;
  debt: number;
  netWorth: number;
  realNetWorth: number;
  avgFreeHoursPerWeek: number;
}

export interface ProjectionSummary {
  startingNetWorth: number;
  finalNetWorth: number;
  finalRealNetWorth: number;
  finalCash: number;
  finalInvestments: number;
  finalPropertyEquity: number;
  totalGrossIncome: number;
  totalNetIncome: number;
  totalTaxes: number;
  totalExpenses: number;
  totalInvestmentGrowth: number;
  oneTimeCostsTotal: number;
  /** One-time expenses plus property purchase cash outlay in the first 12 months. */
  upfrontCost: number;
  avgMonthlyNetIncomeYear1: number;
  avgMonthlyExpensesYear1: number;
  avgMonthlyNetCashFlowYear1: number;
  /** Net cash flow divided by net income over the first year (null when there is no income). */
  savingsRateYear1: number | null;
  lowestCash: number;
  lowestCashMonth: number;
  firstShortfallMonth: number | null;
  monthsInShortfall: number;
  /** Months the starting cash would cover year-1 average expenses. */
  startingRunwayMonths: number | null;
  avgFreeHoursPerWeek: number;
  avgFreeHoursPerWeekYear1: number;
  effectiveIncomeStart: number;
  monthlyMortgagePayment: number | null;
}

export interface Projection {
  months: MonthPoint[];
  years: YearPoint[];
  summary: ProjectionSummary;
}

export interface CaseResult {
  name: CaseName;
  summary: ProjectionSummary;
  /** Year-end net worth series. */
  netWorth: number[];
  realNetWorth: number[];
  cash: number[];
}

export interface Percentiles {
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface UncertaintyResult {
  runs: number;
  seed: number;
  /** True when at least one input carries a range or employment risk. */
  hasUncertainty: boolean;
  /** Per year-end net worth percentiles. */
  netWorthBands: Percentiles[];
  finalNetWorth: Percentiles;
  /** Share of runs (0–1) in which cash dropped below zero at any point. */
  shortfallProbability: number;
  /** Share of runs (0–1) that ended below starting net worth. */
  lossProbability: number;
}

export interface SensitivityItem {
  /** Variable key, or `flow:<id>` for flows. */
  key: string;
  label: string;
  lowInput: number;
  highInput: number;
  /** Final net worth with the input at low / high (other inputs at expected values). */
  atLow: number;
  atHigh: number;
  swing: number;
  /** `range` when the user/AI gave a range; `default` when the engine applied its standard spread. */
  basis: 'range' | 'default';
}

export type MilestoneKind =
  | 'start'
  | 'event'
  | 'income_start'
  | 'flow_start'
  | 'flow_end'
  | 'property'
  | 'emergency_fund'
  | 'net_worth'
  | 'debt_free'
  | 'mortgage_free'
  | 'shortfall'
  | 'end';

export interface DerivedMilestone {
  id: string;
  kind: MilestoneKind;
  month: number;
  date: string;
  title: string;
  detail: string;
}

export type InsightKind = 'risk' | 'opportunity' | 'gap';
export type Severity = 'high' | 'medium' | 'low';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  detail: string;
}

export interface ExplanationLine {
  label: string;
  formula: string;
  value: number;
  unit: 'currency' | 'currency_month' | 'percent' | 'months' | 'hours_week' | 'number';
}

export interface SimulationWarning {
  code: string;
  message: string;
  key?: string;
}

export interface SimulationResult {
  engineVersion: string;
  inputHash: string;
  currency: string;
  startDate: string;
  horizonYears: number;
  expected: Projection;
  cases: Record<CaseName, CaseResult>;
  uncertainty: UncertaintyResult | null;
  sensitivity: SensitivityItem[];
  milestones: DerivedMilestone[];
  insights: Insight[];
  explanation: ExplanationLine[];
  warnings: SimulationWarning[];
}
