import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Minus, Plus, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import {
  PRIORITY_FACTORS,
  VARIABLES,
  VARIABLE_GROUPS,
  addMonths,
  type FlowInput,
  type FlowKind,
  type SimulationWarning,
  type VariableDefinition,
  type VariableInput,
} from '@whatif/engine';
import { CURRENCIES, type ScenarioDTO } from '@whatif/shared';
import { formatUnit, monthLabel, unitSuffix } from '../../lib/format';
import { Button, Help, Menu, NumberInput, Select, SourceTag } from '../../components/ui';

type Edit = (updater: (s: ScenarioDTO) => ScenarioDTO) => void;

function digitsFor(def: VariableDefinition) {
  return def.unit.startsWith('currency') ? 0 : def.unit.startsWith('percent') ? 2 : 1;
}

function VariableRow({ def, input, currency, onChange, warning }: { def: VariableDefinition; input: VariableInput | undefined; currency: string; onChange: (v: VariableInput | undefined) => void; warning?: SimulationWarning }) {
  const [showRange, setShowRange] = useState(Boolean(input?.low != null || input?.high != null));
  const value = input?.value ?? null;
  const missing = def.important && !def.hasSystemDefault && value === null;
  const suffix = unitSuffix(def.unit, currency);
  const usingDefault = !input || input.value === null;
  const set = (patch: Partial<VariableInput>) => {
    const next: VariableInput = { value: input?.value ?? null, low: input?.low ?? null, high: input?.high ?? null, note: input?.note ?? null, source: 'user', ...patch };
    // A person's edit makes the value theirs; drop notes that described an assumption.
    if (patch.value !== undefined && input?.source !== 'user') next.note = null;
    onChange(next);
  };
  const id = `var-${def.key}`;
  return (
    <div className={`var-row ${missing ? 'missing' : ''}`}>
      <div className="var-label">
        <div className="var-label-line">
          <label htmlFor={id}>{def.label}</label>
          <Help text={def.description} />
        </div>
        <div className="var-meta">
          {input && input.value !== null ? (
            <SourceTag source={input.source} />
          ) : missing ? (
            <SourceTag source="user" missing />
          ) : def.hasSystemDefault ? (
            <span className="src src-system" title="Built-in default assumption">
              Default
            </span>
          ) : null}
          {def.polarity !== 'none' && (
            <button
              type="button"
              className={`range-toggle ${showRange ? 'on' : ''}`}
              title={showRange ? 'Remove the uncertainty range' : 'Add a low–high range for best/worst cases and uncertainty'}
              onClick={() => {
                if (showRange && (input?.low != null || input?.high != null)) set({ low: null, high: null, value: input?.value ?? null });
                setShowRange(!showRange);
              }}
            >
              {showRange ? <Minus size={11} aria-hidden /> : <Plus size={11} aria-hidden />}
              Range
            </button>
          )}
        </div>
        {input?.note && <div className="var-note">{input.note}</div>}
        {warning && warning.code !== 'missing_value' && <div className="var-warn">{warning.message}</div>}
      </div>
      <div className="var-value">
        <NumberInput
          id={id}
          value={value}
          onChange={(v) => set({ value: v })}
          suffix={suffix}
          digits={digitsFor(def)}
          placeholder={usingDefault && def.hasSystemDefault ? `Default ${def.fallback}` : 'Not set'}
          invalid={missing}
          size="sm"
        />
        {showRange && (
          <div className="var-range">
            <NumberInput size="sm" ariaLabel={`${def.label} low`} value={input?.low ?? null} onChange={(v) => set({ low: v, value: input?.value ?? def.fallback })} digits={digitsFor(def)} placeholder="Low" />
            <span aria-hidden>–</span>
            <NumberInput size="sm" ariaLabel={`${def.label} high`} value={input?.high ?? null} onChange={(v) => set({ high: v, value: input?.value ?? def.fallback })} digits={digitsFor(def)} placeholder="High" />
          </div>
        )}
      </div>
    </div>
  );
}

export function VariableGroups({ scenario, edit, warnings }: { scenario: ScenarioDTO; edit: Edit; warnings: SimulationWarning[] }) {
  const hasProperty = (scenario.variables.propertyPrice?.value ?? 0) > 0;
  const hasDebt = (scenario.variables.startingDebt?.value ?? 0) > 0;
  const [open, setOpen] = useState<Record<string, boolean>>({ start: true, income: true, living: true, investing: true, property: hasProperty, time: false });
  const setVar = (key: VariableDefinition['key'], v: VariableInput | undefined) =>
    edit((s) => {
      const variables = { ...s.variables };
      if (v) variables[key] = v;
      else delete variables[key];
      return { ...s, variables };
    });

  return (
    <div className="var-groups">
      {VARIABLE_GROUPS.map((g) => {
        const defs = VARIABLES.filter((d) => d.group === g.id).filter((d) => {
          if (g.id === 'start' && (d.key === 'debtInterestRate' || d.key === 'debtMonthlyPayment')) return hasDebt;
          if (g.id === 'income' && (d.key === 'extendedSearchMonths')) return (scenario.variables.employmentProbability?.value ?? 100) < 100;
          if (g.id === 'property' && d.key !== 'propertyPrice') return hasProperty;
          return true;
        });
        const missing = defs.filter((d) => d.important && !d.hasSystemDefault && (scenario.variables[d.key]?.value ?? null) === null).length;
        const isOpen = open[g.id] ?? true;
        return (
          <section key={g.id} className="var-group">
            <button type="button" className="var-group-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}>
              {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span className="name">{g.label}</span>
              {missing > 0 && <span className="src src-missing">{missing} to fill</span>}
              <span className="desc">{g.description}</span>
            </button>
            {isOpen && (
              <div className="var-list">
                {defs.map((d) => (
                  <VariableRow key={d.key} def={d} input={scenario.variables[d.key]} currency={scenario.currency} onChange={(v) => setVar(d.key, v)} warning={warnings.find((w) => w.key === d.key)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Flows ───────────────────────────────────────────────────────────────────

const FLOW_KINDS: { kind: FlowKind; label: string; short: string; icon: typeof Wallet }[] = [
  { kind: 'expense', label: 'Recurring cost', short: 'Cost / month', icon: TrendingDown },
  { kind: 'income', label: 'Recurring income', short: 'Income / month', icon: TrendingUp },
  { kind: 'one_time_expense', label: 'One-time cost', short: 'One-time cost', icon: Wallet },
  { kind: 'one_time_income', label: 'One-time income', short: 'One-time income', icon: Wallet },
  { kind: 'time', label: 'Time commitment', short: 'Hours / week', icon: Clock },
];

function newFlowId() {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function FlowsEditor({ scenario, edit }: { scenario: ScenarioDTO; edit: Edit }) {
  const horizonMonths = scenario.horizonYears * 12;
  const update = (id: string, patch: Partial<FlowInput>) =>
    edit((s) => ({ ...s, flows: s.flows.map((f) => (f.id === id ? { ...f, source: 'user', ...patch, ...(patch.amount !== undefined && f.source !== 'user' ? { note: null } : {}) } : f)) }));
  const remove = (id: string) => edit((s) => ({ ...s, flows: s.flows.filter((f) => f.id !== id) }));
  const add = (kind: FlowKind) =>
    edit((s) => ({
      ...s,
      flows: [
        ...s.flows,
        { id: newFlowId(), kind, label: FLOW_KINDS.find((k) => k.kind === kind)!.label, amount: null, startMonth: 0, endMonth: null, annualGrowth: null, amountMode: 'fixed', source: 'user' },
      ],
    }));

  return (
    <section className="var-group">
      <div className="var-group-head static">
        <span className="name">Costs, income & commitments</span>
        <span className="desc">Anything specific to this path: moving costs, tuition, a side income, study time.</span>
      </div>
      {scenario.flows.length === 0 && <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: '8px 0 4px 22px' }}>No items yet.</p>}
      <div className="flow-list">
        {scenario.flows.map((f) => {
          const oneTime = f.kind.startsWith('one_time');
          const isTime = f.kind === 'time';
          const suffix = isTime ? 'h/week' : oneTime ? scenario.currency : f.amountMode === 'percent_of_income' ? '% of salary' : `${scenario.currency}/mo`;
          return (
            <div key={f.id} className={`flow-row ${f.amount === null ? 'missing' : ''}`}>
              <div className="flow-main">
                <input className="input input-sm flow-label" aria-label="Item name" value={f.label} maxLength={120} onChange={(e) => update(f.id, { label: e.target.value || 'Untitled item' })} />
                <Select className="input-sm flow-kind" aria-label="Item type" value={f.kind} onChange={(e) => update(f.id, { kind: e.target.value as FlowKind, endMonth: e.target.value.startsWith('one_time') ? null : f.endMonth, amountMode: 'fixed' })}>
                  {FLOW_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.short}
                    </option>
                  ))}
                </Select>
                <NumberInput className="flow-amount" size="sm" ariaLabel={`${f.label} amount`} value={f.amount} onChange={(v) => update(f.id, { amount: v })} suffix={suffix} digits={isTime ? 1 : 0} min={0} invalid={f.amount === null} />
                <Button className="flow-del" variant="ghost" size="sm" iconOnly icon={<Trash2 />} onClick={() => remove(f.id)}>
                  Remove {f.label}
                </Button>
              </div>
              <div className="flow-timing">
                <label>
                  <span>{oneTime ? 'In month' : 'From month'}</span>
                  <NumberInput size="sm" ariaLabel="Start month" value={f.startMonth} onChange={(v) => update(f.id, { startMonth: Math.max(0, Math.min(horizonMonths - 1, Math.round(v ?? 0))) })} digits={0} min={0} />
                  <span className="faint">{monthLabel(addMonths(scenario.startDate, f.startMonth))}</span>
                </label>
                {!oneTime && (
                  <label>
                    <span>Until</span>
                    <NumberInput size="sm" ariaLabel="End month" value={f.endMonth ?? null} placeholder="End" onChange={(v) => update(f.id, { endMonth: v === null ? null : Math.max(f.startMonth + 1, Math.round(v)) })} digits={0} min={1} />
                    <span className="faint">{f.endMonth ? monthLabel(addMonths(scenario.startDate, f.endMonth)) : 'end of horizon'}</span>
                  </label>
                )}
                {!isTime && !oneTime && (
                  <label>
                    <span>Grows</span>
                    <NumberInput size="sm" ariaLabel="Annual growth" value={f.annualGrowth ?? null} placeholder={f.kind === 'expense' ? 'Inflation' : '0'} onChange={(v) => update(f.id, { annualGrowth: v })} suffix="%/yr" digits={1} />
                  </label>
                )}
                {!isTime && !oneTime && (
                  <label className="checkbox" style={{ alignItems: 'center' }}>
                    <input type="checkbox" checked={f.amountMode === 'percent_of_income'} onChange={(e) => update(f.id, { amountMode: e.target.checked ? 'percent_of_income' : 'fixed' })} />
                    <span>% of salary</span>
                  </label>
                )}
                <SourceTag source={f.source} missing={f.amount === null} />
              </div>
              {f.note && <div className="var-note" style={{ paddingLeft: 2 }}>{f.note}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '8px 0 0' }}>
        <Menu
          align="left"
          trigger={
            <Button variant="ghost" size="sm" icon={<Plus />}>
              Add item
            </Button>
          }
          items={FLOW_KINDS.map((k) => ({ label: k.label, icon: <k.icon />, onSelect: () => add(k.kind) }))}
        />
      </div>
    </section>
  );
}

// ── Qualitative fit ─────────────────────────────────────────────────────────

export function ScoresEditor({ scenario, edit }: { scenario: ScenarioDTO; edit: Edit }) {
  return (
    <section className="var-group">
      <div className="var-group-head static">
        <span className="name">How it fits your life</span>
        <span className="desc">Rate this path 1–5 on what matters beyond money. Weighted by your priorities.</span>
      </div>
      <div className="var-list">
        {PRIORITY_FACTORS.map((f) => {
          const v = scenario.scores[f.key];
          return (
            <div key={f.key} className="var-row score-row">
              <div className="var-label">
                <span>{f.label}</span>
                <Help text={f.description} />
              </div>
              <div className="pips" role="group" aria-label={`${f.label} score`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={v === n}
                    onClick={() =>
                      edit((s) => {
                        const scores = { ...s.scores };
                        if (scores[f.key] === n) delete scores[f.key];
                        else scores[f.key] = n;
                        return { ...s, scores };
                      })
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="var-meta">{v ? <span className="faint" style={{ fontSize: 11 }}>{['', 'Poor', 'Weak', 'Neutral', 'Good', 'Excellent'][v]}</span> : <span className="faint" style={{ fontSize: 11 }}>Unrated</span>}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Scenario settings ───────────────────────────────────────────────────────

export function ScenarioSettings({ scenario, edit, baseCurrency }: { scenario: ScenarioDTO; edit: Edit; baseCurrency: string }) {
  const fxMissing = scenario.currency !== baseCurrency && !scenario.exchangeRateToBase;
  return (
    <div className="scenario-settings">
      <label>
        <span>Starts</span>
        <input
          className="input input-sm"
          type="month"
          value={scenario.startDate}
          onChange={(e) => {
            if (/^\d{4}-\d{2}$/.test(e.target.value)) edit((s) => ({ ...s, startDate: e.target.value }));
          }}
        />
      </label>
      <label>
        <span>Horizon</span>
        <NumberInput size="sm" ariaLabel="Horizon in years" value={scenario.horizonYears} digits={0} suffix="years" min={1} max={50} onChange={(v) => edit((s) => ({ ...s, horizonYears: Math.max(1, Math.min(50, Math.round(v ?? 10))) }))} />
      </label>
      <label>
        <span>Currency</span>
        <Select
          className="input-sm"
          value={scenario.currency}
          onChange={(e) => {
            const c = e.target.value;
            edit((s) => ({ ...s, currency: c, exchangeRateToBase: c === baseCurrency ? 1 : null, exchangeRateSource: null }));
          }}
        >
          {[...new Set([scenario.currency, ...CURRENCIES])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </label>
      {scenario.currency !== baseCurrency && (
        <label>
          <span>
            1 {scenario.currency} = ? {baseCurrency}
          </span>
          <NumberInput
            size="sm"
            ariaLabel="Exchange rate"
            value={scenario.exchangeRateToBase}
            digits={6}
            min={0}
            invalid={fxMissing}
            onChange={(v) => edit((s) => ({ ...s, exchangeRateToBase: v && v > 0 ? v : null, exchangeRateSource: 'user' }))}
          />
          {scenario.exchangeRateSource && scenario.exchangeRateToBase ? <SourceTag source={scenario.exchangeRateSource} /> : null}
        </label>
      )}
    </div>
  );
}

export function summarizeValue(def: VariableDefinition, input: VariableInput | undefined, currency: string) {
  return formatUnit(input?.value ?? (def.hasSystemDefault ? def.fallback : null), def.unit, currency);
}
