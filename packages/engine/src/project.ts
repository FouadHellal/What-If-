import { HOURS_PER_WEEK, SLEEP_HOURS_PER_WEEK } from './catalog';
import { bracketTax } from './tax';
import type { MonthPoint, Projection, ProjectionSummary, ResolvedParams, YearPoint } from './types';
import { addMonths, annuityPayment, monthlyRate, round2 } from './util';

export interface ProjectionContext {
  startDate: string;
  horizonMonths: number;
  /** Month indexes at which to capture net worth in light-weight runs (for goals). */
  checkpoints?: number[];
}

/** Light-weight result used by Monte Carlo, sensitivity and solver runs. */
export interface ProjectionCore {
  yearEndNetWorth: number[];
  finalNetWorth: number;
  minCash: number;
  startingNetWorth: number;
  checkpointNetWorth: number[];
}

interface Loan {
  balance: number;
  payment: number;
  rate: number;
  startMonth: number;
}

/**
 * Runs a single deterministic month-by-month projection.
 *
 * Order of operations within a month (documented in docs/SIMULATION.md):
 *  1. salary (base, salary changes, income gaps, job-loss interruptions) and tax
 *  2. recurring and one-time flows; loans disbursed
 *  3. property purchase, then housing (stops once owned) and living costs
 *  4. mortgage, ownership costs, debt and loan repayments
 *  5. unexpected expenses
 *  6. interest on positive cash, cash flow, investment contribution
 *  7. investment growth
 */
export function project(params: ResolvedParams, ctx: ProjectionContext, record: true): Projection;
export function project(params: ResolvedParams, ctx: ProjectionContext, record: false): ProjectionCore;
export function project(params: ResolvedParams, ctx: ProjectionContext, record: boolean): Projection | ProjectionCore {
  const v = params.values;
  const N = ctx.horizonMonths;
  const years = Math.ceil(N / 12);
  const st = params.stochastic;

  const rCash = monthlyRate(v.cashInterestRate);
  const rDebt = monthlyRate(v.debtInterestRate);
  const rProp = monthlyRate(v.propertyAppreciation);
  const meanInflation = v.inflationRate / 100;
  const salaryGrowth = v.incomeGrowthRate / 100;
  const flatTax = v.effectiveTaxRate / 100;
  const incomeStart = params.effectiveIncomeStart;
  const efMonths = v.emergencyFundMonths;

  // Year-indexed paths. The deterministic cases use constant expected values.
  const inflationPath = new Array<number>(years);
  const returnMonthly = new Array<number>(years);
  for (let y = 0; y < years; y++) {
    inflationPath[y] = st ? (st.inflation[y] ?? meanInflation) : meanInflation;
    returnMonthly[y] = monthlyRate((st ? (st.returns[y] ?? v.investmentReturn / 100) : v.investmentReturn / 100) * 100);
  }
  // Cumulative price level at the start of each year (year 0 = 1).
  const priceLevel = new Array<number>(years + 1);
  priceLevel[0] = 1;
  for (let y = 0; y < years; y++) priceLevel[y + 1] = priceLevel[y]! * (1 + inflationPath[y]!);
  const rentGrowth = params.housingGrowthSet ? v.housingGrowthRate / 100 : null;

  // Expected-value adjustments used only in deterministic cases.
  const jobLossFactor = st ? 1 : Math.max(0, 1 - (v.jobLossProbability / 100) * (Math.min(v.unemploymentMonths, 12) / 12));
  const expectedShockMonthly = st ? 0 : (v.unexpectedExpenseRate * v.unexpectedExpenseSize) / 12;

  const purchaseMonth = Math.round(v.propertyPurchaseMonth);
  const buys = v.propertyPrice > 0 && purchaseMonth < N;

  let cash = v.startingCash;
  let investments = v.startingInvestments;
  let debt = v.startingDebt;
  let propertyValue = 0;
  let mortgageBalance = 0;
  let owned = false;
  let mortgagePayment = 0;
  const loans: Loan[] = [];
  const startingNetWorth = cash + investments - debt;

  const months: MonthPoint[] = [];
  const yearEndNetWorth: number[] = [];
  const checkpoints = ctx.checkpoints ?? [];
  const checkpointNetWorth = new Array<number>(checkpoints.length).fill(Number.NaN);
  let minCash = Infinity;
  let minCashMonth = 0;
  let firstShortfall: number | null = null;
  let monthsInShortfall = 0;
  let mortgageAtPurchase: number | null = null;
  let efReached: number | null = null;
  let taxYear1 = 0;
  let grossYear1 = 0;

  const flows = params.flows.map((f) => ({
    ...f,
    growth:
      f.annualGrowth !== null
        ? f.annualGrowth / 100
        : f.kind === 'expense' || f.kind === 'one_time_expense'
          ? null // follow inflation path
          : f.kind === 'salary_change'
            ? salaryGrowth
            : 0,
  }));
  const salaryChanges = flows.filter((f) => f.kind === 'salary_change').sort((a, b) => a.startMonth - b.startMonth);
  const incomeGaps = flows.filter((f) => f.kind === 'income_gap');

  const taxOn = (monthlyGross: number): number => {
    if (monthlyGross <= 0) return 0;
    if (params.tax && params.tax.brackets.length > 0) return bracketTax(monthlyGross * 12, params.tax) / 12;
    return monthlyGross * flatTax;
  };

  for (let t = 0; t < N; t++) {
    const yearIndex = Math.floor(t / 12);
    const yearFrac = (t % 12) / 12;
    const inflFactor = priceLevel[yearIndex]!;

    // 1. Salary
    let grossIncome = 0;
    const inGap = incomeGaps.some((g) => t >= g.startMonth && (g.endMonth === null || t < g.endMonth)) || (st?.gaps.some(([a, b]) => t >= a && t < b) ?? false);
    if (!inGap) {
      let change: (typeof salaryChanges)[number] | undefined;
      for (const c of salaryChanges) if (t >= c.startMonth && (c.endMonth === null || t < c.endMonth)) change = c;
      if (change) {
        grossIncome = (change.amount / 12) * Math.pow(1 + (change.growth ?? 0), Math.floor((t - change.startMonth) / 12));
      } else if (t >= incomeStart) {
        grossIncome = (v.grossAnnualIncome / 12) * Math.pow(1 + salaryGrowth, yearIndex);
      }
      grossIncome *= jobLossFactor;
    }
    const taxes = taxOn(grossIncome);
    if (yearIndex === 0) {
      taxYear1 += taxes;
      grossYear1 += grossIncome;
    }
    let netIncome = grossIncome - taxes;

    // 2. Flows
    let otherExpenses = 0;
    let oneTimeExpenses = 0;
    let oneTimeIncome = 0;
    let timeCommitments = 0;
    for (const f of flows) {
      if (f.kind === 'salary_change' || f.kind === 'income_gap') continue;
      if (f.kind === 'loan') {
        if (t === f.startMonth && f.amount > 0) {
          oneTimeIncome += f.amount;
          loans.push({ balance: f.amount, payment: annuityPayment(f.amount, f.rate ?? 0, f.termMonths ?? 60), rate: (f.rate ?? 0) / 100 / 12, startMonth: f.startMonth });
        }
        continue;
      }
      const growthFactor = (fromMonth: number) => (f.growth === null ? priceLevel[Math.floor(t / 12)]! / priceLevel[Math.floor(fromMonth / 12)]! : Math.pow(1 + f.growth, Math.floor((t - fromMonth) / 12)));
      if (f.kind === 'one_time_income' || f.kind === 'one_time_expense') {
        if (t !== f.startMonth) continue;
        const amt = f.amount * (f.growth === null ? priceLevel[Math.floor(f.startMonth / 12)]! : Math.pow(1 + f.growth, Math.floor(f.startMonth / 12)));
        if (f.kind === 'one_time_income') oneTimeIncome += amt;
        else oneTimeExpenses += amt;
        continue;
      }
      if (t < f.startMonth || (f.endMonth !== null && t >= f.endMonth)) continue;
      if (f.kind === 'time') {
        timeCommitments += f.amount;
        continue;
      }
      const amt = f.amountMode === 'percent_of_income' ? grossIncome * (f.amount / 100) : f.amount * growthFactor(f.startMonth);
      if (f.kind === 'income') netIncome += amt;
      else otherExpenses += amt;
    }

    // 3. Property purchase happens at the start of the purchase month
    let propertyCosts = 0;
    let purchaseOutlay = 0;
    if (buys && t === purchaseMonth) {
      const price = v.propertyPrice * Math.pow(1 + rProp, purchaseMonth);
      const down = price * (v.downPaymentPct / 100);
      purchaseOutlay = down + price * (v.purchaseCostsPct / 100);
      propertyValue = price;
      mortgageBalance = price - down;
      owned = true;
      mortgagePayment = annuityPayment(mortgageBalance, v.mortgageRate, Math.round(v.mortgageTermYears * 12));
      mortgageAtPurchase = mortgagePayment;
    }

    const rentFactor = rentGrowth === null ? inflFactor : Math.pow(1 + rentGrowth, yearIndex);
    const housing = owned ? 0 : v.housingCostMonthly * rentFactor;
    const living = v.livingCostMonthly * inflFactor;

    // 4. Mortgage, ownership, debt, loans
    if (owned) {
      if (t > purchaseMonth && mortgageBalance > 0) {
        const interest = mortgageBalance * (v.mortgageRate / 100 / 12);
        const payment = Math.min(mortgagePayment, mortgageBalance + interest);
        mortgageBalance = Math.max(0, mortgageBalance + interest - payment);
        if (mortgageBalance < 0.005) mortgageBalance = 0;
        propertyCosts += payment;
      }
      propertyCosts += propertyValue * (v.ownershipCostPct / 100 / 12);
    }
    let debtPayments = 0;
    if (debt > 0) {
      const interest = debt * rDebt;
      const payment = Math.min(v.debtMonthlyPayment, debt + interest);
      debt = debt + interest - payment;
      if (debt < 0.005) debt = 0;
      debtPayments = payment;
    }
    for (const l of loans) {
      if (t <= l.startMonth || l.balance <= 0) continue;
      const interest = l.balance * l.rate;
      const payment = Math.min(l.payment, l.balance + interest);
      l.balance = l.balance + interest - payment;
      if (l.balance < 0.005) l.balance = 0;
      debtPayments += payment;
    }
    const loanBalance = loans.reduce((a, l) => a + l.balance, 0);

    // 5. Unexpected expenses
    const unexpectedExpenses = (st ? (st.shocks.get(t) ?? 0) : expectedShockMonthly) * inflFactor;

    const totalExpenses = housing + living + otherExpenses + oneTimeExpenses + propertyCosts + debtPayments + purchaseOutlay + unexpectedExpenses;
    const netCashFlow = netIncome + oneTimeIncome - totalExpenses;

    // 6. Cash interest, cash flow, investment contribution
    if (cash > 0) cash += cash * rCash;
    cash += netCashFlow;
    const recurring = housing + living + otherExpenses + propertyCosts + debtPayments;
    const canInvest = netCashFlow > 0 || cash > recurring * efMonths;
    const contribution = canInvest ? Math.max(0, Math.min(v.monthlyInvestment, cash)) : 0;
    cash -= contribution;

    // 7. Investment growth (on the balance before this month's contribution)
    const investmentGrowth = investments * returnMonthly[yearIndex]!;
    investments = Math.max(0, investments + investmentGrowth + contribution);

    if (owned && t >= purchaseMonth) propertyValue *= 1 + rProp;

    const totalDebt = debt + loanBalance;
    const netWorth = cash + investments + propertyValue - mortgageBalance - totalDebt;

    if (cash < minCash) {
      minCash = cash;
      minCashMonth = t;
    }
    if (cash < 0) {
      monthsInShortfall++;
      if (firstShortfall === null) firstShortfall = t;
    }
    if (efReached === null && recurring > 0 && cash >= recurring * efMonths && t > 0) efReached = t;
    if (t % 12 === 11) yearEndNetWorth.push(netWorth);
    for (let i = 0; i < checkpoints.length; i++) if (checkpoints[i] === t) checkpointNetWorth[i] = netWorth;

    if (record) {
      const workHours = grossIncome > 0 ? v.workHoursPerWeek + v.commuteHoursPerWeek : 0;
      const free = Math.max(0, HOURS_PER_WEEK - SLEEP_HOURS_PER_WEEK - workHours - timeCommitments);
      const deflator = priceLevel[yearIndex]! * Math.pow(1 + inflationPath[yearIndex]!, yearFrac + 1 / 12);
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
        unexpectedExpenses: round2(unexpectedExpenses),
        totalExpenses: round2(totalExpenses),
        netCashFlow: round2(netCashFlow),
        investmentContribution: round2(contribution),
        investmentGrowth: round2(investmentGrowth),
        cash: round2(cash),
        investments: round2(investments),
        propertyValue: round2(propertyValue),
        mortgageBalance: round2(mortgageBalance),
        debt: round2(totalDebt),
        netWorth: round2(netWorth),
        realNetWorth: round2(netWorth / deflator),
        freeHoursPerWeek: round2(free),
      });
    }
  }

  if (!record) {
    return {
      yearEndNetWorth,
      finalNetWorth: yearEndNetWorth[yearEndNetWorth.length - 1] ?? startingNetWorth,
      minCash: minCash === Infinity ? cash : minCash,
      startingNetWorth,
      checkpointNetWorth,
    };
  }

  const yearsAgg = aggregateYears(months);
  const summary = summarize(months, yearsAgg, {
    startingNetWorth,
    minCash: minCash === Infinity ? 0 : minCash,
    minCashMonth,
    firstShortfall,
    monthsInShortfall,
    effectiveIncomeStart: incomeStart,
    mortgagePayment: mortgageAtPurchase,
    startingCash: v.startingCash,
    taxRateYear1: grossYear1 > 0 ? (taxYear1 / grossYear1) * 100 : params.tax?.brackets.length ? 0 : v.effectiveTaxRate,
    emergencyFundMonths: efMonths,
    emergencyFundReachedMonth: efReached,
  });
  return { months, years: yearsAgg, summary };
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
    taxRateYear1: number;
    emergencyFundMonths: number;
    emergencyFundReachedMonth: number | null;
  },
): ProjectionSummary {
  const last = months[months.length - 1]!;
  const y1 = months.slice(0, 12);
  const total = (k: keyof MonthPoint, list = months) => list.reduce((a, m) => a + (m[k] as number), 0);
  const y1Income = total('netIncome', y1) - total('oneTimeIncome', y1);
  const y1Expenses = total('totalExpenses', y1);
  const y1Recurring = y1Expenses - total('oneTimeExpenses', y1) - total('unexpectedExpenses', y1);
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
    effectiveTaxRateYear1: round2(extra.taxRateYear1),
    emergencyFundMonths: extra.emergencyFundMonths,
    emergencyFundReachedMonth: extra.emergencyFundReachedMonth,
  };
}
