import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyPlus, FlaskConical, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import {
  VARIABLES,
  currentInputValue,
  getVariableDefinition,
  inputLabel,
  inputUnit,
  isVariableKey,
  monthNumber,
  monthNumberToDate,
  withInput,
  type ScenarioModel,
  type SimulationResult,
} from '@whatif/engine';
import type { ExperimentDTO, ScenarioDTO } from '@whatif/shared';
import { ApiError, del, get, post } from '../../api/client';
import { LineChart, type Band } from '../../components/charts/LineChart';
import { formatUnit, money, monthLabel, prob, relativeTime, unitSuffix } from '../../lib/format';
import { optionsFor, simulateAsync, toModel } from '../../lib/simulation';
import { Badge, Button, ConfirmDialog, EmptyState, Input, NumberInput, ScenarioDot, Select, Spinner, seriesColor, useToast } from '../../components/ui';
import type { WorkspaceContext } from './Workspace';

const ALWAYS: string[] = ['grossAnnualIncome', 'housingCostMonthly', 'livingCostMonthly', 'incomeStartMonth', 'investmentReturn', 'monthlyInvestment'];

function bounds(input: string, current: number): { min: number; max: number; step: number } {
  const unit = inputUnit(input);
  if (unit === 'months') return { min: 0, max: Math.max(24, Math.round(current * 2 + 12)), step: 1 };
  if (unit === 'percent' || unit === 'percent_year') {
    const def = isVariableKey(input) ? getVariableDefinition(input) : null;
    return { min: Math.max(def?.min ?? -50, Math.floor(current - 8)), max: Math.min(def?.max ?? 100, Math.ceil(current + 8)), step: 0.1 };
  }
  if (unit === 'hours_week') return { min: 0, max: 80, step: 1 };
  if (unit === 'per_year') return { min: 0, max: 12, step: 0.5 };
  const base = Math.abs(current) || 1000;
  const step = base >= 100_000 ? 1000 : base >= 10_000 ? 100 : base >= 1000 ? 10 : 1;
  return { min: Math.max(0, Math.round((current * 0.4) / step) * step), max: Math.round((current * 1.6 + (current === 0 ? 2000 : 0)) / step) * step, step };
}

export function LabTab({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, selectedId, goTo, refresh } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const scenario = active.find((s) => s.id === selectedId) ?? active[0];
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [variant, setVariant] = useState<SimulationResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<ExperimentDTO | null>(null);
  const experiments = useQuery({ queryKey: ['experiments', decision.id], queryFn: ({ signal }) => get<ExperimentDTO[]>(`/decisions/${decision.id}/experiments`, signal) });

  useEffect(() => {
    setChanges({});
    setVariant(null);
  }, [scenario?.id]);

  const original = scenario ? results.get(scenario.id) : undefined;
  const baseModel = useMemo(() => (scenario ? toModel(scenario) : null), [scenario]);
  const inputs = useMemo(() => {
    if (!scenario || !original) return [] as string[];
    const fromSens = original.sensitivity.slice(0, 6).map((s) => s.key);
    const list = [...new Set([...fromSens, ...ALWAYS])].filter((k) => k.startsWith('flow:') || isVariableKey(k));
    return list.slice(0, 9);
  }, [scenario, original]);

  const variantModel: ScenarioModel | null = useMemo(() => {
    if (!baseModel) return null;
    let m = baseModel;
    for (const [k, v] of Object.entries(changes)) m = withInput(m, k, v);
    return m;
  }, [baseModel, changes]);

  useEffect(() => {
    if (!scenario || !variantModel || Object.keys(changes).length === 0) {
      setVariant(null);
      return;
    }
    let alive = true;
    setComputing(true);
    const t = setTimeout(() => {
      simulateAsync(variantModel, optionsFor(scenario, decision))
        .then((r) => alive && setVariant(r))
        .catch(() => alive && setVariant(null))
        .finally(() => alive && setComputing(false));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [variantModel, scenario, decision, changes]);

  if (!scenario || !baseModel) return <EmptyState icon={<FlaskConical />} title="No scenarios to experiment with" />;
  const cur = scenario.currency;
  const v = variant ?? original;
  const changed = Object.keys(changes).length > 0;

  const save = async () => {
    setBusy(true);
    try {
      await post(`/decisions/${decision.id}/experiments`, { scenarioId: scenario.id, name: name.trim() || describeChanges(scenario, changes), changes });
      setName('');
      void qc.invalidateQueries({ queryKey: ['experiments', decision.id] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      toast('Experiment saved. Your scenario is unchanged.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (e: ExperimentDTO, mode: 'update' | 'new') => {
    drafts.flush();
    try {
      const r = await post<{ scenarioId: string }>(`/experiments/${e.id}/apply`, { mode });
      refresh();
      void qc.invalidateQueries({ queryKey: ['experiments', decision.id] });
      toast(mode === 'new' ? 'Saved as a new scenario.' : 'Applied to the scenario.');
      goTo('scenarios', r.scenarioId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not apply the experiment.', 'bad');
    }
  };

  const start = monthNumber(scenario.startDate);
  const yearX = (i: number) => start + i * 12 + 11;
  const bandFor = (r: SimulationResult | undefined, color: string, id: string, label: string): Band[] =>
    r?.uncertainty?.hasUncertainty ? [{ id, label, color, opacity: 0.1, points: r.uncertainty.netWorthBands.map((b, i) => ({ x: yearX(i), lo: b.p25, hi: b.p75 })) }] : [];

  return (
    <div className="lab">
      <div className="lab-head">
        <div>
          <h2 className="scenario-title">Decision Lab</h2>
          <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>
            Change a few assumptions and see the effect instantly. Nothing here modifies your scenario unless you choose to.
          </p>
        </div>
        <Select aria-label="Scenario to experiment on" value={scenario.id} onChange={(e) => goTo('lab', e.target.value)} style={{ width: 'auto' }}>
          {active.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="lab-grid">
        <div className="lab-controls">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span className="eyebrow">Assumptions to vary</span>
            {changed && (
              <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setChanges({})}>
                Reset all
              </Button>
            )}
          </div>
          {inputs.map((input) => {
            const current = currentInputValue(baseModel, input);
            const value = changes[input] ?? current;
            const b = bounds(input, current);
            const unit = inputUnit(input);
            const isChanged = changes[input] !== undefined && changes[input] !== current;
            return (
              <div key={input} className={`lab-input ${isChanged ? 'changed' : ''}`}>
                <div className="row-between">
                  <label htmlFor={`lab-${input}`} className="lab-label">
                    {inputLabel(baseModel, input)}
                  </label>
                  {isChanged && (
                    <button
                      className="link-button"
                      style={{ fontSize: 11 }}
                      onClick={() =>
                        setChanges((c) => {
                          const { [input]: _x, ...rest } = c;
                          return rest;
                        })
                      }
                    >
                      <Undo2 size={11} aria-hidden style={{ display: 'inline', verticalAlign: '-1px' }} /> {formatUnit(current, unit, cur)}
                    </button>
                  )}
                </div>
                <div className="lab-input-row">
                  <input
                    id={`lab-${input}`}
                    type="range"
                    min={Math.min(b.min, value)}
                    max={Math.max(b.max, value)}
                    step={b.step}
                    value={value}
                    onChange={(e) => setChanges((c) => ({ ...c, [input]: Number(e.target.value) }))}
                    aria-valuetext={formatUnit(value, unit, cur)}
                  />
                  <NumberInput size="sm" ariaLabel={`${inputLabel(baseModel, input)} value`} value={value} onChange={(x) => x !== null && setChanges((c) => ({ ...c, [input]: x }))} suffix={unit.startsWith('currency') ? unitSuffix(unit, cur) : unitSuffix(unit, cur)} digits={unit.startsWith('currency') ? 0 : 1} className="lab-number" />
                </div>
              </div>
            );
          })}
        </div>

        <div className="lab-results">
          <div className="lab-compare">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th className="r">Original</th>
                  <th className="r">
                    Experiment {computing && <Spinner label="Recalculating" />}
                  </th>
                  <th className="r">Difference</th>
                </tr>
              </thead>
              <tbody>
                {metricRows(original, changed ? variant : null).map((row) => (
                  <tr key={row.label}>
                    <td className="lead">{row.label}</td>
                    <td className="r">{row.fmt(row.a, cur)}</td>
                    <td className="r">{changed ? row.fmt(row.b, cur) : <span className="faint">—</span>}</td>
                    <td className={`r ${row.delta === null || row.delta === 0 ? '' : row.good ? 'delta-good' : 'delta-bad'}`}>{changed && row.delta !== null ? row.fmtDelta(row.delta, cur) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {original && (
            <LineChart
              height={240}
              series={[
                { id: 'orig', label: 'Original', color: 'var(--text-3)', dashed: changed, points: [{ x: start - 1, y: original.expected.summary.startingNetWorth }, ...original.expected.years.map((y, i) => ({ x: yearX(i), y: y.netWorth }))] },
                ...(changed && v ? [{ id: 'var', label: 'Experiment', color: seriesColor(scenario.colorIndex), points: [{ x: start - 1, y: v.expected.summary.startingNetWorth }, ...v.expected.years.map((y, i) => ({ x: yearX(i), y: y.netWorth }))] }] : []),
              ]}
              bands={changed && variant ? bandFor(variant, seriesColor(scenario.colorIndex), 'vb', 'Experiment · middle 50 %') : bandFor(original, 'var(--text-3)', 'ob', 'Original · middle 50 %')}
              xFormat={(x) => monthLabel(monthNumberToDate(x))}
              xTickFormat={(x) => monthNumberToDate(x).slice(0, 4)}
              yFormat={(y) => money(y, cur)}
              yTickFormat={(y) => money(y, cur, { compact: true })}
              ariaLabel="Net worth: original versus experiment"
            />
          )}
          <div className="lab-save">
            <Input aria-label="Experiment name" placeholder={changed ? describeChanges(scenario, changes) : 'Change an assumption to start'} value={name} onChange={(e) => setName(e.target.value)} disabled={!changed} maxLength={120} />
            <Button variant="primary" icon={<Save />} disabled={!changed} loading={busy} onClick={() => void save()}>
              Save experiment
            </Button>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Experiment history</h2>
          <span className="meta">Each keeps its exact inputs and results</span>
        </div>
        {experiments.data?.length === 0 && <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>No experiments yet.</p>}
        <div className="list">
          {experiments.data?.map((e) => {
            const s = active.find((x) => x.id === e.scenarioId);
            const delta = e.variant.finalNetWorth - e.original.finalNetWorth;
            return (
              <div key={e.id} className="list-row exp-row">
                <ScenarioDot index={s?.colorIndex ?? 0} />
                <div className="grow">
                  <div className="title">
                    {e.name} {e.stale && <Badge tone="warn" title="The scenario changed after this experiment">Scenario changed since</Badge>}
                  </div>
                  <div className="sub">
                    {e.scenarioName} · {Object.keys(e.changes).length} change{Object.keys(e.changes).length === 1 ? '' : 's'} · {relativeTime(e.createdAt)}
                  </div>
                </div>
                <span className={`num ${delta >= 0 ? 'delta-good' : 'delta-bad'}`} style={{ fontSize: 'var(--text-sm)' }}>
                  {money(delta, e.currency, { sign: true, compact: true })}
                </span>
                <div className="row" style={{ gap: 2 }}>
                  <Button size="sm" variant="ghost" onClick={() => (s ? (goTo('lab', s.id), setTimeout(() => setChanges(e.changes), 0)) : undefined)} disabled={!s}>
                    Load
                  </Button>
                  <Button size="sm" variant="ghost" icon={<CopyPlus />} onClick={() => void apply(e, 'new')}>
                    As scenario
                  </Button>
                  <Button size="sm" variant="ghost" disabled={e.stale} onClick={() => setApplying(e)} title={e.stale ? 'The scenario changed since; save it as a new scenario instead' : undefined}>
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<Trash2 />}
                    onClick={async () => {
                      await del(`/experiments/${e.id}`);
                      void qc.invalidateQueries({ queryKey: ['experiments', decision.id] });
                    }}
                  >
                    Delete experiment
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(applying)}
        onClose={() => setApplying(null)}
        title="Apply this experiment to the scenario?"
        description={`“${applying?.scenarioName}” will take the experiment’s values. The previous version stays in its run history.`}
        confirmLabel="Apply"
        onConfirm={async () => {
          const e = applying!;
          setApplying(null);
          await apply(e, 'update');
        }}
      />
    </div>
  );
}

function describeChanges(s: ScenarioDTO, changes: Record<string, number>): string {
  const model = toModel(s);
  const parts = Object.entries(changes).map(([k, v]) => `${inputLabel(model, k)} ${formatUnit(v, inputUnit(k), s.currency)}`);
  return parts.slice(0, 2).join(', ') + (parts.length > 2 ? ` +${parts.length - 2}` : '');
}

function metricRows(a: SimulationResult | undefined, b: SimulationResult | null) {
  const m = (r: SimulationResult | undefined | null) =>
    r
      ? {
          final: r.expected.summary.finalNetWorth,
          p10: r.uncertainty?.hasUncertainty ? r.uncertainty.finalNetWorth.p10 : null,
          p50: r.uncertainty?.hasUncertainty ? r.uncertainty.finalNetWorth.p50 : null,
          p90: r.uncertainty?.hasUncertainty ? r.uncertainty.finalNetWorth.p90 : null,
          short: r.uncertainty?.shortfallProbability ?? null,
          low: r.expected.summary.lowestCash,
          flow: r.expected.summary.avgMonthlyNetCashFlowYear1,
        }
      : null;
  const A = m(a);
  const B = m(b);
  const moneyFmt = (v: number | null | undefined, cur: string) => (v === null || v === undefined ? '—' : money(v, cur));
  const probFmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : prob(v));
  const row = (label: string, ka: keyof NonNullable<typeof A>, kind: 'money' | 'prob', higherBetter: boolean) => {
    const av = A?.[ka] ?? null;
    const bv = B?.[ka] ?? null;
    const delta = av !== null && bv !== null ? bv - av : null;
    return {
      label,
      a: av,
      b: bv,
      delta,
      good: delta !== null && (higherBetter ? delta > 0 : delta < 0),
      fmt: kind === 'money' ? moneyFmt : (v: number | null, _c: string) => probFmt(v),
      fmtDelta: kind === 'money' ? (d: number, cur: string) => money(d, cur, { sign: true }) : (d: number) => `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`,
    };
  };
  return [
    row('Net worth at horizon (expected)', 'final', 'money', true),
    row('Pessimistic (P10)', 'p10', 'money', true),
    row('Median', 'p50', 'money', true),
    row('Optimistic (P90)', 'p90', 'money', true),
    row('Chance of a cash shortfall', 'short', 'prob', false),
    row('Lowest cash (expected)', 'low', 'money', true),
    row('Monthly surplus, year 1', 'flow', 'money', true),
  ];
}

export { VARIABLES };
