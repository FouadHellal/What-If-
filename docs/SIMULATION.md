# Simulation engine

`packages/engine` is a pure TypeScript library with no dependencies, I/O, clock or global randomness. `simulate(model, options)` is a deterministic function: the same inputs always produce exactly the same output. It runs in the browser for instant feedback and on the server for stored, reproducible runs.

## Inputs

A **scenario model** contains:

- `startDate` (`YYYY-MM`), `horizonYears` (1–50) and `currency` (ISO 4217).
- **Variables**: a fixed catalogue of named inputs (`catalog.ts`). Each has a value, an optional low/high range, a source (`user`, `ai`, `external`, `system`) and a note.
- **Flows**: one-off or recurring income and expenses, and time commitments, each with a start month, an optional end month, a growth rate and an optional range.

The exchange rate to the decision's base currency is stored with the scenario. It is used only by the comparison layer, never inside a projection.

### Missing values

A variable without a value uses its catalogue fallback. Where the fallback is a genuine assumption (for example 2.5 % inflation), it is labelled *Default*. Where the variable needs real input (salary, tax rate, living costs), it is treated as 0 and the engine emits a `missing_value` warning, which the UI shows as *Needs input*. The engine never invents an important number.

### Validation

Structural problems (invalid month, currency or horizon type) throw `EngineInputError`. Everything else is repaired and reported as a warning:

- values outside a variable's range are clamped;
- negative expenses become 0;
- inverted ranges are corrected;
- flows outside the horizon are flagged;
- horizons above 50 years are limited to 50.

## Month-by-month projection

For each month *t* = 0 … N−1 (N = 12 × horizon), in this order:

1. **Salary.** If *t* ≥ effective income start:
   gross = annual salary ÷ 12 × (1 + salary growth)^⌊t/12⌋.
   Tax = gross × effective tax rate. Net salary = gross − tax.
2. **Flows.** One-off items apply in their month. Recurring items apply from their start month until (but not including) their end month, growing yearly by their own rate. If no rate is set, expenses grow with inflation and income stays flat. Items can also be a percentage of gross salary. Extra income items are treated as after-tax.
3. **Property purchase** (if a price is set). It happens at the start of the purchase month, at today's price grown by property appreciation. Cash pays the down payment and purchase costs; the remainder becomes an annuity mortgage. Rent stops from that month.
4. **Housing and living costs**, inflated once per scenario year.
5. **Mortgage and ownership.** From the month after purchase, mortgage interest and principal are paid (standard annuity). Ownership costs are a yearly percentage of the current property value, charged monthly.
6. **Debt.** Monthly interest accrues and the repayment is applied until the debt is cleared.
7. **Cash.** Positive cash earns the cash interest rate, then the month's net cash flow is added.
8. **Investing.** The monthly investment moves from cash into investments only if the month ran a surplus or cash already covers six months of recurring costs, and never beyond the cash available. Investments compound monthly at (1 + annual return)^(1/12) − 1.
9. **Net worth** = cash + investments + property value − mortgage − debt. **In today's money** = net worth ÷ (1 + inflation)^((t+1)/12).
10. **Free time** = 168 − 56 (sleep) − (work + commute while employed) − time commitments, in hours per week.

Negative cash is a *shortfall*: the engine records when it starts and how deep it gets, and does not apply overdraft interest.

### Employment risk

With probability *p* of landing the job and *e* extra search months if it falls through:

- **Expected case**: salary starts at *start + (1 − p) × e* (rounded to whole months).
- **Best case**: salary starts at the favourable end of the start range.
- **Worst case**: salary starts at the unfavourable end of the start range, plus *e* months.
- **Monte Carlo**: each run draws success with probability *p*.

## Cases

Each variable has a **polarity**: higher is better (salary), lower is better (costs), or none (choices such as working hours). The **best case** sets every ranged input to its favourable bound at the same time, and the **worst case** sets every one to its unfavourable bound. Both are deliberately extreme envelopes, not likely outcomes.

## Uncertainty (Monte Carlo)

Using a seeded PRNG (mulberry32; the default seed is stored with every run), the engine runs 500 variations. Each ranged input is drawn from a triangular distribution (low, expected, high). Each variable consumes a fixed number of random draws, so adding a range to one input does not reshuffle the others. The outputs are:

- yearly net-worth percentiles (P5, P10, P25, P50, P75, P90, P95);
- the share of runs in which cash fell below zero (*shortfall probability*);
- the share of runs that ended below the starting net worth.

If no input has a range and employment is certain, the band collapses to the expected line.

## Sensitivity

This is a one-at-a-time analysis: each input moves to its low and then its high value while all others stay at their expected values, and the change in final net worth is recorded. Inputs without a range use a standard spread (±10 % for amounts, ±1–3 points for rates, ±2 months for delays). The results are sorted by swing, and the top 12 are kept.

## Milestones

Derived from the expected case:

- the scenario start;
- one-off items;
- salary start;
- recurring items starting and ending;
- the property purchase;
- mortgage paid off and debt cleared;
- a six-month safety buffer reached;
- the first cash shortfall;
- the two highest net-worth thresholds crossed;
- the end of the horizon.

## Insights

Rule-based and fully deterministic (`deriveInsights`):

- **Risks**: cash shortfall (expected, worst case or ≥ 10 % probability), a negative first year, upfront cost above 50 % of savings, a thin runway before income starts, employment probability under 75 %, a mortgage above 35 % of net income, debt growing, an outcome hinging on one input, and a wide outcome range.
- **Opportunities**: a savings rate of 20 % or more, compounding contributing more than 20 % of final net worth, idle surplus cash, and meaningful upside.
- **Gaps**: missing important assumptions.

## Comparison

`compareScenarios` converts each scenario with its own exchange rate, never mutates its inputs, and aligns scenarios on calendar months, so different start dates and horizons can be compared. It reports:

- metrics such as final net worth, real value, best/worst, P10/P90, upfront cost, year-one cash flow, lowest cash, shortfall probability and free time;
- the leader for each metric;
- the difference against the baseline;
- the month from which an alternative stays ahead of the baseline;
- a priority-fit score.

**Priority fit** = Σ weight × (score − 1) ÷ Σ weight × 4, where scores are 1–5 per factor, weights are 0–5 and unscored factors are ignored.

## Reproducibility

`hashInputs` produces a stable hash (sorted-key serialisation) of the engine version, model, seed and run count. The server stores every run with its full input snapshot, and runs are immutable. `POST /api/runs/:id/verify` re-executes the stored inputs and confirms that the result is identical.

---

## Engine 2.0 additions

### More events in the projection
- **Salary change** (flow kind `salary_change`): from its start month (until its end month, if set) the gross salary becomes the given annual amount, growing by the flow's own rate or the general salary growth. It is taxed like the base salary.
- **Income gap** (`income_gap`): no salary between its start and end month, for example for a career break, full-time study or retraining.
- **Loan** (`loan`): the principal arrives as cash in its start month and is repaid from the next month as an annuity at `rate` over `termMonths` (60 if not set). The outstanding balance counts as debt.
- **Progressive tax**: when the scenario has a schedule, monthly tax = bracket tax on (monthly gross × 12) ÷ 12, applied bracket by bracket after the allowance, plus flat social contributions. Without a schedule, the effective rate applies as before.
- **Rent increases** (`housingGrowthRate`): rent grows at this rate when it is set. Otherwise it follows the inflation path.
- **Unexpected expenses**: the deterministic cases add the expected cost (events per year × average size ÷ 12, inflated). The simulations draw actual events.
- **Job-loss risk**: the deterministic cases scale salary by 1 − p × min(months, 12) ÷ 12. The simulations draw actual interruptions.
- **Emergency fund target**: replaces the fixed six months, both for the milestone and for the rule that pauses investing in loss-making months.

### Uncertainty model 2.0
Each run draws from five independent, seeded streams: parameters, markets, employment, shocks and flows. Each stream is derived from (seed, stream, run). Every scenario of a decision uses the same seed, so run *k* of every scenario sees the same market path and the same parameter quantiles. These are **common random numbers**, and they make it valid to compare scenarios future by future.

- **Parameters**: one standard normal per catalogue variable (a fixed count). The documented correlations are applied with a Cholesky factor (a Gaussian copula). Each value is then mapped to its triangular distribution (low, expected, high):

  | Pair | ρ |
  |---|---|
  | inflation · salary growth | 0.5 |
  | inflation · rent increases | 0.6 |
  | inflation · living costs | 0.3 |
  | inflation · property growth | 0.4 |
  | housing cost · living costs | 0.4 |
  | salary · housing cost | 0.3 |
  | property growth · rent increases | 0.5 |

  Choosing *Treat inputs as independent* turns the correlations off.
- **Markets**: yearly investment returns are lognormal with the chosen mean and volatility, so E[1+R] matches the mean. Yearly inflation is normal around the sampled mean, with the chosen variability.
- **Employment**: first, whether the expected job materialises (otherwise the extra search months apply). Then, each year, a job loss with the chosen probability, starting in a random month and lasting the chosen number of months.
- **Shocks**: a Poisson number of events per year (capped at 6), each with an exponentially distributed size (capped at 10 × the average) in a random month.
- **Goals**: the share of runs meeting each goal (net worth ≥ target at a month, or cash never below a floor).

Reported: per-year P5–P95, final P5–P95, shortfall and loss probabilities, per-run final net worth (`samples`), and the methodology used.

### Analysis (`analysis.ts`)
- **Break-even**: compares net worth month by month on the shared calendar. It reports the first month from which the alternative stays ahead, the deepest deficit and when it occurs, the advantage at the common end, and the average monthly gain over the last year.
- **Parity solver**: bisection on the deterministic model finds the value of one input (a variable or a flow amount) at which two scenarios end level at their last common month, in the base currency. It returns null when no crossing exists in a sensible range.
- **What would change my mind**: runs the solver for the top sensitivity inputs of the expected leader (inputs that could make it lose) and of each rival (inputs that could make it win), sorted by distance from the current value. Exchange-rate parity is solved in closed form.
- **Robustness**: needs equal seeds and run counts. For each scenario it computes:
  - win probability (share of futures in which it ends highest);
  - expected regret and P90 regret (how far behind the best scenario it ends in each future);
  - P10 to P90.

  It then assigns these labels:
  - *Consistent*: wins in at least 60 % of futures.
  - *Needs favourable assumptions*: it is the expected leader but wins in under 50 %, or its median is more than 15 % below its expected case.
  - *Vulnerable*: shortfall or loss probability of 25 % or more.
  - *Highest upside*: the highest P90.
  - *Lowest downside*: the highest P10.
- **Life quality**: score = Σ weight·(rating − 1) ÷ Σ weight·4 × 100, over rated dimensions only (10 dimensions; v1 factors are mapped). Priority sensitivity searches each dimension's weight outward from its current value for the smallest change that alters the leader.
