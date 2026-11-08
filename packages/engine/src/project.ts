import { HOURS_PER_WEEK, SLEEP_HOURS_PER_WEEK } from './catalog';
import type { MonthPoint, Projection, ProjectionSummary, ResolvedParams, YearPoint } from './types';
import { addMonths, annuityPayment, monthlyRate, round2 } from './util';

export interface ProjectionContext {
  startDate: string;
  horizonMonths: number;
}

/** Light-weight result used by Monte Carlo and sensitivity runs. */
export interface ProjectionCore {
  yearEndNetWorth: number[];
  finalNetWorth: number;
  minCash: number;
  startingNetWorth: number;
}

interface MonthState {
  cash: number;
  investments: number;
  debt: number;
  propertyValue: number;
  mortgageBalance: number;
  owned: boolean;
  mortgagePayment: number;
}

/**
 * Runs a single deterministic month-by-month projection.
 *
 * Order of operations within a month (documented in docs/SIMULATION.md):
 *  1. salary (after the effective income start), taxes
 *  2. recurring and one-time flows
 *  3. housing (stops once a property is owned) and living costs, inflated yearly
 *  4. property purchase / mortgage / ownership costs
 *  5. debt interest and repayment
 *  6. interest on positive cash, then investment contribution (only from available cash)
 *  7. investment growth
 */
export function project(params: ResolvedParams, ctx: ProjectionContext, record: true): Projection;
export function project(params: ResolvedParams, ctx: ProjectionContext, record: false): ProjectionCore;
export function project(
  params: ResolvedParams,
  ctx: ProjectionContext,
  record: boolean,
): Projection | ProjectionCore {
  const v = params.values;
  const N = ctx.horizonMonths;

  const rInv = monthlyRate(v.investmentReturn);
  const rCash = monthlyRate(v.cashInterestRate);
  const rDebt = monthlyRate(v.debtInterestRate);
  const rProp = monthlyRate(v.propertyAppreciation);
  const inflation = v.inflationRate / 100;
  const salaryGrowth = v.incomeGrowthRate / 100;
  const taxRate = v.effectiveTaxRate / 100;
  const incomeStart = params.effectiveIncomeStart;

  const purchaseMonth = Math.round(v.propertyPurchaseMonth);
  const buys = v.propertyPrice > 0 && purchaseMonth < N;

  const s: MonthState = {
    cash: v.startingCash,
    investments: v.startingInvestments,
    debt: v.startingDebt,
    propertyValue: 0,
    mortgageBalance: 0,
    owned: false,
    mortgagePayment: 0,
  };
  const startingNetWorth = s.cash + s.investments - s.debt;

  const months: MonthPoint[] = [];
  const yearEndNetWorth: number[] = [];
  let minCash = Infinity;
  let minCashMonth = 0;
  let firstShortfall: number | null = null;
  let monthsInShortfall = 0;
  let mortgageAtPurchase: number | null = null;

  // Precompute flow growth defaults
  const flows = params.flows.map((f) => ({
    ...f,
    growth:
      f.annualGrowth !== null
        ? f.annualGrowth / 100
        : f.kind === 'expense' || f.kind === 'one_time_expense'
          ? inflation
          : 0,
  }));

  for (let t = 0; t < N; t++) {
    const yearIndex = Math.floor(t / 12);
    const inflFactor = Math.pow(1 + inflation, yearIndex);

    // 1. Salary
    const employed = t >= incomeStart;
    const grossIncome = employed ? (v.grossAnnualIncome / 12) * Math.pow(1 + salaryGrowth, yearIndex) : 0;
    const taxes = grossIncome * taxRate;
    let netIncome = grossIncome - taxes;

    // 2. Flows
    let otherExpenses = 0;
    let oneTimeExpenses = 0;
    let oneTimeIncome = 0;
    let timeCommitments = 0;
    for (const f of flows) {
      if (f.kind === 'one_time_income' || f.kind === 'one_time_expense') {
        if (t !== f.startMonth) continue;
        const amt = f.amount * Math.pow(1 + f.growth, Math.floor(f.startMonth / 12));
        if (f.kind === 'one_time_income') oneTimeIncome += amt;
        else oneTimeExpenses += amt;
        continue;
      }
      if (t < f.startMonth || (f.endMonth !== null && t >= f.endMonth)) continue;
      if (f.kind === 'time') {
        timeCommitments += f.amount;
        continue;
      }
      const yearsActive = Math.floor((t - f.startMonth) / 12);
      const amt =
        f.amountMode === 'percent_of_income'
          ? grossIncome * (f.amount / 100)
          : f.amount * Math.pow(1 + f.growth, yearsActive);
      if (f.kind === 'income') netIncome += amt;
      else otherExpenses += amt;
    }

    // 4. Property purchase happens at the start of the purchase month
    let propertyCosts = 0;
    let purchaseOutlay = 0;
    if (buys && t === purchaseMonth) {
      const price = v.propertyPrice * Math.pow(1 + rProp, purchaseMonth);
      const down = price * (v.downPaymentPct / 100);
      purchaseOutlay = down + price * (v.purchaseCostsPct / 100);
      s.propertyValue = price;
      s.mortgageBalance = price - down;
      s.owned = true;
      s.mortgagePayment = annuityPayment(s.mortgageBalance, v.mortgageRate, Math.round(v.mortgageTermYears * 12));
      mortgageAtPurchase = s.mortgagePayment;
    }

    // 3. Housing & living
    const housing = s.owned ? 0 : v.housingCostMonthly * inflFactor;
    const living = v.livingCostMonthly * inflFactor;

    if (s.owned) {
      if (t > purchaseMonth && s.mortgageBalance > 0) {
        const interest = s.mortgageBalance * (v.mortgageRate / 100 / 12);
        const payment = Math.min(s.mortgagePayment, s.mortgageBalance + interest);
        s.mortgageBalance = Math.max(0, s.mortgageBalance + interest - payment);
        if (s.mortgageBalance < 0.005) s.mortgageBalance = 0;
        propertyCosts += payment;
      }
      propertyCosts += s.propertyValue * (v.ownershipCostPct / 100 / 12);
    }

    // 5. Debt
    let debtPayments = 0;
    if (s.debt > 0) {
      const interest = s.debt * rDebt;
      const payment = Math.min(v.debtMonthlyPayment, s.debt + interest);
      s.debt = s.debt + interest - payment;
      if (s.debt < 0.005) s.debt = 0;
      debtPayments = payment;
    }

    const totalExpenses = housing + living + otherExpenses + oneTimeExpenses + propertyCosts + debtPayments + purchaseOutlay;
    const netCashFlow = netIncome + oneTimeIncome - totalExpenses;

    // 6. Cash interest, cash flow, investment contribution
    if (s.cash > 0) s.cash += s.cash * rCash;
    s.cash += netCashFlow;
    // Invest from surplus: skip months that run at a loss unless cash already covers
    // six months of recurring costs, and never invest money that is not there.
    const recurring = housing + living + otherExpenses + propertyCosts + debtPayments;
    const canInvest = netCashFlow > 0 || s.cash > recurring * 6;
    const contribution = canInvest ? Math.max(0, Math.min(v.monthlyInvestment, s.cash)) : 0;
    s.cash -= contribution;

    // 7. Investment growth (on the balance before this month's contribution)
    const investmentGrowth = s.investments * rInv;
    s.investments = Math.max(0, s.investments + investmentGrowth + contribution);

    if (s.owned && t >= purchaseMonth) s.propertyValue *= 1 + rProp;

    const netWorth = s.cash + s.investments + s.propertyValue - s.mortgageBalance - s.debt;

    if (s.cash < minCash) {
      minCash = s.cash;
      minCashMonth = t;
    }
    if (s.cash < 0) {
      monthsInShortfall++;
      if (firstShortfall === null) firstShortfall = t;
    }
    if (t % 12 === 11) yearEndNetWorth.push(netWorth);

    if (record) {
      const workHours = employed ? v.workHoursPerWeek + v.commuteHoursPerWeek : 0;
      const free = Math.max(0, HOURS_PER_WEEK - SLEEP_HOURS_PER_WEEK - workHours - timeCommitments);
      months.push({
        t,
        date: addMonths(ctx.startDate, t),
        grossIncome: round2(grossIncome),
        taxes: round2(taxes),
        netIncome: round2(netIncome + oneTimeIncome),
        housing: round2(housing),
        living: round2(living),
        otherExpenses: round2(otherExpenses),
        oneTimeExpenses: round2(oneTimeExpenses + purchaseOutlay),
        oneTimeIncome: round2(oneTimeIncome),
        propertyCosts: round2(propertyCosts),
        debtPayments: round2(debtPayments),
        totalExpenses: round2(totalExpenses),
        netCashFlow: round2(netCashFlow),
        investmentContribution: round2(contribution),
        investmentGrowth: round2(investmentGrowth),
        cash: round2(s.cash),
        investments: round2(s.investments),
        propertyValue: round2(s.propertyValue),
        mortgageBalance: round2(s.mortgageBalance),
        debt: round2(s.debt),
        netWorth: round2(netWorth),
        realNetWorth: round2(netWorth / Math.pow(1 + inflation, (t + 1) / 12)),
        freeHoursPerWeek: round2(free),
      });
    }
  }

  if (!record) {
    return {
      yearEndNetWorth,
      finalNetWorth: yearEndNetWorth[yearEndNetWorth.length - 1] ?? startingNetWorth,
      minCash: minCash === Infinity ? s.cash : minCash,
      startingNetWorth,
    };
  }

  const years = aggregateYears(months);
  const summary = summarize(months, years, {
    startingNetWorth,
    minCash: minCash === Infinity ? 0 : minCash,
    minCashMonth,
    firstShortfall,
    monthsInShortfall,
    effectiveIncomeStart: incomeStart,
    mortgagePayment: mortgageAtPurchase,
    startingCash: v.startingCash,
  });
  return { months, years, summary };
}

function aggregateYears(months: MonthPoint[]): YearPoint[] {
  const years: YearPoint[] = [];
  for (let y = 0; y * 12 < months.length; y++) {
    const slice = months.slice(y * 12, y * 12 + 12);
    const last = slice[slice.length - 1]!;
    const sum = (k: keyof MonthPoint) => round2(slice.reduce((acc, m) => acc + (m[k] as number), 0));
    years.push({
      year: y,
      label: last.date.slice(0, 4),
      endDate: last.date,
      grossIncome: sum('grossIncome'),
      taxes: sum('taxes'),
      netIncome: sum('netIncome'),
      totalExpenses: sum('totalExpenses'),
      netCashFlow: sum('netCashFlow'),
      investmentContribution: sum('investmentContribution'),
      investmentGrowth: sum('investmentGrowth'),
      cash: last.cash,
      investments: last.investments,
      propertyValue: last.propertyValue,
      mortgageBalance: last.mortgageBalance,
      debt: last.debt,
      netWorth: last.netWorth,
      realNetWorth: last.realNetWorth,
      avgFreeHoursPerWeek: round2(slice.reduce((a, m) => a + m.freeHoursPerWeek, 0) / slice.length),
    });
  }
  return years;
}

function summarize(
  months: MonthPoint[],
  years: YearPoint[],
  extra: {
    startingNetWorth: number;
    minCash: number;
    minCashMonth: number;
    firstShortfall: number | null;
    monthsInShortfall: number;
    effectiveIncomeStart: number;
    mortgagePayment: number | null;
    startingCash: number;
  },
): ProjectionSummary {
  const last = months[months.length - 1]!;
  const y1 = months.slice(0, 12);
  const total = (k: keyof MonthPoint, list = months) => list.reduce((a, m) => a + (m[k] as number), 0);
  const y1Income = total('netIncome', y1);
  const y1Expenses = total('totalExpenses', y1);
  const y1Recurring = y1Expenses - total('oneTimeExpenses', y1);
  const y1Flow = total('netCashFlow', y1);
  const avgRecurring = y1Recurring / y1.length;
  return {
    startingNetWorth: round2(extra.startingNetWorth),
    finalNetWorth: last.netWorth,
    finalRealNetWorth: last.realNetWorth,
    finalCash: last.cash,
    finalInvestments: last.investments,
    finalPropertyEquity: round2(last.propertyValue - last.mortgageBalance),
    totalGrossIncome: round2(total('grossIncome')),
    totalNetIncome: round2(total('netIncome')),
    totalTaxes: round2(total('taxes')),
    totalExpenses: round2(total('totalExpenses')),
    totalInvestmentGrowth: round2(total('investmentGrowth')),
    oneTimeCostsTotal: round2(total('oneTimeExpenses')),
    upfrontCost: round2(total('oneTimeExpenses', y1)),
    avgMonthlyNetIncomeYear1: round2(y1Income / y1.length),
    avgMonthlyExpensesYear1: round2(y1Expenses / y1.length),
    avgMonthlyNetCashFlowYear1: round2(y1Flow / y1.length),
    savingsRateYear1: y1Income > 0 ? round2(((y1Income - y1Recurring) / y1Income) * 100) : null,
    lowestCash: round2(extra.minCash),
    lowestCashMonth: extra.minCashMonth,
    firstShortfallMonth: extra.firstShortfall,
    monthsInShortfall: extra.monthsInShortfall,
    startingRunwayMonths: avgRecurring > 0 ? round2(Math.max(0, extra.startingCash) / avgRecurring) : null,
    avgFreeHoursPerWeek: round2(total('freeHoursPerWeek') / months.length),
    avgFreeHoursPerWeekYear1: years[0]?.avgFreeHoursPerWeek ?? 0,
    effectiveIncomeStart: extra.effectiveIncomeStart,
    monthlyMortgagePayment: extra.mortgagePayment === null ? null : round2(extra.mortgagePayment),
  };
}
