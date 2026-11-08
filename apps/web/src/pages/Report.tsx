import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { monthNumber, monthNumberToDate } from '@whatif/engine';
import { SOURCE_LABELS, categoryInfo, type ReportSnapshot } from '@whatif/shared';
import { download } from '../api/client';
import { useReport } from '../api/queries';
import { LineChart } from '../components/charts/LineChart';
import { dateLabel, formatUnit, money, monthLabel, number, prob } from '../lib/format';
import { Button, ErrorState, ScenarioDot, Skeleton, seriesColor, useToast } from '../components/ui';
import { BrandMark } from '../layout/AppShell';

function metric(v: number | null | undefined, unit: string, cur: string) {
  if (v === null || v === undefined) return '—';
  if (unit === 'currency') return money(v, cur);
  if (unit === 'currency_month') return `${money(v, cur)}/mo`;
  if (unit === 'percent') return prob(v);
  if (unit === 'hours_week') return `${number(v)} h/wk`;
  return number(v);
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const q = useReport(id);
  const toast = useToast();
  useEffect(() => {
    if (q.data) document.title = `${q.data.title} · What-If`;
  }, [q.data]);

  if (q.isLoading)
    return (
      <div className="report">
        <Skeleton height={400} />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="report">
        <ErrorState error={q.error ?? new Error('Report not found')} />
      </div>
    );
  const r = q.data;
  const s: ReportSnapshot = r.snapshot;
  const base = s.decision.baseCurrency;
  const fx = (sc: ReportSnapshot['scenarios'][number]) => (sc.currency === base ? 1 : (sc.exchangeRateToBase ?? 1));
  const startYear = (sc: ReportSnapshot['scenarios'][number]) => Number(sc.yearly[0]?.label ?? 0);
  let n = 0;
  const h = (children: string) => {
    n += 1;
    return (
      <h2 className="report-h">
        <span className="num">{String(n).padStart(2, '0')}</span>
        {children}
      </h2>
    );
  };
  const chosen = s.scenarios.find((x) => x.id === s.decision.chosenScenarioId);

  return (
    <div className="report-wrap">
      <div className="report-toolbar no-print">
        <Link to={`/decisions/${s.decision.id}?tab=decide`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} aria-hidden /> Back to decision
        </Link>
        <div className="row">
          <Button size="sm" icon={<Printer />} onClick={() => window.print()}>
            Print
          </Button>
          <Button size="sm" variant="primary" icon={<FileDown />} onClick={() => download(`/reports/${r.id}/pdf`, 'decision-report.pdf').catch((e) => toast((e as Error).message, 'bad'))}>
            Download PDF
          </Button>
        </div>
      </div>
      <article className="report">
        <header className="report-cover">
          <div className="brand">
            <BrandMark size={20} />
            <span>What-If · Decision report</span>
          </div>
          <h1 className="serif">{s.decision.title}</h1>
          <p className="faint">
            {categoryInfo(s.decision.category).label} · {s.scenarios.length} scenarios · {s.decision.horizonYears}-year horizon · amounts in {base} · generated {dateLabel(s.generatedAt)}
          </p>
          <p className="report-disclaimer">Projections were calculated by a deterministic engine (version {s.engineVersion}) from the assumptions listed below. They are estimates for exploring trade-offs — not predictions, and not financial advice.</p>
        </header>

        <section>
          {h('Decision overview')}
          {s.decision.question && <p className="serif report-question">{s.decision.question}</p>}
          {s.decision.description && <p className="muted">{s.decision.description}</p>}
        </section>

        <section>
          {h('Current baseline')}
          {s.baseline ? (
            <dl className="report-dl">
              {[s.baseline.city, s.baseline.country].filter(Boolean).length > 0 && (
                <>
                  <dt>Location</dt>
                  <dd>{[s.baseline.city, s.baseline.country].filter(Boolean).join(', ')}</dd>
                </>
              )}
              {s.baseline.occupation && (
                <>
                  <dt>Occupation</dt>
                  <dd>{s.baseline.occupation}</dd>
                </>
              )}
              {s.baseline.annualIncome != null && (
                <>
                  <dt>Gross income</dt>
                  <dd>{money(s.baseline.annualIncome, s.baseline.currency ?? base)}/yr</dd>
                </>
              )}
              {s.baseline.savings != null && (
                <>
                  <dt>Savings</dt>
                  <dd>{money(s.baseline.savings, s.baseline.currency ?? base)}</dd>
                </>
              )}
              {s.baseline.riskTolerance && (
                <>
                  <dt>Risk tolerance</dt>
                  <dd style={{ textTransform: 'capitalize' }}>{s.baseline.riskTolerance}</dd>
                </>
              )}
              {s.baseline.goals && s.baseline.goals.length > 0 && (
                <>
                  <dt>Goals</dt>
                  <dd>{s.baseline.goals.join(' · ')}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="faint">No baseline included.</p>
          )}
        </section>

        <section>
          {h('Compared scenarios')}
          <ul className="report-scenarios">
            {s.scenarios.map((sc, i) => (
              <li key={sc.id}>
                <ScenarioDot index={i} size={10} />
                <div>
                  <strong>{sc.name}</strong>
                  {sc.isBaseline && <span className="faint"> · baseline</span>}
                  {sc.description && <div className="muted">{sc.description}</div>}
                  <div className="faint report-mono">
                    {sc.currency}
                    {sc.currency !== base && ` · 1 ${sc.currency} = ${sc.exchangeRateToBase ?? '?'} ${base}`} · version {sc.version} · run {sc.runId.slice(0, 8)} · inputs {sc.inputHash}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          {h('Key assumptions')}
          {s.scenarios.map((sc) => (
            <div key={sc.id} className="report-block">
              <h3>{sc.name}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Assumption</th>
                    <th className="r">Value</th>
                    <th className="r">Range</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.variables.map((v) => (
                    <tr key={v.key}>
                      <td>{v.label}</td>
                      <td className="r">{formatUnit(v.value, v.unit as never, sc.currency)}</td>
                      <td className="r faint">{v.low !== null || v.high !== null ? `${formatUnit(v.low ?? v.value, v.unit as never, sc.currency)} – ${formatUnit(v.high ?? v.value, v.unit as never, sc.currency)}` : ''}</td>
                      <td>{SOURCE_LABELS[v.source].label}</td>
                    </tr>
                  ))}
                  {sc.flows.map((f) => (
                    <tr key={f.id}>
                      <td>{f.label}</td>
                      <td className="r">{f.amount === null ? 'Not set' : f.kind === 'time' ? `${f.amount} h/wk` : money(f.amount, sc.currency) + (f.kind.startsWith('one_time') ? '' : '/mo')}</td>
                      <td className="r faint">
                        month {f.startMonth}
                        {f.endMonth ? `–${f.endMonth}` : ''}
                      </td>
                      <td>{SOURCE_LABELS[f.source].label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <section>
          {h('Financial projections')}
          <LineChart
            height={260}
            series={s.scenarios.map((sc, i) => {
              const sy = startYear(sc);
              return {
                id: sc.id,
                label: sc.name,
                color: seriesColor(i),
                points: [{ x: (sy - 1) * 12 + 11, y: sc.summary.startingNetWorth * fx(sc) }, ...sc.yearly.map((y) => ({ x: Number(y.label) * 12 + 11, y: y.netWorth * fx(sc) }))],
              };
            })}
            xFormat={(x) => `End of ${monthNumberToDate(x).slice(0, 4)}`}
            xTickFormat={(x) => monthNumberToDate(x).slice(0, 4)}
            yFormat={(v) => money(v, base)}
            yTickFormat={(v) => money(v, base, { compact: true })}
            ariaLabel="Expected net worth by scenario"
          />
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Year end</th>
                {s.scenarios.map((sc) => (
                  <th key={sc.id} className="r">
                    {sc.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(s.scenarios[0]?.yearly ?? []).map((y, i) => (
                <tr key={y.label}>
                  <td>{y.label}</td>
                  {s.scenarios.map((sc) => (
                    <td key={sc.id} className="r">
                      {sc.yearly[i] ? money(sc.yearly[i]!.netWorth * fx(sc), base) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          {h('Timeline')}
          <ol className="report-timeline">
            {[
              ...s.milestones.map((m) => ({ date: m.date, title: m.title, who: s.scenarios.find((x) => x.id === m.scenarioId)?.name ?? 'All scenarios', detail: m.description ?? '' })),
              ...s.scenarios.flatMap((sc) => sc.milestones.filter((m) => m.kind !== 'start' && m.kind !== 'end').map((m) => ({ date: m.date, title: m.title, who: sc.name, detail: m.detail }))),
            ]
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 40)
              .map((e, i) => (
                <li key={i}>
                  <span className="num faint">{monthLabel(e.date)}</span>
                  <span>
                    <strong>{e.title}</strong> <span className="faint">· {e.who}</span>
                    {e.detail && <div className="muted">{e.detail}</div>}
                  </span>
                </li>
              ))}
          </ol>
        </section>

        {(['risk', 'opportunity'] as const).map((kind) => (
          <section key={kind}>
            {h(kind === 'risk' ? 'Risks' : 'Opportunities')}
            {s.scenarios.map((sc) => {
              const items = sc.insights.filter((i) => i.kind === kind);
              const notes = s.assumptions.filter((a) => a.scenarioId === sc.id && a.category === kind);
              if (!items.length && !notes.length) return null;
              return (
                <div key={sc.id} className="report-block">
                  <h3>{sc.name}</h3>
                  <ul className="report-list">
                    {items.map((i) => (
                      <li key={i.id}>
                        <strong>{i.title}</strong> <span className="faint">({i.severity}, calculated)</span>
                        <div className="muted">{i.detail}</div>
                      </li>
                    ))}
                    {notes.map((a) => (
                      <li key={a.id}>
                        {a.text} <span className="faint">({SOURCE_LABELS[a.source].label}{a.likelihood ? `, likelihood ${a.likelihood}` : ''})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}

        <section>
          {h('Sensitivity analysis')}
          <p className="muted">Final net worth when one input moves across its range, with all others at their expected values.</p>
          {s.scenarios.map((sc) =>
            sc.sensitivity.length ? (
              <div key={sc.id} className="report-block">
                <h3>{sc.name}</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Input</th>
                      <th className="r">At low</th>
                      <th className="r">At high</th>
                      <th className="r">Swing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sc.sensitivity.slice(0, 6).map((x) => (
                      <tr key={x.key}>
                        <td>
                          {x.label}
                          {x.basis === 'default' && <span className="faint"> (standard spread)</span>}
                        </td>
                        <td className="r">{money(x.atLow, sc.currency)}</td>
                        <td className="r">{money(x.atHigh, sc.currency)}</td>
                        <td className="r">{money(x.swing, sc.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null,
          )}
        </section>

        <section>
          {h('Main trade-offs')}
          <table className="table">
            <thead>
              <tr>
                <th />
                {s.scenarios.map((sc) => (
                  <th key={sc.id} className="r">
                    {sc.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.comparison.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  {s.scenarios.map((sc) => (
                    <td key={sc.id} className={`r ${row.leader === sc.id ? 'leader' : ''}`}>
                      {metric(row.values[sc.id], row.unit, base)}
                    </td>
                  ))}
                </tr>
              ))}
              {s.scenarios.some((x) => x.fit !== null) && (
                <tr>
                  <td>Fit with priorities</td>
                  {s.scenarios.map((sc) => (
                    <td key={sc.id} className="r">
                      {sc.fit === null ? '—' : `${sc.fit}/100`}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          {s.aiSummary && (
            <div className="report-ai">
              <div className="eyebrow">
                AI analyst summary · {s.aiSummary.provider} · {s.aiSummary.model}
              </div>
              <p>{s.aiSummary.output.summary}</p>
              <ul className="report-list">
                {s.aiSummary.output.points.map((p, i) => (
                  <li key={i}>
                    <strong>{p.title}</strong>
                    <div className="muted">{p.detail}</div>
                  </li>
                ))}
              </ul>
              {s.aiSummary.unverifiedNumbers.length > 0 && <p className="unverified">Figures not found in the simulation results: {s.aiSummary.unverifiedNumbers.join(', ')}</p>}
            </div>
          )}
        </section>

        <section>
          {h('Uncertainties')}
          {s.scenarios.map((sc) => (
            <div key={sc.id} className="report-block">
              <h3>{sc.name}</h3>
              {sc.uncertainty?.hasUncertainty ? (
                <p>
                  Across {sc.uncertainty.runs} simulated variations (seed {sc.uncertainty.seed}), 80 % of outcomes end between {money(sc.uncertainty.finalNetWorth.p10, sc.currency)} and {money(sc.uncertainty.finalNetWorth.p90, sc.currency)}; median {money(sc.uncertainty.finalNetWorth.p50, sc.currency)}. Chance of a cash shortfall: {prob(sc.uncertainty.shortfallProbability)}.
                </p>
              ) : (
                <p className="faint">No ranges were set, so no uncertainty band was calculated.</p>
              )}
              <p className="muted">
                Best case {money(sc.best, sc.currency)} · worst case {money(sc.worst, sc.currency)}.
              </p>
              {sc.warnings.filter((w) => w.code === 'missing_value').length > 0 && <p className="unverified">Missing inputs (counted as zero): {sc.warnings.filter((w) => w.code === 'missing_value').map((w) => w.message.split(' has not')[0]).join(', ')}.</p>}
            </div>
          ))}
        </section>

        <section>
          {h('Final decision')}
          {chosen ? (
            <>
              <p className="serif report-question">{chosen.name}</p>
              {s.decision.decidedAt && <p className="faint">Decided {dateLabel(s.decision.decidedAt)}</p>}
              {s.decision.rationale && (
                <>
                  <h3 className="report-sub">Why</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{s.decision.rationale}</p>
                </>
              )}
              {s.decision.expectations && (
                <>
                  <h3 className="report-sub">Expectations</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{s.decision.expectations}</p>
                </>
              )}
            </>
          ) : (
            <p className="faint">No decision has been recorded yet.</p>
          )}
        </section>
      </article>
    </div>
  );
}

