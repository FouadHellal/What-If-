import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleAlert, CircleDashed, FlaskConical, Lock, Search, Target } from 'lucide-react';
import { LIFE_DIMENSIONS, monthNumber, type RobustnessLabel } from '@whatif/engine';
import type { DecisionDTO, DecisionIntelligence } from '@whatif/shared';
import { patch } from '../../api/client';
import { keys } from '../../api/queries';
import { formatUnit, money, monthLabel, prob, durationMonths } from '../../lib/format';
import { fxFor } from '../../lib/simulation';
import { Badge, Button, Callout, ScenarioDot, Skeleton, Spinner, useToast } from '../../components/ui';
import { PriorityPips } from '../Onboarding';
import type { WorkspaceContext } from './Workspace';

export const LABEL_TEXT: Record<RobustnessLabel, { text: string; tone?: 'good' | 'warn' | 'bad' | 'accent' }> = {
  consistent: { text: 'Consistent', tone: 'good' },
  optimism_dependent: { text: 'Needs favourable assumptions', tone: 'warn' },
  vulnerable: { text: 'Vulnerable to shortfalls', tone: 'bad' },
  highest_upside: { text: 'Highest upside', tone: 'accent' },
  lowest_downside: { text: 'Lowest downside', tone: 'accent' },
};

/** Compact at-a-glance strip shown above every workspace tab. */
export function SummaryStrip({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, computing, intel, goTo } = ctx;
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  if (active.length === 0) return null;
  return (
    <div className="glance" role="region" aria-label="Decision at a glance">
      {active.map((s) => {
        const r = results.get(s.id);
        const fx = fxFor(s, decision.baseCurrency);
        const cur = fx.missing ? s.currency : decision.baseCurrency;
        const rob = intel?.robustness.scenarios.find((x) => x.id === s.id);
        const label = rob?.labels[0];
        return (
          <button key={s.id} className="glance-item" onClick={() => goTo('scenarios', s.id)}>
            <span className="glance-name">
              <ScenarioDot index={s.colorIndex} />
              {s.name}
              {computing.has(s.id) && <Spinner label="Recalculating" />}
            </span>
            <span className="glance-value num">{r ? money(r.expected.summary.finalNetWorth * fx.rate, cur, { compact: true }) : '—'}</span>
            <span className="glance-sub num">
              {r?.uncertainty?.hasUncertainty ? `${money(r.uncertainty.finalNetWorth.p10 * fx.rate, cur, { compact: true })} – ${money(r.uncertainty.finalNetWorth.p90 * fx.rate, cur, { compact: true })}` : s.isBaseline ? 'Baseline' : 'No range'}
            </span>
            {label ? <span className={`glance-label tone-${LABEL_TEXT[label].tone ?? 'none'}`}>{LABEL_TEXT[label].text}</span> : rob && Number.isFinite(rob.winProbability) ? <span className="glance-label">Leads in {prob(rob.winProbability)}</span> : <span className="glance-label"> </span>}
          </button>
        );
      })}
    </div>
  );
}

function nameOf(decision: DecisionDTO, id: string | null) {
  return decision.scenarios.find((s) => s.id === id)?.name ?? '—';
}

function RangeBar({ p10, p50, p90, min, max, color, expected }: { p10: number; p50: number; p90: number; min: number; max: number; color: string; expected: number }) {
  const span = max - min || 1;
  const x = (v: number) => `${((v - min) / span) * 100}%`;
  return (
    <div className="rangebar" aria-hidden>
      {min < 0 && max > 0 && <span className="rangebar-zero" style={{ left: x(0) }} />}
      <span className="rangebar-band" style={{ left: x(p10), width: `${((p90 - p10) / span) * 100}%`, background: color }} />
      <span className="rangebar-median" style={{ left: x(p50) }} />
      <span className="rangebar-expected" style={{ left: x(expected), borderColor: color }} />
    </div>
  );
}

export function SummaryTab({ ctx, openSettings }: { ctx: WorkspaceContext; openSettings: () => void }) {
  const { decision, drafts, results, intel, intelLoading, goTo, lifeWeights } = ctx;
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const cur = decision.baseCurrency;
  if (!intel) {
    return (
      <div className="stack">
        {intelLoading ? (
          <>
            <Skeleton height={28} width="50%" />
            <Skeleton height={160} />
            <Skeleton height={160} />
          </>
        ) : (
          <Callout>Add at least one scenario to see the analysis.</Callout>
        )}
      </div>
    );
  }
  const scenarioCur = (id: string) => drafts.scenarios.find((s) => s.id === id)?.currency ?? cur;
  const colorOf = (id: string) => `var(--series-${((drafts.scenarios.find((s) => s.id === id)?.colorIndex ?? 0) % 8) + 1})`;
  const rob = intel.robustness;
  const ranges = rob.scenarios.flatMap((r) => [r.p10, r.p90]).concat(intel.alternatives.map((a) => a.expectedFinal));
  const min = Math.min(0, ...ranges);
  const max = Math.max(...ranges);
  const leadersDiffer = new Set([intel.financialLeaderId, intel.robustLeaderId, intel.lifeLeaderId].filter(Boolean)).size > 1;

  return (
    <div className="summary">
      <section className="summary-lead">
        <div className="eyebrow">The decision</div>
        <p className="summary-statement serif">{intel.statement}</p>
        <p className="faint" style={{ fontSize: 'var(--text-xs)' }}>
          Analysis of {intel.alternatives.length} scenario{intel.alternatives.length === 1 ? '' : 's'} computed from your assumptions. It shows what the outcome depends on — the choice is yours.
          {intelLoading && ' Updating…'}
        </p>
      </section>

      <section className="leaders">
        <div className="leader">
          <div className="leader-label">Highest expected outcome</div>
          <div className="leader-name">
            <ScenarioDot index={drafts.scenarios.find((s) => s.id === intel.financialLeaderId)?.colorIndex ?? 0} />
            {nameOf(decision, intel.financialLeaderId)}
          </div>
          <div className="leader-sub">If every assumption lands on its expected value.</div>
        </div>
        <div className="leader">
          <div className="leader-label">Most robust</div>
          {rob.comparable && intel.robustLeaderId ? (
            <>
              <div className="leader-name">
                <ScenarioDot index={drafts.scenarios.find((s) => s.id === intel.robustLeaderId)?.colorIndex ?? 0} />
                {nameOf(decision, intel.robustLeaderId)}
              </div>
              <div className="leader-sub">Comes out ahead in {prob(rob.scenarios.find((s) => s.id === intel.robustLeaderId)!.winProbability)} of {rob.runs.toLocaleString()} simulated futures.</div>
            </>
          ) : (
            <div className="leader-sub">{rob.reason ?? 'Not enough uncertainty modelled.'}</div>
          )}
        </div>
        <div className="leader">
          <div className="leader-label">Best fit with your priorities</div>
          {intel.lifeLeaderId ? (
            <>
              <div className="leader-name">
                <ScenarioDot index={drafts.scenarios.find((s) => s.id === intel.lifeLeaderId)?.colorIndex ?? 0} />
                {nameOf(decision, intel.lifeLeaderId)}
              </div>
              <div className="leader-sub">Based on your 1–5 ratings, weighted by importance.</div>
            </>
          ) : (
            <div className="leader-sub">
              <button className="link-button" onClick={() => goTo('scenarios', active[0]?.id)}>
                Rate how each path fits your life
              </button>{' '}
              to include it.
            </div>
          )}
        </div>
      </section>
      {leadersDiffer && <p className="tradeoff-note">These point in different directions — that is the trade-off this decision is about.</p>}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">How robust is each path?</h2>
          <span className="meta">{rob.comparable ? `Same ${rob.runs.toLocaleString()} simulated futures for every scenario` : 'Expected and percentile outcomes'}</span>
        </div>
        <div className="table-scroll">
          <table className="table robust-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th style={{ minWidth: 180 }}>Range of outcomes ({cur})</th>
                <th className="r">Pessimistic (P10)</th>
                <th className="r">Median</th>
                <th className="r">Optimistic (P90)</th>
                {rob.comparable && <th className="r">Leads in</th>}
                {rob.comparable && <th className="r">Avg. regret</th>}
                <th className="r">Cash shortfall</th>
              </tr>
            </thead>
            <tbody>
              {rob.scenarios.map((r) => {
                const alt = intel.alternatives.find((a) => a.id === r.id)!;
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <ScenarioDot index={drafts.scenarios.find((s) => s.id === r.id)?.colorIndex ?? 0} />
                        <span style={{ fontWeight: 500 }}>{alt.name}</span>
                      </div>
                      <div className="row" style={{ gap: 4, marginTop: 4 }}>
                        {r.labels.map((l) => (
                          <Badge key={l} tone={LABEL_TEXT[l].tone}>
                            {LABEL_TEXT[l].text}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <RangeBar p10={r.p10} p50={r.p50} p90={r.p90} min={min} max={max} color={colorOf(r.id)} expected={alt.expectedFinal} />
                    </td>
                    <td className="r">{money(r.p10, cur)}</td>
                    <td className="r">{money(r.p50, cur)}</td>
                    <td className="r">{money(r.p90, cur)}</td>
                    {rob.comparable && <td className="r">{prob(r.winProbability)}</td>}
                    {rob.comparable && <td className="r">{money(r.expectedRegret, cur)}</td>}
                    <td className="r">{prob(r.shortfallProbability)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
          Bar: 80 % of simulated outcomes; tick: median; ring: expected case. “Avg. regret” is how far behind the best option this one ends, on average across futures. Percentiles describe the model’s spread, not guarantees.
        </p>
      </section>

      {intel.breakEvens.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">When does it pay off?</h2>
            <span className="meta">Against {nameOf(decision, intel.alternatives.find((a) => a.isBaseline)?.id ?? null)}, expected case</span>
          </div>
          <ul className="prose-list">
            {intel.breakEvens.map((b) => (
              <li key={b.alternativeId}>
                <strong>{nameOf(decision, b.alternativeId)}</strong>{' '}
                {b.overtakesAt ? (
                  <>
                    catches up in <strong>{monthLabel(b.overtakesAt)}</strong>
                    {b.monthsToBreakEven !== null && b.monthsToBreakEven > 0 && <> — {durationMonths(b.monthsToBreakEven)} after it starts</>}
                    {b.maxDeficit > 0 && b.maxDeficitAt && (
                      <>
                        , after being up to <strong>{money(b.maxDeficit, cur)}</strong> behind in {monthLabel(b.maxDeficitAt)}
                      </>
                    )}
                    .{' '}
                    {b.endDate && (
                      <>
                        By {monthLabel(b.endDate)} it is {money(b.endAdvantage, cur)} ahead, gaining about {money(b.monthlyGainAtEnd, cur)} a month.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    does not catch up within the horizon{b.endDate ? <> and ends {money(Math.abs(b.endAdvantage), cur)} behind in {monthLabel(b.endDate)}</> : null}.
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(intel.mindChangers.length > 0 || intel.fxThresholds.length > 0) && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">What would change the outcome</h2>
            <span className="meta">Solved from the model — the value at which the leader changes</span>
          </div>
          <ul className="mind-list">
            {intel.mindChangers.slice(0, 6).map((m, i) => (
              <li key={i}>
                <span className="mind-text">
                  If <strong>{m.label.toLowerCase()}</strong> in {nameOf(decision, m.scenarioId)} is <strong>{m.side} {formatUnit(m.threshold, m.unit, scenarioCur(m.scenarioId))}</strong>{' '}
                  <span className="faint">(now {formatUnit(m.current, m.unit, scenarioCur(m.scenarioId))})</span>, {nameOf(decision, m.newLeaderId)} comes out ahead.
                </span>
                <span className={`distance ${m.distance < 0.15 ? 'near' : ''}`}>{m.distance < 0.15 ? 'Close call' : `${Math.round(m.distance * 100)} % away`}</span>
              </li>
            ))}
            {intel.fxThresholds.map((f) => (
              <li key={`fx-${f.scenarioId}`}>
                <span className="mind-text">
                  If 1 <strong>{f.currency}</strong> is worth <strong>{f.rate < f.current ? 'less' : 'more'} than {f.rate.toPrecision(3)} {cur}</strong> <span className="faint">(now {f.current})</span>, {nameOf(decision, f.scenarioId)} and {nameOf(decision, f.rivalId)} swap places.
                </span>
                <span className="distance">{Math.round((Math.abs(f.rate - f.current) / f.current) * 100)} % move</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" icon={<FlaskConical />} onClick={() => goTo('lab')}>
            Test these in the Lab
          </Button>
        </section>
      )}

      <div className="grid-2 section">
        <section>
          <div className="section-head">
            <h2 className="section-title">What could go wrong</h2>
          </div>
          {intel.failureModes.length + intel.userRisks.length === 0 ? (
            <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
              No failure conditions found. Add ranges to uncertain inputs to test this properly.
            </p>
          ) : (
            <ul className="check-list">
              {intel.failureModes.map((f, i) => (
                <li key={i}>
                  <CircleAlert size={15} className={f.severity === 'high' ? 'icon-bad' : 'icon-warn'} aria-hidden />
                  <span>
                    <strong>{nameOf(decision, f.scenarioId)}:</strong> {f.text}
                  </span>
                </li>
              ))}
              {intel.userRisks.map((r) => (
                <li key={r.id}>
                  <CircleAlert size={15} className="icon-warn" aria-hidden />
                  <span>
                    {r.scenarioId && <strong>{nameOf(decision, r.scenarioId)}: </strong>}
                    {r.text} <span className="faint">(your note)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="section-head">
            <h2 className="section-title">Hard to undo</h2>
          </div>
          {intel.irreversible.length === 0 ? (
            <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
              Nothing irreversible detected in the alternatives.
            </p>
          ) : (
            <ul className="check-list">
              {intel.irreversible.map((x, i) => (
                <li key={i}>
                  <Lock size={14} className="faint" aria-hidden />
                  <span>
                    <strong>{nameOf(decision, x.scenarioId)}:</strong> {x.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid-2 section">
        <section>
          <div className="section-head">
            <h2 className="section-title">Find out before deciding</h2>
            <span className="meta">Influential values you have not confirmed</span>
          </div>
          {intel.toResearch.length === 0 ? (
            <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
              The most influential values are your own. Consider adding ranges to them.
            </p>
          ) : (
            <ul className="check-list">
              {intel.toResearch.map((r, i) => (
                <li key={i}>
                  <Search size={14} className="faint" aria-hidden />
                  <span>
                    <button className="link-button" onClick={() => goTo('scenarios', r.scenarioId)}>
                      {r.label}
                    </button>{' '}
                    in {nameOf(decision, r.scenarioId)} — {r.why} {r.priority === 'high' && <Badge tone="warn">High impact</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="section-head">
            <h2 className="section-title">Commonly overlooked costs</h2>
            <span className="meta">Checked against your scenarios’ items</span>
          </div>
          {intel.hiddenCosts.length === 0 ? (
            <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
              No checklist for this type of decision.
            </p>
          ) : (
            <ul className="check-list">
              {intel.hiddenCosts.map((h) => (
                <li key={h.label}>
                  {h.modelled ? <Check size={15} className="icon-good" aria-label="Modelled" /> : <CircleDashed size={15} className="faint" aria-label="Not modelled" />}
                  <span>
                    {h.label} {h.modelled ? <span className="faint">— in {h.scenarioIds.map((id) => nameOf(decision, id)).join(', ')}</span> : <span className="faint">— not in any scenario yet</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <GoalsSection ctx={ctx} openSettings={openSettings} />
      <LifeQualitySection ctx={ctx} intel={intel} lifeWeights={lifeWeights} />

      <details className="explain section">
        <summary>Methodology and caveats</summary>
        <Methodology ctx={ctx} />
        <ul className="prose-list" style={{ marginTop: 12 }}>
          {intel.caveats.map((c, i) => (
            <li key={i} className="faint" style={{ fontSize: 'var(--text-sm)' }}>
              {c}
            </li>
          ))}
        </ul>
        <p className="faint" style={{ fontSize: 'var(--text-xs)' }}>
          Inputs: {intel.completeness.total} set, {intel.completeness.missing} missing, {intel.completeness.systemValues} default or illustrative, {intel.completeness.aiValues} AI estimates.
        </p>
      </details>
      <Button variant="ghost" size="sm" icon={<ArrowRight />} onClick={() => goTo('decide')}>
        Ready? Record your decision
      </Button>
      {results.size === 0 && <Spinner />}
    </div>
  );
}

function Methodology({ ctx }: { ctx: WorkspaceContext }) {
  const first = ctx.drafts.scenarios.map((s) => ctx.results.get(s.id)).find((r) => r?.uncertainty);
  const m = first?.uncertainty?.methodology;
  if (!m) return <p className="faint">No uncertainty analysis yet.</p>;
  return (
    <table className="table" style={{ marginTop: 8 }}>
      <tbody>
        <tr>
          <td>Simulated futures</td>
          <td className="r">
            {m.runs.toLocaleString()} (seed {m.seed}), shared by all scenarios
          </td>
        </tr>
        <tr>
          <td>Uncertain inputs</td>
          <td className="r">Triangular distributions between your low, expected and high values</td>
        </tr>
        <tr>
          <td>Correlations</td>
          <td className="r">{m.correlated ? `${m.correlationPairs.length} documented pairs (e.g. inflation with salary growth and rent)` : 'Inputs treated as independent'}</td>
        </tr>
        <tr>
          <td>Markets</td>
          <td className="r">Yearly investment returns (lognormal) and inflation vary around their averages</td>
        </tr>
        <tr>
          <td>Employment and surprises</td>
          <td className="r">Job search risk, yearly job-loss risk and unexpected expenses where you set them</td>
        </tr>
      </tbody>
    </table>
  );
}

function GoalsSection({ ctx, openSettings }: { ctx: WorkspaceContext; openSettings: () => void }) {
  const { decision, drafts, results } = ctx;
  const goals = decision.settings.goals ?? [];
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Goals</h2>
        <Button size="sm" variant="ghost" icon={<Target />} onClick={openSettings}>
          {goals.length ? 'Edit goals' : 'Set a goal'}
        </Button>
      </div>
      {goals.length === 0 ? (
        <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
          Define what success looks like — for example “€100,000 by 2032” or “never run out of cash” — and see how likely each path is to get there.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                {active.map((s) => (
                  <th key={s.id} className="r">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {goals.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.label}
                    <div className="faint" style={{ fontSize: 11 }}>
                      {g.kind === 'cash_floor' ? `Cash never below ${money(g.target, decision.baseCurrency)}` : `Net worth ≥ ${money(g.target, decision.baseCurrency)} by ${g.date ? monthLabel(g.date) : 'the end'}`}
                    </div>
                  </td>
                  {active.map((s) => {
                    const r = results.get(s.id)?.goals.find((x) => x.id === g.id);
                    const outside = g.date && monthNumber(g.date) < monthNumber(s.startDate);
                    return (
                      <td key={s.id} className="r">
                        {!r ? (
                          <span className="faint" title={outside ? 'The goal date is before this scenario starts' : 'Needs an exchange rate'}>
                            —
                          </span>
                        ) : (
                          <>
                            <span className="num" style={{ fontWeight: 600 }}>
                              {r.probability === null ? (r.achievedInExpected ? 'Met' : 'Missed') : prob(r.probability)}
                            </span>
                            {r.probability !== null && (
                              <div className="faint" style={{ fontSize: 11 }}>
                                {r.achievedInExpected ? 'met in expected case' : 'missed in expected case'}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LifeQualitySection({ ctx, intel, lifeWeights }: { ctx: WorkspaceContext; intel: DecisionIntelligence; lifeWeights: Record<string, number> }) {
  const { decision, drafts, goTo } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const [weights, setWeights] = useState<Record<string, number>>(() => ({ ...lifeWeights }));
  const [dirty, setDirty] = useState(false);
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const rated = active.some((s) => Object.keys(s.scores).length > 0);
  const save = async () => {
    try {
      const d = await patch<DecisionDTO>(`/decisions/${decision.id}`, { priorities: weights });
      qc.setQueryData(keys.decision(d.id), d);
      setDirty(false);
      toast('Priorities saved for this decision.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Life quality</h2>
        <span className="meta">Your subjective ratings — not measurements</span>
      </div>
      {!rated ? (
        <Callout>
          Money is only part of it. Rate each scenario 1–5 on career, freedom, time, family and more under{' '}
          <button className="link-button" onClick={() => goTo('scenarios', active[0]?.id)}>
            Scenarios → How it fits your life
          </button>
          .
        </Callout>
      ) : (
        <div className="grid-2" style={{ gap: 'var(--s-8)' }}>
          <div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    {intel.alternatives.map((a) => (
                      <th key={a.id} className="r">
                        {a.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LIFE_DIMENSIONS.map((d) => (
                    <tr key={d.key}>
                      <td className="lead">{d.label}</td>
                      {intel.alternatives.map((a) => {
                        const s = active.find((x) => x.id === a.id)!;
                        const v = s.scores[d.key] ?? (d.key === 'family' ? s.scores.relationships : d.key === 'stability' ? s.scores.financial : undefined);
                        return (
                          <td key={a.id} className="r">
                            {v ? <span className="score-dots" aria-label={`${v} of 5`}>{'●'.repeat(v)}{'○'.repeat(5 - v)}</span> : <span className="faint">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 600 }}>Weighted score</td>
                    {intel.alternatives.map((a) => (
                      <td key={a.id} className="r" style={{ fontWeight: 600 }}>
                        {a.lifeScore === null ? '—' : `${a.lifeScore}/100`}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {intel.lifeFlips.length > 0 && (
              <ul className="prose-list" style={{ marginTop: 12 }}>
                {intel.lifeFlips.slice(0, 4).map((f) => (
                  <li key={f.dimension} style={{ fontSize: 'var(--text-sm)' }}>
                    If <strong>{f.label.toLowerCase()}</strong> mattered {f.weight} instead of {f.currentWeight}, <strong>{nameOf(decision, f.newLeaderId)}</strong> would fit best.
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              How much each dimension matters to you (0–5)
            </div>
            {LIFE_DIMENSIONS.map((d) => (
              <div key={d.key} className="weight-row compact">
                <div style={{ fontSize: 'var(--text-sm)' }}>{d.label}</div>
                <PriorityPips
                  label={d.label}
                  value={weights[d.key] ?? 3}
                  onChange={(v) => {
                    setWeights((w) => ({ ...w, [d.key]: v }));
                    setDirty(true);
                  }}
                />
              </div>
            ))}
            {dirty && (
              <div className="row" style={{ marginTop: 10 }}>
                <Button size="sm" variant="primary" onClick={() => void save()}>
                  Save priorities
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setWeights({ ...lifeWeights });
                    setDirty(false);
                  }}
                >
                  Reset
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
