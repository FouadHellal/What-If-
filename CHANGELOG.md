# Changelog

## 2.0.0 — Decision intelligence

A substantial upgrade of the simulation engine, plus a new analysis layer and a refined workspace. See `docs/AUDIT-V2.md` for the review behind it.

### Simulation engine 2.0
- **Career and money events**: salary changes from a given month (taxed), periods without salary, and loans with interest and a repayment term.
- **Tax**: optional progressive brackets that you define, with an allowance and flat social contributions. No tax tables ship with What-If.
- **Living costs**: rent increases separate from inflation, expected unexpected expenses, and a configurable emergency-fund target.
- **Employment risk**: a yearly job-loss probability with an unemployment duration, on top of the existing job-search risk.
- **Uncertainty**:
  - Investment returns (lognormal) and inflation now vary year by year.
  - Documented correlations between inputs (Gaussian copula), which you can switch off.
  - Unexpected expenses follow a Poisson process.
  - Up to 5,000 simulated futures.
- **Common random numbers**: a decision's scenarios share the same simulated futures, so results such as "A beats B in 72 % of futures" are meaningful.
- **Goals**: the probability of reaching a net-worth target by a date, or of never running out of cash.
- Results now report P10, P25, P50, P75 and P90, per-run samples, and the methodology used.

### Decision intelligence
- A new **Summary** tab compares three different leaders: highest expected outcome, most robust, and best fit with your priorities.
- **Robustness**: how often each scenario leads across the shared futures, its average regret and its downside, plus labels such as "needs favourable assumptions" or "lowest downside".
- **Break-even**: when an alternative catches up with the baseline, its deepest deficit along the way, and its monthly gain afterwards.
- **What would change the outcome**: exact thresholds (salary, rent, tax, costs, exchange rates) solved from the model.
- Failure modes, commitments that are hard to undo, a checklist of commonly overlooked costs, and a ranked list of what to research before deciding.
- **Life quality**: 10 dimensions with per-decision weights and a contribution breakdown, plus the smallest change of priority that would change the best fit.

### Decision Lab
- Vary the most influential inputs with sliders and get an instant comparison against the original. Saved experiments keep their exact inputs and results.
- You can apply an experiment in place (guarded against overwriting newer edits) or save it as a new scenario.

### AI analyst
- A conversational analyst grounded in stored runs, the Summary analysis, your evidence and the decision's memory.
- Every statement is labelled as calculated, your input, evidence, model analysis or AI interpretation. Figures that can't be traced to your data are flagged.
- Decision memory (objectives, constraints, risk stance and confirmed facts) is visible and editable. Facts the analyst suggests are saved only when you confirm them.

### Evidence
- An evidence locker for cited figures (source, date, coverage, reliability).
- Optional lookups: ECB exchange rates (via Frankfurter) and World Bank inflation. Only a currency pair or country code leaves the server. Turn lookups off with `EXTERNAL_DATA=off`.
- Evidence never changes a scenario unless you use it, and it is then labelled "External data" with its source.

### Product
- Question-first welcome; the baseline profile is now optional and progressive.
- The overview shows what needs attention: missing inputs, check-ins due, decisions ready to decide, stale decisions. It also lists recent experiments and saved reports, and shows how complete your profile is.
- A template library grouped by Career, Financial, Lifestyle and Education, with six new decision types: job offer, paying off debt, major purchase, working hours, university or self-study, and certification.
- An at-a-glance strip above every workspace tab, and nested P10–P90 / P25–P75 bands on charts.
- Simulations run in a Web Worker. The main bundle shrank from 359 kB to 49 kB.

### Upgrade notes
- Migration `0001` is additive and runs automatically.
- Runs stored by engine 1.0 stay readable. New runs use engine 2.0, so verifying an old run reports the version difference.

## 1.0.0
- Initial release.
