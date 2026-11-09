import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, CircleAlert, Globe, Lock, Plus, Send, Settings, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { RESEARCH_COUNTRY_HINT, type AiMessageDTO, type DecisionDTO, type DecisionMemory, type EvidenceBasis, type EvidenceDTO, COUNTRIES } from '@whatif/shared';
import { isVariableKey } from '@whatif/engine';
import { ApiError, del, get, patch, post } from '../../api/client';
import { keys, useAiSettings } from '../../api/queries';
import { dateLabel, number, relativeTime, todayISO } from '../../lib/format';
import { Badge, Button, ButtonLink, Callout, ConfirmDialog, Dialog, Field, Input, NumberInput, Select, Spinner, Textarea, useToast } from '../../components/ui';
import { AnalysisTasks } from './AnalystTab';
import type { WorkspaceContext } from './Workspace';

const BASIS: Record<EvidenceBasis, { label: string; title: string }> = {
  app_data: { label: 'Calculated', title: 'Computed by What-If from your scenarios' },
  user_assumption: { label: 'Your input', title: 'A value you entered or confirmed' },
  external: { label: 'Evidence', title: 'From cited external data' },
  model: { label: 'Model analysis', title: 'Derived by What-If (robustness, thresholds, break-even)' },
  interpretation: { label: 'AI interpretation', title: 'The analyst’s own reasoning — weigh it accordingly' },
};

export function AnalystTab({ ctx }: { ctx: WorkspaceContext }) {
  const settings = useAiSettings();
  const s = settings.data;
  const aiReady = Boolean(s?.enabled && s.configured);
  return (
    <div className="analyst-layout">
      <div className="analyst-main">
        {settings.isLoading ? (
          <Spinner />
        ) : aiReady ? (
          <>
            <Conversation ctx={ctx} />
            <details className="explain section">
              <summary>Structured reviews</summary>
              <AnalysisTasks ctx={ctx} />
            </details>
          </>
        ) : (
          <Callout icon={<Sparkles aria-hidden />}>
            <strong>{s?.configured ? 'The AI analyst is turned off.' : 'No AI analyst is connected.'}</strong> It is optional: everything else, including the Summary analysis and evidence below, works without it. With an AI model you can ask questions about your scenarios in plain language.{' '}
            <ButtonLink to="/settings/ai" size="sm" variant="secondary" icon={<Settings aria-hidden />} style={{ marginTop: 8 }}>
              AI settings
            </ButtonLink>
          </Callout>
        )}
      </div>
      <aside className="analyst-side">
        <MemoryPanel decision={ctx.decision} />
        <EvidencePanel ctx={ctx} />
      </aside>
    </div>
  );
}

function Conversation({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useAiSettings();
  const msgs = useQuery({ queryKey: ['chat', decision.id], queryFn: ({ signal }) => get<AiMessageDTO[]>(`/decisions/${decision.id}/ai/chat`, signal) });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs.data?.length, sending]);

  const send = async (message: string) => {
    if (!message.trim()) return;
    drafts.flush();
    setSending(true);
    setError(null);
    try {
      await post<AiMessageDTO[]>(`/decisions/${decision.id}/ai/chat`, { message });
      setText('');
      void qc.invalidateQueries({ queryKey: ['chat', decision.id] });
      void qc.invalidateQueries({ queryKey: keys.aiSettings });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The analyst could not answer.');
      void qc.invalidateQueries({ queryKey: ['chat', decision.id] });
    } finally {
      setSending(false);
    }
  };

  const saveFact = async (fact: string) => {
    const facts = [...(decision.settings.memory?.facts ?? []), fact].slice(-30);
    try {
      const d = await patch<DecisionDTO>(`/decisions/${decision.id}`, { settings: { memory: { facts } } });
      qc.setQueryData(keys.decision(d.id), d);
      toast('Saved to this decision’s memory.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  const starters = ['Why is the leading scenario ahead?', 'Which assumptions are most dangerous?', 'What costs might I be overlooking?', 'What is the strongest argument against the leading option?'];
  const list = msgs.data ?? [];
  const s = settings.data;
  const savedFacts = new Set(decision.settings.memory?.facts ?? []);

  return (
    <section>
      <div className="row-between" style={{ marginBottom: 'var(--s-3)' }}>
        <div className="row" style={{ gap: 8 }}>
          <h2 className="scenario-title">Ask the analyst</h2>
          {s && (
            <Badge tone="accent" icon={<Sparkles />}>
              {s.model}
            </Badge>
          )}
          {s?.isLocal && <Badge icon={<Lock />}>Local</Badge>}
        </div>
        {list.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setClearOpen(true)}>
            Clear conversation
          </Button>
        )}
      </div>
      <p className="faint" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--s-4)', maxWidth: '72ch' }}>
        Answers draw on this decision’s calculated results, the Summary analysis, your evidence and memory{s?.shareProfile ? ', and your profile context' : ''}. Each statement is labelled with where it comes from; figures the analyst cannot trace to your data are flagged.
      </p>
      <div className="chat">
        {list.length === 0 && !sending && (
          <div className="chat-starters">
            {starters.map((q) => (
              <button key={q} className="example-chip" onClick={() => void send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {list.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="chat-q">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="chat-a">
              {(m.parts ?? [{ text: m.content, basis: 'interpretation' as const }]).map((p, i) => (
                <p key={i} className={`chat-part basis-${p.basis}`}>
                  <span className="basis-tag" title={BASIS[p.basis].title}>
                    {BASIS[p.basis].label}
                  </span>
                  {p.text}
                </p>
              ))}
              {m.unverifiedNumbers.length > 0 && (
                <p className="unverified">
                  <CircleAlert size={13} aria-hidden /> Not found in your data: {m.unverifiedNumbers.join(', ')}
                </p>
              )}
              {m.suggestedFacts.filter((f) => !savedFacts.has(f)).length > 0 && (
                <div className="chat-facts">
                  {m.suggestedFacts
                    .filter((f) => !savedFacts.has(f))
                    .map((f) => (
                      <button key={f} className="example-chip" onClick={() => void saveFact(f)} title="Remember this for future answers">
                        <BookmarkPlus size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /> Remember: {f}
                      </button>
                    ))}
                </div>
              )}
              {m.followUps.length > 0 && (
                <div className="chat-followups">
                  {m.followUps.map((q) => (
                    <button key={q} className="link-button" onClick={() => void send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <div className="faint" style={{ fontSize: 11 }}>
                {m.model} · {relativeTime(m.createdAt)}
              </div>
            </div>
          ),
        )}
        {sending && (
          <div className="chat-a">
            <Spinner label="The analyst is thinking" /> <span className="faint">Reading your scenarios…</span>
          </div>
        )}
        <div ref={end} />
      </div>
      {error && <Callout tone="bad">{error}</Callout>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <Textarea
          aria-label="Your question"
          rows={2}
          placeholder="e.g. What happens if I delay the move by a year?"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <Button type="submit" variant="primary" icon={<Send />} loading={sending} disabled={!text.trim()}>
          Ask
        </Button>
      </form>
      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear this conversation?"
        description="Messages are deleted. Saved memory is kept."
        confirmLabel="Clear"
        onConfirm={async () => {
          await del(`/decisions/${decision.id}/ai/chat`);
          void qc.invalidateQueries({ queryKey: ['chat', decision.id] });
          setClearOpen(false);
        }}
      />
    </section>
  );
}

function MemoryPanel({ decision }: { decision: DecisionDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [m, setM] = useState<DecisionMemory>(decision.settings.memory ?? {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setM(decision.settings.memory ?? {});
  }, [decision.settings.memory, dirty]);
  const save = async (next: DecisionMemory = m) => {
    try {
      const d = await patch<DecisionDTO>(`/decisions/${decision.id}`, { settings: { memory: next } });
      qc.setQueryData(keys.decision(d.id), d);
      setDirty(false);
      toast('Memory saved.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };
  return (
    <section className="side-section">
      <h3>Decision memory</h3>
      <p className="faint">Context the analyst uses for this decision only. Never shared with other decisions or users.</p>
      <Field label="What you want from this decision" htmlFor="mem-obj" optional>
        <Textarea id="mem-obj" rows={2} value={m.objectives ?? ''} onChange={(e) => (setM({ ...m, objectives: e.target.value }), setDirty(true))} />
      </Field>
      <Field label="Constraints" htmlFor="mem-con" optional>
        <Textarea id="mem-con" rows={2} value={m.constraints ?? ''} onChange={(e) => (setM({ ...m, constraints: e.target.value }), setDirty(true))} />
      </Field>
      <Field label="Risk stance" htmlFor="mem-risk" optional>
        <Select id="mem-risk" value={m.riskStance ?? ''} onChange={(e) => (setM({ ...m, riskStance: (e.target.value || null) as DecisionMemory['riskStance'] }), setDirty(true))}>
          <option value="">Not specified</option>
          <option value="cautious">Cautious</option>
          <option value="balanced">Balanced</option>
          <option value="adventurous">Adventurous</option>
        </Select>
      </Field>
      {(m.facts ?? []).length > 0 && (
        <ul className="memory-facts">
          {(m.facts ?? []).map((f, i) => (
            <li key={i}>
              <span>{f}</span>
              <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} onClick={() => void save({ ...m, facts: (m.facts ?? []).filter((_, j) => j !== i) })}>
                Forget this
              </Button>
            </li>
          ))}
        </ul>
      )}
      {dirty && (
        <Button size="sm" variant="primary" onClick={() => void save()}>
          Save memory
        </Button>
      )}
    </section>
  );
}

function EvidencePanel({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['evidence', decision.id], queryFn: ({ signal }) => get<EvidenceDTO[]>(`/decisions/${decision.id}/evidence`, signal) });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [using, setUsing] = useState<EvidenceDTO | null>(null);
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const otherCurrencies = [...new Set(active.map((s) => s.currency).filter((c) => c !== decision.baseCurrency))];

  const research = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      await post(`/decisions/${decision.id}/research`, body);
      void qc.invalidateQueries({ queryKey: ['evidence', decision.id] });
      toast('Added to evidence with its source. Nothing in your scenarios changed.');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'The lookup failed.', 'bad');
    } finally {
      setBusy(null);
    }
  };
  const [country, setCountry] = useState('');

  return (
    <section className="side-section">
      <h3>Evidence</h3>
      <p className="faint">Cited figures you can check assumptions against. They never change a scenario unless you use them.</p>
      <div className="stack-sm">
        {otherCurrencies.map((c) => (
          <Button key={c} size="sm" variant="secondary" icon={<Globe />} loading={busy === `fx-${c}`} onClick={() => void research({ kind: 'exchange_rate', from: c, to: decision.baseCurrency }, `fx-${c}`)}>
            Look up {c} → {decision.baseCurrency} (ECB)
          </Button>
        ))}
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <Select aria-label="Country for inflation" className="input-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Inflation for…</option>
            {COUNTRIES.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" disabled={!country} loading={busy === 'infl'} onClick={() => void research({ kind: 'inflation', country }, 'infl')}>
            World Bank
          </Button>
        </div>
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>
          Add evidence by hand
        </Button>
      </div>
      <ul className="evidence-list">
        {list.data?.map((e) => (
          <li key={e.id}>
            <div className="row-between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div>
                <div className="ev-label">{e.label}</div>
                {e.value !== null && (
                  <div className="ev-value num">
                    {number(e.value, 4)} {e.unit}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Trash2 />}
                onClick={async () => {
                  await del(`/evidence/${e.id}`);
                  void qc.invalidateQueries({ queryKey: ['evidence', decision.id] });
                }}
              >
                Remove evidence
              </Button>
            </div>
            <div className="ev-source">
              {e.sourceUrl ? (
                <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener">
                  {e.sourceName}
                </a>
              ) : (
                e.sourceName
              )}{' '}
              · retrieved {dateLabel(e.retrievedOn)}
              {e.coverage && <> · {e.coverage}</>}
            </div>
            {e.uncertainty && <div className="ev-source">{e.uncertainty}</div>}
            {e.value !== null && (
              <button className="link-button" style={{ fontSize: 11, marginTop: 4 }} onClick={() => setUsing(e)}>
                <Wand2 size={11} aria-hidden style={{ display: 'inline', verticalAlign: '-1px' }} /> Use as an assumption…
              </button>
            )}
          </li>
        ))}
      </ul>
      <AddEvidenceDialog open={adding} onClose={() => setAdding(false)} decisionId={decision.id} />
      <UseEvidenceDialog ctx={ctx} evidence={using} onClose={() => setUsing(null)} />
      <p className="faint" style={{ fontSize: 11 }}>{RESEARCH_COUNTRY_HINT}</p>
    </section>
  );
}

function AddEvidenceDialog({ open, onClose, decisionId }: { open: boolean; onClose: () => void; decisionId: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ label: '', value: null as number | null, unit: '', sourceName: '', sourceUrl: '', retrievedOn: todayISO(), coverage: '', uncertainty: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add evidence"
      description="Record a figure with its source so you can compare it with your assumptions later."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!f.label.trim() || !f.sourceName.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await post(`/decisions/${decisionId}/evidence`, { ...f, unit: f.unit || null, sourceUrl: f.sourceUrl || null, coverage: f.coverage || null, uncertainty: f.uncertainty || null });
                void qc.invalidateQueries({ queryKey: ['evidence', decisionId] });
                onClose();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Field label="What it measures" htmlFor="ev-l" error={error}>
        <Input id="ev-l" placeholder="e.g. Median rent for a 1-bedroom flat in Berlin" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
      </Field>
      <div className="field-row">
        <Field label="Value" htmlFor="ev-v" optional>
          <NumberInput id="ev-v" value={f.value} onChange={(v) => setF({ ...f, value: v })} digits={4} />
        </Field>
        <Field label="Unit" htmlFor="ev-u" optional>
          <Input id="ev-u" placeholder="EUR/month" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Source" htmlFor="ev-s">
          <Input id="ev-s" placeholder="e.g. City rent index 2026" value={f.sourceName} onChange={(e) => setF({ ...f, sourceName: e.target.value })} />
        </Field>
        <Field label="Retrieved on" htmlFor="ev-d">
          <Input id="ev-d" type="date" value={f.retrievedOn} onChange={(e) => e.target.value && setF({ ...f, retrievedOn: e.target.value })} />
        </Field>
      </div>
      <Field label="Link" htmlFor="ev-url" optional>
        <Input id="ev-url" type="url" placeholder="https://" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
      </Field>
      <Field label="Coverage" htmlFor="ev-c" optional hint="Where and when the figure applies.">
        <Input id="ev-c" value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value })} />
      </Field>
      <Field label="How reliable is it?" htmlFor="ev-q" optional>
        <Input id="ev-q" value={f.uncertainty} onChange={(e) => setF({ ...f, uncertainty: e.target.value })} />
      </Field>
    </Dialog>
  );
}

function UseEvidenceDialog({ ctx, evidence, onClose }: { ctx: WorkspaceContext; evidence: EvidenceDTO | null; onClose: () => void }) {
  const { decision, drafts } = ctx;
  const toast = useToast();
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const isFx = evidence?.origin === 'ecb';
  const [scenarioId, setScenarioId] = useState('');
  const [key, setKey] = useState('');
  useEffect(() => {
    if (!evidence) return;
    const fxTarget = active.find((s) => evidence.unit?.endsWith(`per ${s.currency}`));
    setScenarioId(fxTarget?.id ?? active[0]?.id ?? '');
    setKey(isFx ? 'exchangeRate' : evidence.origin === 'worldbank' ? 'inflationRate' : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence]);
  if (!evidence) return null;
  const apply = () => {
    const note = `${evidence.sourceName}, retrieved ${evidence.retrievedOn}${evidence.coverage ? ` (${evidence.coverage})` : ''}`.slice(0, 500);
    if (key === 'exchangeRate') {
      drafts.edit(scenarioId, (s) => ({ ...s, exchangeRateToBase: evidence.value, exchangeRateSource: 'external' }));
    } else if (isVariableKey(key)) {
      drafts.edit(scenarioId, (s) => ({ ...s, variables: { ...s.variables, [key]: { ...(s.variables[key] ?? {}), value: evidence.value, source: 'external', note } } }));
    } else return;
    toast('Assumption updated and labelled as external data.');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Use as an assumption"
      description={`${evidence.label}: ${evidence.value} ${evidence.unit ?? ''}. The value will be labelled “External data” with its source.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!scenarioId || !key} onClick={apply}>
            Use it
          </Button>
        </>
      }
    >
      <Field label="Scenario" htmlFor="ue-s">
        <Select id="ue-s" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          {active.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.currency})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Assumption" htmlFor="ue-k">
        <Select id="ue-k" value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">Choose…</option>
          <option value="exchangeRate">Exchange rate to {decision.baseCurrency}</option>
          <option value="inflationRate">Inflation</option>
          <option value="housingCostMonthly">Rent or housing cost</option>
          <option value="livingCostMonthly">Other living costs</option>
          <option value="grossAnnualIncome">Gross annual salary</option>
          <option value="effectiveTaxRate">Effective tax rate</option>
          <option value="housingGrowthRate">Rent increases</option>
          <option value="investmentReturn">Investment return</option>
        </Select>
      </Field>
    </Dialog>
  );
}
