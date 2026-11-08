import { useMemo, useState } from 'react';
import { Check, ChartLine, Table2, TriangleAlert } from 'lucide-react';
import { COMPARISON_METRICS, monthNumber, monthNumberToDate, type Comparison, type ComparisonMetrics, type SeriesField } from '@whatif/engine';
import type { ScenarioDTO } from '@whatif/shared';
import { LineChart, type Band, type LineSeries } from '../../components/charts/LineChart';
import { money, monthLabel, number, prob } from '../../lib/format';
import { fxFor, useComparison } from '../../lib/simulation';
import { useSession } from '../../lib/session';
import { Callout, ScenarioDot, Segmented, seriesColor } from '../../components/ui';
import type { WorkspaceContext } from './Workspace';

const FIELDS: { value: SeriesField; label: string }[] = [
  { value: 'netWorth', label: 'Net worth' },
  { value: 'realNetWorth', label: 'Today’s money' },
  { value: 'cash', label: 'Cash' },
  { value: 'netIncome', label: 'Monthly income' },
  { value: 'totalExpenses', label: 'Monthly costs' },
  { value: 'freeHoursPerWeek', label: 'Free time' },
];

function fmtMetric(v: number | null | undefined, unit: string, cur: string): string {
  if (v === null || v === undefined) return '—';
  switch (unit) {
    case 'currency':
      return money(v, cur);
    case 'currency_month':
      return `${money(v, cur)}/mo`;
    case 'percent':
      return prob(v);
    case 'hours_week':
      return `${number(v)} h`;
    default:
      return number(v);
  }
}

/** Deterministic plain-language comparison built only from computed metrics. */
export function keyDifferences(cmp: Comparison, cur: string): string[] {
  const out: string[] = [];
  const base = cmp.scenarios.find((s) => s.isBaseline);
  const alts = cmp.scenarios.filter((s) => !s.isBaseline);
  if (cmp.scenarios.length < 2) return out;
  const byNW = [...cmp.scenarios].sort((a, b) => b.metrics.finalNetWorth - a.metrics.finalNetWorth);
  const top = byNW[0]!;
  if (base) {
    for (const a of alts) {
      const d = a.deltaVsBaseline ?? 0;
      const when = a.overtakesBaselineAt ? (a.overtakesBaselineAt <= (cmp.series[0]?.date ?? '') ? 'from the start' : `from ${monthLabel(a.overtakesBaselineAt)}`) : null;
      if (d > 0) out.push(`${a.name} ends ${money(d, cur)} ahead of ${base.name} in the expected case${when ? `, staying ahead ${when}` : ''}.`);
      else if (d < 0) out.push(`${a.name} ends ${money(-d, cur)} behind ${base.name} in the expected case.`);
    }
  } else {
    out.push(`${top.name} has the highest expected net worth at the horizon (${money(top.metrics.finalNetWorth, cur)}).`);
  }
  const riskiest = [...cmp.scenarios].filter((s) => s.metrics.shortfallProbability !== null).sort((a, b) => (b.metrics.shortfallProbability ?? 0) - (a.metrics.shortfallProbability ?? 0))[0];
  if (riskiest && (riskiest.metrics.shortfallProbability ?? 0) >= 0.1) {
    out.push(`${riskiest.name} carries the highest liquidity risk: cash dips below zero in ${prob(riskiest.metrics.shortfallProbability)} of simulated outcomes.`);
  }
  const widest = [...cmp.scenarios].sort((a, b) => b.metrics.bestFinalNetWorth - b.metrics.worstFinalNetWorth - (a.metrics.bestFinalNetWorth - a.metrics.worstFinalNetWorth))[0];
  if (widest) out.push(`${widest.name} has the widest spread between best (${money(widest.metrics.bestFinalNetWorth, cur, { compact: true })}) and worst case (${money(widest.metrics.worstFinalNetWorth, cur, { compact: true })}).`);
  const upfront = [...cmp.scenarios].sort((a, b) => b.metrics.upfrontCost - a.metrics.upfrontCost)[0];
  if (upfront && upfront.metrics.upfrontCost > 0) out.push(`${upfront.name} needs the most cash upfront: ${money(upfront.metrics.upfrontCost, cur)} in its first year.`);
  const times = cmp.scenarios.map((s) => s.metrics.avgFreeHoursPerWeek);
  if (Math.max(...times) - Math.min(...times) >= 2) {
    const most = cmp.scenarios.find((s) => s.metrics.avgFreeHoursPerWeek === Math.max(...times))!;
    out.push(`${most.name} leaves the most free time, about ${number(Math.max(...times) - Math.min(...times))} more hours a week than the least.`);
  }
  const fits = cmp.scenarios.filter((s) => s.fit !== null);
  if (fits.length >= 2) {
    const bestFit = [...fits].sort((a, b) => b.fit! - a.fit!)[0]!;
    if (bestFit.id !== top.id) out.push(`${bestFit.name} fits your stated priorities best (${bestFit.fit}/100), even though it is not the strongest financially.`);
    else out.push(`${bestFit.name} is both the strongest financially and the best fit with your priorities (${bestFit.fit}/100).`);
  }
  return out;
}

export function CompareTab({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, goTo } = ctx;
  const { profile } = useSession();
  const [field, setField] = useState<SeriesField>('netWorth');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [bandsOn, setBandsOn] = useState(false);
  const active = useMemo(() => drafts.scenarios.filter((s) => s.status === 'active'), [drafts.scenarios]);
  const decisionWithPriorities = useMemo(() => ({ ...decision, priorities: decision.priorities ?? profile?.priorities ?? {} }), [decision, profile]);
  const cmp = useComparison(decisionWithPriorities, active, results, field);
  const cur = decision.baseCurrency;
  const fxMissing = active.filter((s) => fxFor(s, cur).missing);
  const unit = field === 'freeHoursPerWeek' ? 'h' : 'money';

  const { series, bands } = useMemo(() => {
    if (!cmp) return { series: [] as LineSeries[], bands: [] as Band[] };
    const ser: LineSeries[] = active.map((s) => ({
      id: s.id,
      label: s.name,
      color: seriesColor(s.colorIndex),
      dashed: fxFor(s, cur).missing,
      points: cmp.series.map((p) => ({ x: monthNumber(p.date), y: p.values[s.id] ?? null })),
    }));
    const b: Band[] = [];
    if (bandsOn && field === 'netWorth') {
      for (const s of active) {
        const r = results.get(s.id);
        if (!r?.uncertainty?.hasUncertainty) continue;
        const fx = fxFor(s, cur).rate;
        const start = monthNumber(r.startDate);
        b.push({ id: `band-${s.id}`, label: `${s.name} · 80 % range`, color: seriesColor(s.colorIndex), opacity: 0.1, points: r.uncertainty.netWorthBands.map((pb, i) => ({ x: start + i * 12 + 11, lo: pb.p10 * fx, hi: pb.p90 * fx })) });
      }
    }
    return { series: ser, bands: b };
  }, [cmp, active, results, bandsOn, field, cur]);

  if (!cmp) return null;
  const diffs = keyDifferences(cmp, cur);
  const sc = cmp.scenarios;
  const groups: { id: string; label: string }[] = [
    { id: 'outcome', label: 'Outcome' },
    { id: 'cashflow', label: 'Cash flow' },
    { id: 'risk', label: 'Risk' },
    { id: 'life', label: 'Life' },
  ];

  return (
    <div className="compare">
      {fxMissing.length > 0 && (
        <Callout tone="warn">
          {fxMissing.map((s) => s.name).join(', ')} {fxMissing.length === 1 ? 'uses' : 'use'} a different currency without an exchange rate, so {fxMissing.length === 1 ? 'it is' : 'they are'} shown unconverted (dashed).{' '}
          <button className="link-button" onClick={() => goTo('scenarios', fxMissing[0]!.id)}>
            Set the rate
          </button>
        </Callout>
      )}

      <section>
        <div className="chart-head">
          <Segmented label="Measure" value={field} onChange={setField} options={FIELDS} />
          <div className="row">
            {field === 'netWorth' && (
              <label className="checkbox" style={{ fontSize: 'var(--text-xs)' }}>
                <input type="checkbox" checked={bandsOn} onChange={(e) => setBandsOn(e.target.checked)} />
                Show 80 % ranges
              </label>
            )}
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'chart', label: <ChartLine size={14} aria-label="Chart" /> },
                { value: 'table', label: <Table2 size={14} aria-label="Table" /> },
              ]}
            />
          </div>
        </div>
        {view === 'chart' ? (
          <LineChart
            series={series}
            bands={bands}
            height={340}
            xFormat={(x) => monthLabel(monthNumberToDate(x))}
            xTickFormat={(x) => monthNumberToDate(x).slice(0, 4)}
            yFormat={(v) => (unit === 'h' ? `${number(v)} h/wk` : money(v, cur))}
            yTickFormat={(v) => (unit === 'h' ? `${number(v)} h` : money(v, cur, { compact: true }))}
            ariaLabel={`${FIELDS.find((f) => f.value === field)!.label} over time for each scenario`}
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  {active.map((s) => (
                    <th key={s.id} className="r">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmp.series.map((p) => (
                  <tr key={p.date}>
                    <td>{monthLabel(p.date)}</td>
                    {active.map((s) => (
                      <td key={s.id} className="r">
                        {p.values[s.id] === null || p.values[s.id] === undefined ? '—' : unit === 'h' ? `${number(p.values[s.id]!)} h` : money(p.values[s.id]!, cur)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
          Expected case, converted to {cur} at each scenario’s exchange rate. {field === 'netIncome' || field === 'totalExpenses' ? 'Values are for the month shown.' : ''}
        </p>
      </section>

      {diffs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Key differences</h2>
            <span className="meta">Calculated from the projections — not AI</span>
          </div>
          <ul className="diff-list">
            {diffs.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Side by side</h2>
          <span className="meta">
            <Check size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /> marks the most favourable value
          </span>
        </div>
        <div className="table-scroll">
          <table className="table compare-table">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }} />
                {sc.map((s) => {
                  const dto = active.find((a) => a.id === s.id) as ScenarioDTO;
                  return (
                    <th key={s.id} className="r">
                      <button className="th-scenario" onClick={() => goTo('scenarios', s.id)}>
                        <ScenarioDot index={dto.colorIndex} />
                        <span>{s.name}</span>
                      </button>
                      {s.isBaseline && <div className="th-sub">Baseline</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.id} group={g} cmp={cmp} cur={cur} />
              ))}
              <tr className="group-row">
                <td colSpan={sc.length + 1}>Versus baseline</td>
              </tr>
              <tr>
                <td className="lead">Difference at horizon</td>
                {sc.map((s) => (
                  <td key={s.id} className={`r ${s.deltaVsBaseline && s.deltaVsBaseline > 0 ? 'delta-good' : s.deltaVsBaseline && s.deltaVsBaseline < 0 ? 'delta-bad' : ''}`}>
                    {s.isBaseline ? '—' : money(s.deltaVsBaseline, cur, { sign: true })}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="lead">Stays ahead from</td>
                {sc.map((s) => (
                  <td key={s.id} className="r">
                    {s.isBaseline ? '—' : s.overtakesBaselineAt ? monthLabel(s.overtakesBaselineAt) : 'Not within horizon'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="lead">Fit with your priorities</td>
                {sc.map((s) => (
                  <td key={s.id} className="r">
                    {s.fit === null ? (
                      <button className="link-button" onClick={() => goTo('scenarios', s.id)}>
                        Rate it
                      </button>
                    ) : (
                      `${s.fit}/100`
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {sc.some((s) => (results.get(s.id)?.warnings.filter((w) => w.code === 'missing_value').length ?? 0) > 0) && (
          <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
            <TriangleAlert size={13} aria-hidden /> Some scenarios still have missing assumptions, which count as zero. Fill them in under Scenarios for a fair comparison.
          </p>
        )}
      </section>
    </div>
  );
}

function GroupRows({ group, cmp, cur }: { group: { id: string; label: string }; cmp: Comparison; cur: string }) {
  const metrics = COMPARISON_METRICS.filter((m) => m.group === group.id);
  return (
    <>
      <tr className="group-row">
        <td colSpan={cmp.scenarios.length + 1}>{group.label}</td>
      </tr>
      {metrics.map((m) => (
        <tr key={m.key}>
          <td className="lead">{m.label}</td>
          {cmp.scenarios.map((s) => {
            const lead = cmp.leaders[m.key] === s.id;
            const v = s.metrics[m.key as keyof ComparisonMetrics];
            return (
              <td key={s.id} className={`r ${lead ? 'leader' : ''}`}>
                {lead && <Check size={12} aria-label="Most favourable" style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />}
                {fmtMetric(v, m.unit, cur)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
