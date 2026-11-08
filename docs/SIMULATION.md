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
