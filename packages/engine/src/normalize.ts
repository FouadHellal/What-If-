import {
  MAX_HORIZON_YEARS,
  MAX_MONEY,
  MIN_HORIZON_YEARS,
  VARIABLES,
  getVariableDefinition,
} from './catalog';
import type {
  CaseName,
  FlowInput,
  ResolvedFlow,
  ResolvedParams,
  ScenarioModel,
  SimulationWarning,
  VariableInput,
  VariableKey,
} from './types';
import { clamp, isValidMonth } from './util';

export class EngineInputError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = 'EngineInputError';
  }
}

/** A variable after validation: value is always a finite number, bounds bracket the value. */
export interface NormalizedVariable {
  value: number;
  low: number | null;
  high: number | null;
  provided: boolean;
}

export interface NormalizedFlow extends Omit<ResolvedFlow, 'amount'> {
  amount: number;
  low: number | null;
  high: number | null;
}

export interface NormalizedModel {
  startDate: string;
  horizonYears: number;
  horizonMonths: number;
  currency: string;
  exchangeRateToBase: number;
  variables: Record<VariableKey, NormalizedVariable>;
  flows: NormalizedFlow[];
  warnings: SimulationWarning[];
}

/** Hard validation: problems the engine cannot repair. */
export function validateModel(model: ScenarioModel): string[] {
  const issues: string[] = [];
  if (!model || typeof model !== 'object') return ['Model must be an object.'];
  if (typeof model.startDate !== 'string' || !isValidMonth(model.startDate)) {
    issues.push('startDate must be a valid YYYY-MM month.');
  }
  if (typeof model.horizonYears !== 'number' || !Number.isFinite(model.horizonYears)) {
    issues.push('horizonYears must be a finite number.');
  }
  if (typeof model.currency !== 'string' || !/^[A-Z]{3}$/.test(model.currency)) {
    issues.push('currency must be a three-letter ISO 4217 code.');
  }
  if (!model.variables || typeof model.variables !== 'object') issues.push('variables must be an object.');
  if (!Array.isArray(model.flows)) issues.push('flows must be an array.');
  return issues;
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function normalizeVariable(
  key: VariableKey,
  input: VariableInput | undefined,
  warnings: SimulationWarning[],
): NormalizedVariable {
  const def = getVariableDefinition(key);
  const raw = input ? finiteOrNull(input.value) : null;
  if (input && input.value !== null && input.value !== undefined && raw === null) {
    warnings.push({ code: 'invalid_value', key, message: `${def.label} was not a valid number and was ignored.` });
  }
  let value: number;
  const provided = raw !== null;
  if (raw === null) {
    value = def.fallback;
    if (def.important && !def.hasSystemDefault) {
      warnings.push({
        code: 'missing_value',
        key,
        message: `${def.label} has not been set — treated as ${def.fallback}.`,
      });
    }
  } else {
    value = raw;
    if (value < def.min || value > def.max) {
      const clamped = clamp(value, def.min, def.max);
      warnings.push({
        code: 'clamped',
        key,
        message:
          value < def.min && def.min === 0
            ? `${def.label} cannot be negative — using 0.`
            : `${def.label} is outside the supported range (${def.min} – ${def.max}) and was limited to ${clamped}.`,
      });
      value = clamped;
    }
  }

  let low = input ? finiteOrNull(input.low) : null;
  let high = input ? finiteOrNull(input.high) : null;
  if (low !== null) low = clamp(low, def.min, def.max);
  if (high !== null) high = clamp(high, def.min, def.max);
  if (low !== null && low > value) {
    warnings.push({ code: 'range_adjusted', key, message: `${def.label}: low bound was above the expected value and was set to it.` });
    low = value;
  }
  if (high !== null && high < value) {
    warnings.push({ code: 'range_adjusted', key, message: `${def.label}: high bound was below the expected value and was set to it.` });
    high = value;
  }
  return { value, low, high, provided };
}

function normalizeFlow(
  flow: FlowInput,
  horizonMonths: number,
  warnings: SimulationWarning[],
): NormalizedFlow | null {
  const label = (flow.label || 'Untitled item').slice(0, 120);
  const amount = finiteOrNull(flow.amount);
  if (amount === null) {
    warnings.push({ code: 'missing_flow_amount', key: `flow:${flow.id}`, message: `“${label}” has no amount and was skipped.` });
    return null;
  }
  const isTime = flow.kind === 'time';
  const max = isTime ? 112 : MAX_MONEY;
  let value = amount;
  if (value < 0) {
    warnings.push({
      code: 'negative_flow',
      key: `flow:${flow.id}`,
      message: `“${label}” has a negative amount. Use the item type (income or expense) to set its direction — using 0.`,
    });
    value = 0;
  }
  if (value > max) {
    warnings.push({ code: 'clamped', key: `flow:${flow.id}`, message: `“${label}” exceeds the supported maximum and was limited.` });
    value = max;
  }
  const isOneTime = flow.kind === 'one_time_income' || flow.kind === 'one_time_expense';
  let amountMode = flow.amountMode ?? 'fixed';
  if (amountMode === 'percent_of_income' && (isOneTime || isTime)) amountMode = 'fixed';
  if (amountMode === 'percent_of_income') value = Math.min(value, 100);

  let startMonth = Math.round(finiteOrNull(flow.startMonth) ?? 0);
  if (startMonth < 0) startMonth = 0;
  if (startMonth >= horizonMonths) {
    warnings.push({ code: 'flow_outside_horizon', key: `flow:${flow.id}`, message: `“${label}” starts after the planning horizon and has no effect.` });
  }
  let endMonth = finiteOrNull(flow.endMonth ?? null);
  if (endMonth !== null) {
    endMonth = Math.round(endMonth);
    if (endMonth <= startMonth) {
      warnings.push({ code: 'flow_end_before_start', key: `flow:${flow.id}`, message: `“${label}” ends before it starts; treated as lasting one month.` });
      endMonth = startMonth + 1;
    }
  }
  const growthRaw = finiteOrNull(flow.annualGrowth ?? null);
  const annualGrowth = growthRaw === null ? null : clamp(growthRaw, -50, 100);

  let low = finiteOrNull(flow.low ?? null);
  let high = finiteOrNull(flow.high ?? null);
  if (low !== null) low = clamp(Math.min(low, value), 0, max);
  if (high !== null) high = clamp(Math.max(high, value), 0, max);

  return {
    id: flow.id,
    kind: flow.kind,
    label,
    amount: value,
    low,
    high,
    amountMode,
    startMonth,
    endMonth: isOneTime ? null : endMonth,
    annualGrowth,
  };
}

export function normalizeModel(model: ScenarioModel): NormalizedModel {
  const issues = validateModel(model);
  if (issues.length > 0) throw new EngineInputError('Invalid scenario model', issues);
  const warnings: SimulationWarning[] = [];

  let horizonYears = Math.round(model.horizonYears);
  if (horizonYears < MIN_HORIZON_YEARS || horizonYears > MAX_HORIZON_YEARS) {
    const clamped = clamp(horizonYears, MIN_HORIZON_YEARS, MAX_HORIZON_YEARS);
    warnings.push({
      code: 'horizon_clamped',
      message: `Planning horizon must be between ${MIN_HORIZON_YEARS} and ${MAX_HORIZON_YEARS} years — using ${clamped}.`,
    });
    horizonYears = clamped;
  }
  const horizonMonths = horizonYears * 12;

  const variables = {} as Record<VariableKey, NormalizedVariable>;
  for (const def of VARIABLES) {
    variables[def.key] = normalizeVariable(def.key, model.variables[def.key], warnings);
  }

  // Cross-variable checks
  if (variables.startingDebt.value > 0 && variables.debtMonthlyPayment.value <= 0) {
    warnings.push({ code: 'debt_without_payment', key: 'debtMonthlyPayment', message: 'Debt is outstanding but no monthly repayment is set — the debt (and its interest) will keep growing.' });
  }
  if (variables.propertyPrice.value > 0 && variables.propertyPurchaseMonth.value >= horizonMonths) {
    warnings.push({ code: 'purchase_outside_horizon', key: 'propertyPurchaseMonth', message: 'The property purchase falls after the planning horizon and is ignored.' });
  }

  const flows: NormalizedFlow[] = [];
  const seen = new Set<string>();
  for (const f of model.flows) {
    if (!f || typeof f !== 'object') continue;
    const id = seen.has(f.id) ? `${f.id}_${seen.size}` : f.id;
    seen.add(id);
    const n = normalizeFlow({ ...f, id }, horizonMonths, warnings);
    if (n) flows.push(n);
  }

  const fx = finiteOrNull(model.exchangeRateToBase ?? 1);
  const exchangeRateToBase = fx !== null && fx > 0 ? fx : 1;

  return {
    startDate: model.startDate,
    horizonYears,
    horizonMonths,
    currency: model.currency,
    exchangeRateToBase,
    variables,
    flows,
    warnings,
  };
}

type Direction = 'higher' | 'lower' | 'none';

function bound(v: { value: number; low: number | null; high: number | null }, polarity: Direction, which: CaseName): number {
  if (which === 'expected' || polarity === 'none') return v.value;
  const favourHigh = (polarity === 'higher') === (which === 'best');
  return favourHigh ? (v.high ?? v.value) : (v.low ?? v.value);
}

export function flowPolarity(kind: NormalizedFlow['kind']): Direction {
  if (kind === 'income' || kind === 'one_time_income') return 'higher';
  if (kind === 'expense' || kind === 'one_time_expense') return 'lower';
  return 'none';
}

/** Builds the deterministic parameter set for the expected, best or worst case. */
export function resolveCase(model: NormalizedModel, which: CaseName): ResolvedParams {
  const values = {} as Record<VariableKey, number>;
  for (const def of VARIABLES) {
    values[def.key] = bound(model.variables[def.key], def.polarity, which);
  }
  const p = values.employmentProbability / 100;
  let effectiveIncomeStart: number;
  if (which === 'expected') {
    effectiveIncomeStart = values.incomeStartMonth + (1 - p) * values.extendedSearchMonths;
  } else if (which === 'best') {
    effectiveIncomeStart = values.incomeStartMonth;
  } else {
    effectiveIncomeStart = values.incomeStartMonth + (p < 1 ? values.extendedSearchMonths : 0);
  }
  return {
    values,
    effectiveIncomeStart: Math.round(effectiveIncomeStart),
    flows: model.flows.map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      amount: bound({ value: f.amount, low: f.low, high: f.high }, flowPolarity(f.kind), which),
      amountMode: f.amountMode,
      startMonth: f.startMonth,
      endMonth: f.endMonth,
      annualGrowth: f.annualGrowth,
    })),
  };
}
