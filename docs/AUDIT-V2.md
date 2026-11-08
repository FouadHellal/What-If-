# Product audit (v1 → v2)

An honest review of What-If v1, done before starting v2. It covers the code, the running app, screenshots of every screen in light and dark mode, and measurements. Each finding says what v2 does about it.

## Product

| Finding | Severity | v2 response |
|---|---|---|
| Results are numbers without a verdict. The Compare tab shows *what* each path yields but not *how robust* that is, *what would flip it*, or *what to find out next*. Users must interpret five tabs themselves. | High | A **Summary** tab (Decision Intelligence): the decision, alternatives, robustness classes, thresholds that would change the outcome, failure conditions, hidden costs not modelled, and what to research next. Every item is computed from the model. |
| Each scenario's uncertainty is computed in isolation. “Berlin beats Algiers in X % of futures” cannot be answered, because scenarios use unrelated random draws. | High | **Common random numbers**: separate seeded streams per factor (market, inflation, employment, shocks), shared across a decision's scenarios, so runs are comparable pairwise. This gives win probability, expected regret and downside per scenario. |
| Uncertainty model is parameter-only. Investment returns and inflation are fixed for the whole horizon in each run, which understates volatility. All inputs are independent: inflation, salary growth and living costs move unrelated. There is no job loss after hiring and no unexpected expenses. | High | Year-by-year return volatility and inflation variability. Gaussian-copula correlations (inflation ↔ salary growth ↔ costs ↔ rent). Annual job-loss risk with an unemployment duration. Poisson-distributed unexpected expenses. The methodology is documented and shown in the UI. |
| Career changes can't be modelled. There is only one salary with a start delay, so “two years in my current job, then retrain, then a new salary” is impossible. Rent always follows general inflation. New loans (student or business) can't be modelled. Tax is a single flat rate. | High | Flow types for **salary change**, **income gap** and **loan**. A separate **rent growth** rate. Optional **progressive tax brackets** you define (no built-in tax tables are presented as fact). A configurable **emergency fund** target. |
| No break-even answers (“how many months until moving pays off?”, “what salary makes it equivalent?”). | High | Break-even month, payback of upfront cost, and **equivalent-salary / maximum-rent solvers** (bisection on the deterministic model). |
| No way to explore without editing the real scenario. Every tweak overwrites it. | High | **Decision Lab**: sliders on the key assumptions, an instant diff against the original, saved experiments with full inputs and results, and apply-to-scenario or save-as-new. |
| Percentiles are shown only as P10/P90. There is no goal probability and the run count is fixed. | Medium | P10/P25/P50/P75/P90 with nested bands, decision **goals** (net worth by a date, never running out of cash), and a configurable run count (500–5,000) with the seed shown. |
| Life quality is 6 factors on 1–5 pips, shown as a single number. There's no breakdown and no answer to how priorities change the ranking. | Medium | 10 dimensions, per-decision weights, a contribution breakdown, and **priority sensitivity** (“Montréal would rank first if Family mattered ≤ 2”). Subjectivity is labelled. |
| The AI analyst offers one-shot tasks only. You can't ask follow-up questions, there's no decision memory, and no external data. | Medium | **Conversational analyst** with evidence-typed answers, a decision memory (objectives, risk stance, answered questions, feedback), and an **evidence locker** with cited external data. Built-in providers: ECB exchange rates and World Bank inflation, with source, retrieval date and coverage. Evidence never overwrites assumptions silently. |
| Onboarding forces a 4-step questionnaire before the product is usable. | Medium | Start with a question. The profile becomes optional and progressive, with contextual prompts where it helps. |
| The overview shows counts that don't lead to actions. | Medium | An action-oriented dashboard: decisions awaiting review, check-ins due, incomplete inputs, recent experiments, saved reports and decision progress. |
| Templates exist for 11 types but with no library view, no per-variable guidance, and several requested types missing (pay off debt, major purchase, working hours, study paths, certification, job offer). | Medium | A **template library** grouped by Career / Financial / Lifestyle / Education with explained inputs. |

## Design

- The workspace spreads the answer across tabs, so there is no at-a-glance strip. **v2:** a persistent decision summary strip (outcome, range, robustness label per scenario) above the tabs.
- The variable editor lists 20+ inputs at equal weight. **v2:** “key assumptions” first and advanced groups collapsed, with completeness indicators.
- Charts: a single P10–P90 band, and check-ins weren't visually distinct from projections. **v2:** nested P10–P90 / P25–P75 bands, actuals drawn as markers and labelled “Recorded”, a goal line, and units in every tooltip.
- Too many identical bordered panels in the analyst and decide views. **v2:** fewer containers, more typographic hierarchy.
- Mobile was fine but secondary. **v2:** sticky summary strip and lab sliders checked at 390 px.

## Engineering

| Finding | v2 response |
|---|---|
| Simulations run on the main thread (≈600 ms for 3 × 50-year × 5,000 runs). | Web Worker with a hash cache, so the UI keeps the previous result while recomputing. |
| Main bundle 352 KB: react-dom, zod and lucide land in the index chunk. | Chunking by vendor; zod stays out of the client path where it isn't needed. |
| No goal or robustness data is stored with runs. | Engine 2.0 stores per-run finals (for cross-scenario analysis) and percentiles. Results from engine 1.0 remain readable, and verification reports the version mismatch honestly. |
| Docker image never built locally (Docker unavailable); CI results not visible (private repo). | Still unverifiable from this machine. Documented as such; validation steps repeated without Docker. |
| Decision-level settings are scattered (priorities column only). | `decisions.settings` JSONB (runs, goals, life weights, memory), validated by zod. |

## Order of work

1. Engine 2.0 (realism, correlated and common-random-number uncertainty, goals) with tests.
2. Analysis layer: break-even, thresholds, robustness, life quality, decision intelligence.
3. Server: settings, experiments, evidence and research providers, AI conversation and memory.
4. Workspace redesign: summary strip, Summary tab, Lab, chart upgrades, worker.
5. Dashboard, template library, onboarding, bundle.
6. Tests, docs, deployment checks, merge, release v2.0.0.
