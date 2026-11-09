import { useState } from 'react';
import { CircleAlert, ShieldCheck, Table2, ChartLine } from 'lucide-react';
import { monthNumber, monthNumberToDate, type SimulationResult } from '@whatif/engine';
import type { ScenarioDTO } from '@whatif/shared';
import { post } from '../../api/client';
import { LineChart, type Band, type LineSeries } from '../../components/charts/LineChart';
import { durationMonths, money, monthLabel, number, pct, prob } from '../../lib/format';
import { Badge, Button, Segmented, seriesColor, useToast } from '../../components/ui';

type Field = 'netWorth' | 'realNetWorth' | 'cash';

export function ProjectionPanel({ scenario, result }: { scenario: ScenarioDTO; result: SimulationResult }) {
  const [field, setField] = useState<Field>('netWorth');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const cur = scenario.currency;
  const s = result.expected.summary;
  const color = seriesColor(scenario.colorIndex);
  const start = monthNumber(result.startDate);
  const yearX = (i: number) => start + i * 12 + 11;
  const startPoint = { x: start - 1, y: field === 'cash' ? (scenario.variables.startingCash?.value ?? 0) : s.startingNetWorth };

  const pick = (c: 'best' | 'worst') => (field === 'cash' ? result.cases[c].cash : field === 'realNetWorth' ? result.cases[c].realNetWorth : result.cases[c].netWorth);
  const series: LineSeries[] = [
    { id: 'expected', label: 'Expected', color, points: [startPoint, ...result.expected.years.map((y, i) => ({ x: yearX(i), y: y[field] }))] },
    { id: 'best', label: 'Best case', color: 'var(--text-3)', faint: true, dashed: true, points: [startPoint, ...pick('best').map((v, i) => ({ x: yearX(i), y: v }))] },
    { id: 'worst', label: 'Worst case', color: 'var(--text-3)', faint: true, dashed: true, points: [startPoint, ...pick('worst').map((v, i) => ({ x: yearX(i), y: v }))] },
  ];
  const bands: Band[] =
    field === 'netWorth' && result.uncertainty?.hasUncertainty
      ? [
          { id: 'p', label: 'P10–P90 (80 % of futures)', color, opacity: 0.09, points: [{ x: startPoint.x, lo: startPoint.y, hi: startPoint.y }, ...result.uncertainty.netWorthBands.map((b, i) => ({ x: yearX(i), lo: b.p10, hi: b.p90 }))] },
          { id: 'q', label: 'P25–P75 (middle half)', color, opacity: 0.16, points: [{ x: startPoint.x, lo: startPoint.y, hi: startPoint.y }, ...result.uncertainty.netWorthBands.map((b, i) => ({ x: yearX(i), lo: b.p25, hi: b.p75 }))] },
        ]
      : [];

  const fmtX = (x: number) => monthLabel(monthNumberToDate(x));
  const tick = (x: number) => monthNumberToDate(x).slice(0, 4);
  const errorWarnings = result.warnings.filter((w) => w.code !== 'missing_value');

  return (
    <div className="projection">
      <div className="stats compact">
        <div className="stat">
          <div className="stat-label">Net worth in {result.expected.years[result.expected.years.length - 1]?.label}</div>
          <div className="stat-value num">{money(s.finalNetWorth, cur, { compact: true })}</div>
          <div className="stat-sub">{money(s.finalRealNetWorth, cur, { compact: true })} in today’s money</div>
        </div>
        <div className="stat">
          <div className="stat-label">Range</div>
          <div className="stat-value num" style={{ fontSize: 'var(--text-lg)' }}>
            {result.uncertainty?.hasUncertainty ? `${money(result.uncertainty.finalNetWorth.p10, cur, { compact: true })} – ${money(result.uncertainty.finalNetWorth.p90, cur, { compact: true })}` : '—'}
          </div>
          <div className="stat-sub">{result.uncertainty?.hasUncertainty ? '80 % of simulated outcomes' : 'Add ranges to see uncertainty'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Monthly surplus, year 1</div>
          <div className={`stat-value num ${s.avgMonthlyNetCashFlowYear1 < 0 ? 'delta-bad' : ''}`}>{money(s.avgMonthlyNetCashFlowYear1, cur, { compact: true })}</div>
          <div className="stat-sub">{s.savingsRateYear1 !== null ? `${pct(s.savingsRateYear1)} savings rate` : 'No income in year 1'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Lowest cash</div>
          <div className={`stat-value num ${s.lowestCash < 0 ? 'delta-bad' : ''}`}>{money(s.lowestCash, cur, { compact: true })}</div>
          <div className="stat-sub">
            {monthLabel(monthNumberToDate(start + s.lowestCashMonth))}
            {result.uncertainty ? ` · ${prob(result.uncertainty.shortfallProbability)} shortfall risk` : ''}
          </div>
        </div>
      </div>

      <div className="chart-head" style={{ marginTop: 'var(--s-5)' }}>
        <Segmented
          label="Measure"
          value={field}
          onChange={setField}
          options={[
            { value: 'netWorth', label: 'Net worth' },
            { value: 'realNetWorth', label: 'Today’s money' },
            { value: 'cash', label: 'Cash' },
          ]}
        />
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
      {view === 'chart' ? (
        <LineChart
          series={series}
          bands={bands}
          height={260}
          xFormat={fmtX}
          xTickFormat={tick}
          yFormat={(v) => money(v, cur)}
          yTickFormat={(v) => money(v, cur, { compact: true })}
          ariaLabel={`Projected ${field} for ${scenario.name}`}
        />
      ) : (
        <div className="table-scroll" style={{ maxHeight: 340 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="r">Net income</th>
                <th className="r">Costs</th>
                <th className="r">Cash</th>
                <th className="r">Net worth</th>
                <th className="r">Free h/wk</th>
              </tr>
            </thead>
            <tbody>
              {result.expected.years.map((y) => (
                <tr key={y.year}>
                  <td>{y.label}</td>
                  <td className="r">{money(y.netIncome, cur)}</td>
                  <td className="r">{money(y.totalExpenses, cur)}</td>
                  <td className="r">{money(y.cash, cur)}</td>
                  <td className="r">{money(y.netWorth, cur)}</td>
                  <td className="r">{number(y.avgFreeHoursPerWeek)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errorWarnings.length > 0 && (
        <ul className="warning-list">
          {errorWarnings.map((w, i) => (
            <li key={i}>
              <CircleAlert size={13} aria-hidden /> {w.message}
            </li>
          ))}
        </ul>
      )}

      <details className="explain" open>
        <summary>How this is calculated</summary>
        <table className="table">
          <tbody>
            {result.explanation.map((l) => (
              <tr key={l.label}>
                <td>
                  <div>{l.label}</div>
                  <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                    {l.formula}
                  </div>
                </td>
                <td className="r">
                  {l.unit === 'currency' ? money(l.value, cur) : l.unit === 'currency_month' ? `${money(l.value, cur)}/mo` : l.unit === 'percent' ? pct(l.value) : l.unit === 'months' ? durationMonths(l.value) : number(l.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
          Best and worst cases set every ranged input to its favourable or unfavourable end at once. The darker band holds the middle half of {result.uncertainty?.runs ?? 0} simulated futures, the lighter band 80 % of them — including year-to-year market and inflation swings, job-loss risk and surprises where you set them. None of these are predictions.
        </p>
      </details>
      <RunRecord scenario={scenario} result={result} />
    </div>
  );
}

function RunRecord({ scenario, result }: { scenario: ScenarioDTO; result: SimulationResult }) {
  const toast = useToast();
  const [verifying, setVerifying] = useState(false);
  const run = scenario.latestRun;
  const matches = run && run.inputHash === result.inputHash;
  return (
    <div className="run-record">
      <ShieldCheck size={14} aria-hidden />
      {run && matches ? (
        <>
          <span>
            Saved run <code>{run.id.slice(0, 8)}</code> · inputs <code>{run.inputHash}</code> · engine {run.engineVersion} · seed {run.seed}
          </span>
          <Button
            variant="ghost"
            size="sm"
            loading={verifying}
            onClick={async () => {
              setVerifying(true);
              try {
                const r = await post<{ reproducible: boolean | null; reason?: string }>(`/runs/${run.id}/verify`);
                toast(r.reproducible ? 'Verified: re-running the stored inputs gives an identical result.' : (r.reason ?? 'The stored result could not be reproduced.'), r.reproducible ? 'good' : 'bad');
              } catch (err) {
                toast((err as Error).message, 'bad');
              } finally {
                setVerifying(false);
              }
            }}
          >
            Verify
          </Button>
        </>
      ) : (
        <span>Live preview · inputs {result.inputHash}. The server stores a reproducible run when your changes are saved.</span>
      )}
      <Badge outline>v{scenario.version}</Badge>
    </div>
  );
}
