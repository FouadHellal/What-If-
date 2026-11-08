import { useState } from 'react';
import { CircleAlert, CircleHelp, Lightbulb, ListChecks, Plus, ShieldAlert, Trash2, TrendingUp } from 'lucide-react';
import { getVariableDefinition, isVariableKey, type Insight, type SensitivityItem } from '@whatif/engine';
import { SOURCE_LABELS, type AssumptionDTO } from '@whatif/shared';
import { del, post } from '../../api/client';
import { Tornado } from '../../components/charts/Tornado';
import { formatUnit, money, prob } from '../../lib/format';
import { Badge, Button, Callout, ScenarioDot, Select, Textarea, useToast } from '../../components/ui';
import type { WorkspaceContext } from './Workspace';

const SEVERITY_TONE = { high: 'bad', medium: 'warn', low: undefined } as const;

function InsightItem({ i }: { i: Insight }) {
  const Icon = i.kind === 'risk' ? ShieldAlert : i.kind === 'opportunity' ? TrendingUp : CircleHelp;
  return (
    <li className={`insight insight-${i.kind}`}>
      <Icon size={16} aria-hidden />
      <div>
        <div className="row" style={{ gap: 8 }}>
          <span className="insight-title">{i.title}</span>
          {i.kind !== 'gap' && <Badge tone={i.kind === 'risk' ? SEVERITY_TONE[i.severity] : 'good'}>{i.kind === 'risk' ? `${i.severity} risk` : i.severity === 'high' ? 'strong' : 'opportunity'}</Badge>}
        </div>
        <p className="insight-detail">{i.detail}</p>
      </div>
    </li>
  );
}

export function RisksTab({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, selectedId, goTo } = ctx;
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const selected = active.find((s) => s.id === selectedId) ?? active[0];
  if (!selected) return null;
  const r = results.get(selected.id);
  const cur = selected.currency;

  const formatInput = (it: SensitivityItem, v: number) => {
    if (isVariableKey(it.key)) return formatUnit(v, getVariableDefinition(it.key).unit, cur);
    const f = selected.flows.find((x) => `flow:${x.id}` === it.key);
    if (f?.kind === 'time') return `${v} h/wk`;
    return money(v, cur) + (f && !f.kind.startsWith('one_time') ? '/mo' : '');
  };

  const risks = r?.insights.filter((i) => i.kind === 'risk') ?? [];
  const opps = r?.insights.filter((i) => i.kind === 'opportunity') ?? [];
  const gaps = r?.insights.filter((i) => i.kind === 'gap') ?? [];

  return (
    <div className="risks-tab">
      <div className="chart-head">
        <div className="scenario-pills" role="tablist" aria-label="Scenario">
          {active.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === selected.id} className="scenario-pill" onClick={() => goTo('risks', s.id)}>
              <ScenarioDot index={s.colorIndex} />
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {r && (
        <div className="grid-2">
          <section>
            <div className="section-head">
              <h2 className="section-title">What the numbers flag</h2>
              <span className="meta">Rule-based, from this projection</span>
            </div>
            {risks.length + opps.length + gaps.length === 0 ? (
              <p className="faint" style={{ padding: 'var(--s-4) 0', fontSize: 'var(--text-sm)' }}>
                Nothing stands out. Add ranges to your assumptions to test how robust this path is.
              </p>
            ) : (
              <ul className="insight-list">
                {[...risks, ...gaps, ...opps].map((i) => (
                  <InsightItem key={i.id} i={i} />
                ))}
              </ul>
            )}
          </section>
          <section>
            <div className="section-head">
              <h2 className="section-title">Uncertainty</h2>
              <span className="meta">{r.uncertainty?.hasUncertainty ? `${r.uncertainty.runs} simulated variations · seed ${r.uncertainty.seed}` : 'No ranges set'}</span>
            </div>
            {r.uncertainty?.hasUncertainty ? (
              <div className="stats compact" style={{ borderTop: 0 }}>
                <div className="stat">
                  <div className="stat-label">Pessimistic (P10)</div>
                  <div className="stat-value num">{money(r.uncertainty.finalNetWorth.p10, cur, { compact: true })}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Median</div>
                  <div className="stat-value num">{money(r.uncertainty.finalNetWorth.p50, cur, { compact: true })}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Optimistic (P90)</div>
                  <div className="stat-value num">{money(r.uncertainty.finalNetWorth.p90, cur, { compact: true })}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Cash shortfall</div>
                  <div className="stat-value num">{prob(r.uncertainty.shortfallProbability)}</div>
                  <div className="stat-sub">of outcomes dip below zero</div>
                </div>
              </div>
            ) : (
              <Callout>
                Give uncertain inputs a low–high range (the <strong>Range</strong> button next to each value) to see how often things go wrong and how wide the outcomes are.{' '}
                <button className="link-button" onClick={() => goTo('scenarios', selected.id)}>
                  Edit assumptions
                </button>
              </Callout>
            )}
            <div className="case-strip">
              <div>
                <span className="faint">Worst case</span>
                <strong className="num">{money(r.cases.worst.summary.finalNetWorth, cur)}</strong>
              </div>
              <div>
                <span className="faint">Expected</span>
                <strong className="num">{money(r.expected.summary.finalNetWorth, cur)}</strong>
              </div>
              <div>
                <span className="faint">Best case</span>
                <strong className="num">{money(r.cases.best.summary.finalNetWorth, cur)}</strong>
              </div>
            </div>
          </section>
        </div>
      )}

      {r && r.sensitivity.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Which assumptions matter most</h2>
            <span className="meta">Final net worth when one input moves across its range</span>
          </div>
          <Tornado items={r.sensitivity.slice(0, 8)} base={r.expected.summary.finalNetWorth} format={(v) => money(v, cur, { compact: true })} formatInput={formatInput} />
          {r.sensitivity.some((s) => s.basis === 'default') && (
            <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
              Inputs without a range use a standard spread (±10 % for amounts, ±1–3 points for rates) so they can still be compared.
            </p>
          )}
        </section>
      )}

      <NotesSection ctx={ctx} scenarioId={selected.id} decisionId={decision.id} assumptions={decision.assumptions} />
    </div>
  );
}

const CATS: { id: AssumptionDTO['category']; label: string; icon: typeof ListChecks }[] = [
  { id: 'risk', label: 'Risks', icon: CircleAlert },
  { id: 'opportunity', label: 'Opportunities', icon: Lightbulb },
  { id: 'assumption', label: 'Assumptions', icon: ListChecks },
  { id: 'question', label: 'Open questions', icon: CircleHelp },
];

function NotesSection({ ctx, scenarioId, decisionId, assumptions }: { ctx: WorkspaceContext; scenarioId: string; decisionId: string; assumptions: AssumptionDTO[] }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<AssumptionDTO['category']>('risk');
  const [likelihood, setLikelihood] = useState<string>('');
  const [impact, setImpact] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const mine = assumptions.filter((a) => a.scenarioId === scenarioId || a.scenarioId === null);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await post(`/decisions/${decisionId}/assumptions`, { text, category, scenarioId, likelihood: likelihood || null, impact: impact || null });
      setText('');
      ctx.refresh();
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Your notes on this path</h2>
        <span className="meta">What the model cannot capture</span>
      </div>
      <div className="grid-2" style={{ gap: 'var(--s-6)' }}>
        <div className="notes-columns">
          {CATS.map((c) => {
            const list = mine.filter((a) => a.category === c.id);
            return (
              <div key={c.id} className="notes-col">
                <h3>
                  <c.icon size={14} aria-hidden /> {c.label} <span className="faint">{list.length || ''}</span>
                </h3>
                {list.length === 0 ? (
                  <p className="faint" style={{ fontSize: 'var(--text-xs)' }}>None yet.</p>
                ) : (
                  <ul>
                    {list.map((a) => (
                      <li key={a.id}>
                        <div style={{ flex: 1 }}>
                          <div>{a.text}</div>
                          <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                            {SOURCE_LABELS[a.source].label}
                            {a.likelihood ? ` · likelihood ${a.likelihood}` : ''}
                            {a.impact ? ` · impact ${a.impact}` : ''}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          icon={<Trash2 />}
                          onClick={async () => {
                            try {
                              await del(`/assumptions/${a.id}`);
                              ctx.refresh();
                            } catch (err) {
                              toast((err as Error).message, 'bad');
                            }
                          }}
                        >
                          Remove note
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div className="note-form">
          <Textarea aria-label="New note" rows={3} placeholder="e.g. My partner would need to find work too." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <Select aria-label="Category" className="input-sm" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value as AssumptionDTO['category'])}>
              {CATS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label.replace(/s$/, '')}
                </option>
              ))}
            </Select>
            {(category === 'risk' || category === 'opportunity') && (
              <>
                <Select aria-label="Likelihood" className="input-sm" style={{ width: 'auto' }} value={likelihood} onChange={(e) => setLikelihood(e.target.value)}>
                  <option value="">Likelihood</option>
                  <option value="low">Unlikely</option>
                  <option value="medium">Possible</option>
                  <option value="high">Likely</option>
                </Select>
                <Select aria-label="Impact" className="input-sm" style={{ width: 'auto' }} value={impact} onChange={(e) => setImpact(e.target.value)}>
                  <option value="">Impact</option>
                  <option value="low">Minor</option>
                  <option value="medium">Moderate</option>
                  <option value="high">Major</option>
                </Select>
              </>
            )}
            <Button variant="secondary" size="sm" icon={<Plus />} loading={busy} disabled={!text.trim()} onClick={() => void add()}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
