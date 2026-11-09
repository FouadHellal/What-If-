import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Award, Briefcase, CircleAlert, Clock, GraduationCap, Home, Landmark, MapPin, Plane, Plus, Repeat, ShoppingBag, Sparkles, Store, Sun, Trash2, TrendingUp, Users } from 'lucide-react';
import { VARIABLES } from '@whatif/engine';
import { CATEGORIES, CURRENCIES, categoryInfo, type DecisionCategory, type DecisionDTO, type DecisionDraft, type ScenarioDraft } from '@whatif/shared';
import { ApiError, get, post } from '../api/client';
import { useAiSettings, useInvalidateDecision } from '../api/queries';
import { formatUnit } from '../lib/format';
import { Badge, Button, Callout, Field, Input, NumberInput, ScenarioDot, Select, SourceTag, Switch, useToast } from '../components/ui';

const ICONS: Record<string, typeof Plane> = { plane: Plane, briefcase: Briefcase, store: Store, home: Home, 'trending-up': TrendingUp, 'graduation-cap': GraduationCap, 'map-pin': MapPin, sun: Sun, repeat: Repeat, users: Users, sparkles: Sparkles, landmark: Landmark, 'shopping-bag': ShoppingBag, clock: Clock, award: Award };

const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Career', ids: ['job_change', 'job_offer', 'career_change', 'business'] },
  { label: 'Financial', ids: ['housing', 'investing', 'debt_payoff', 'major_purchase'] },
  { label: 'Lifestyle', ids: ['relocation', 'city_move', 'sabbatical', 'working_hours', 'family'] },
  { label: 'Education', ids: ['education', 'study_path', 'certification'] },
  { label: 'Other', ids: ['other'] },
];

export default function NewDecision() {
  const navigate = useNavigate();
  const toast = useToast();
  const ai = useAiSettings();
  const invalidate = useInvalidateDecision();
  const [params] = useSearchParams();
  const [question, setQuestion] = useState(() => params.get('q') ?? '');
  const [useAi, setUseAi] = useState(false);
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const [busy, setBusy] = useState<'parse' | 'create' | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'New decision · What-If';
  }, []);

  const aiReady = Boolean(ai.data?.enabled && ai.data.configured);

  const analyze = async () => {
    if (question.trim().length < 5) {
      setError('Describe the decision in a short sentence.');
      return;
    }
    setBusy('parse');
    setError(null);
    try {
      setDraft(await post<DecisionDraft>('/decisions/draft', { question, useAi: useAi && aiReady }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not analyse the question.');
    } finally {
      setBusy(null);
    }
  };

  const fromTemplate = async (cat: DecisionCategory) => {
    setBusy(cat);
    try {
      setDraft(await get<DecisionDraft>(`/decisions/templates/${cat}`));
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!draft) return;
    setBusy('create');
    setError(null);
    try {
      const d = await post<DecisionDTO>('/decisions', { ...draft, title: draft.title.trim() || 'Untitled decision', question: draft.question || null });
      invalidate();
      navigate(`/decisions/${d.id}?tab=scenarios&s=${d.scenarios[1]?.id ?? d.scenarios[0]!.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the decision.');
    } finally {
      setBusy(null);
    }
  };

  if (draft) return <DraftReview draft={draft} setDraft={setDraft} onBack={() => setDraft(null)} onCreate={create} busy={busy === 'create'} error={error} />;

  return (
    <div className="page page-narrow">
      <header style={{ marginBottom: 'var(--s-8)' }}>
        <div className="eyebrow">New decision</div>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          What are you considering?
        </h1>
        <p className="page-subtitle">Write it the way you would say it. What-If will set up the scenarios to compare and point out which assumptions it still needs from you.</p>
      </header>

      <div className="question-box">
        <label htmlFor="question" className="sr-only">
          Your decision
        </label>
        <textarea
          id="question"
          className="question-input serif"
          rows={3}
          placeholder="What if I move from Algeria to Germany and work as a network engineer?"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void analyze();
          }}
        />
        <div className="question-actions">
          <div className="row" style={{ gap: 10 }}>
            {aiReady ? (
              <label className="row" style={{ gap: 8, fontSize: 'var(--text-sm)' }}>
                <Switch checked={useAi} onChange={setUseAi} label="Use the AI analyst" />
                <span>
                  Use the AI analyst <span className="faint">({ai.data!.provider} · {ai.data!.model})</span>
                </span>
              </label>
            ) : (
              <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                Interpreted on this server — no AI needed.
              </span>
            )}
          </div>
          <Button variant="primary" onClick={() => void analyze()} loading={busy === 'parse'} disabled={question.trim().length < 5}>
            Set up scenarios <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
      {useAi && aiReady && (
        <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
          Your question{ai.data!.shareProfile ? ' and baseline profile (goals, location, priorities — not your financial figures)' : ''} will be sent to {ai.data!.isLocal ? 'your local model' : ai.data!.provider}. AI estimates are marked so you can review them.
        </p>
      )}
      {error && (
        <div className="field-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}

      <div className="example-chips">
        {CATEGORIES.filter((c) => c.id !== 'other').slice(0, 6).map((c) => (
          <button key={c.id} type="button" className="example-chip" onClick={() => setQuestion(c.example)}>
            {c.example}
          </button>
        ))}
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Or start from a template</h2>
          <span className="meta">Inputs you must supply are marked; defaults are labelled as assumptions</span>
        </div>
        {GROUPS.map((g) => (
          <div key={g.label} className="template-group">
            <h3>{g.label}</h3>
            <div className="template-grid">
              {CATEGORIES.filter((c) => g.ids.includes(c.id)).map((c) => {
                const Icon = ICONS[c.icon] ?? Sparkles;
                return (
                  <button key={c.id} type="button" className="template" onClick={() => void fromTemplate(c.id)} disabled={busy !== null}>
                    <Icon aria-hidden />
                    <span>
                      <strong>{c.label}</strong>
                      <small>{c.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function missingCount(s: ScenarioDraft) {
  let n = 0;
  for (const v of Object.values(s.variables)) if (v && v.value === null) n++;
  for (const f of s.flows) if (f.amount === null) n++;
  return n;
}

function DraftReview({
  draft,
  setDraft,
  onBack,
  onCreate,
  busy,
  error,
}: {
  draft: DecisionDraft;
  setDraft: (d: DecisionDraft) => void;
  onBack: () => void;
  onCreate: () => void;
  busy: boolean;
  error: string | null;
}) {
  const setScenario = (i: number, patch: Partial<ScenarioDraft>) => setDraft({ ...draft, scenarios: draft.scenarios.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const totalMissing = draft.scenarios.reduce((a, s) => a + missingCount(s), 0);

  return (
    <div className="page page-narrow">
      <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack} style={{ marginBottom: 'var(--s-5)' }}>
        Back
      </Button>
      <div className="eyebrow">Review before creating</div>
      <textarea
        className="title-input serif"
        aria-label="Decision title"
        value={draft.title}
        rows={2}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      {draft.notes.length > 0 && (
        <Callout tone={draft.origin === 'ai' ? 'ai' : undefined}>
          {draft.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </Callout>
      )}

      <div className="field-row" style={{ marginTop: 'var(--s-6)' }}>
        <Field label="Type of decision" htmlFor="cat">
          <Select id="cat" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as DecisionCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Compare in" htmlFor="base" hint="All scenarios are converted to this currency for comparison.">
          <Select
            id="base"
            value={draft.baseCurrency}
            onChange={(e) => {
              const base = e.target.value;
              setDraft({ ...draft, baseCurrency: base, scenarios: draft.scenarios.map((s) => ({ ...s, exchangeRateToBase: s.currency === base ? 1 : s.exchangeRateToBase === 1 ? null : s.exchangeRateToBase })) });
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Planning horizon" htmlFor="hz">
          <NumberInput id="hz" value={draft.horizonYears} digits={0} min={1} max={50} suffix="years" onChange={(v) => {
            const y = Math.max(1, Math.min(50, Math.round(v ?? 10)));
            setDraft({ ...draft, horizonYears: y, scenarios: draft.scenarios.map((s) => ({ ...s, horizonYears: y })) });
          }} />
        </Field>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Scenarios</h2>
          <span className="meta">{totalMissing > 0 ? `${totalMissing} values still need your input — you can fill them in next` : 'All key values set'}</span>
        </div>
        <div className="stack" style={{ gap: 0 }}>
          {draft.scenarios.map((s, i) => {
            const set = VARIABLES.filter((d) => s.variables[d.key]);
            const missing = missingCount(s);
            return (
              <div key={i} className="draft-scenario">
                <div className="row-between" style={{ flexWrap: 'nowrap' }}>
                  <div className="row" style={{ flex: 1, flexWrap: 'nowrap' }}>
                    <ScenarioDot index={i} size={10} />
                    <Input aria-label="Scenario name" className="input-bare" value={s.name} onChange={(e) => setScenario(i, { name: e.target.value })} />
                    {s.isBaseline && <Badge>Baseline</Badge>}
                  </div>
                  {draft.scenarios.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={<Trash2 />}
                      onClick={() => {
                        const rest = draft.scenarios.filter((_, j) => j !== i);
                        if (s.isBaseline && rest[0]) rest[0] = { ...rest[0], isBaseline: true };
                        setDraft({ ...draft, scenarios: rest });
                      }}
                    >
                      Remove scenario
                    </Button>
                  )}
                </div>
                {s.description && <p className="muted" style={{ fontSize: 'var(--text-sm)', margin: '4px 0 0 18px' }}>{s.description}</p>}
                <div className="draft-meta">
                  <Field label="Currency" htmlFor={`cur${i}`}>
                    <Select id={`cur${i}`} value={s.currency} onChange={(e) => setScenario(i, { currency: e.target.value, exchangeRateToBase: e.target.value === draft.baseCurrency ? 1 : null })}>
                      {[...new Set([s.currency, ...CURRENCIES])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  {s.currency !== draft.baseCurrency && (
                    <Field label={`1 ${s.currency} in ${draft.baseCurrency}`} htmlFor={`fx${i}`} hint="Enter today’s rate. It is not looked up automatically.">
                      <NumberInput id={`fx${i}`} value={s.exchangeRateToBase} digits={6} min={0} onChange={(v) => setScenario(i, { exchangeRateToBase: v && v > 0 ? v : null, exchangeRateSource: 'user' })} invalid={!s.exchangeRateToBase} />
                    </Field>
                  )}
                </div>
                <table className="table draft-table">
                  <tbody>
                    {set.map((def) => {
                      const v = s.variables[def.key]!;
                      return (
                        <tr key={def.key}>
                          <td>{def.label}</td>
                          <td className="r">{v.value === null ? <span className="faint">—</span> : formatUnit(v.value, def.unit, s.currency)}</td>
                          <td style={{ width: 110 }}>
                            <SourceTag source={v.source} missing={v.value === null} />
                          </td>
                        </tr>
                      );
                    })}
                    {s.flows.map((f) => (
                      <tr key={f.id}>
                        <td>{f.label}</td>
                        <td className="r">{f.amount === null ? <span className="faint">—</span> : f.kind === 'time' ? `${f.amount} h/wk` : formatUnit(f.amount, f.kind.startsWith('one_time') ? 'currency' : 'currency_month', s.currency)}</td>
                        <td>
                          <SourceTag source={f.source} missing={f.amount === null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {missing > 0 && (
                  <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <CircleAlert size={13} aria-hidden /> {missing} value{missing === 1 ? '' : 's'} to fill in. Until then they count as zero.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {draft.scenarios.length < 8 && (
          <Button
            variant="ghost"
            icon={<Plus />}
            style={{ marginTop: 'var(--s-3)' }}
            onClick={() => {
              const base = draft.scenarios[draft.scenarios.length - 1]!;
              setDraft({ ...draft, scenarios: [...draft.scenarios, { ...base, name: 'Another alternative', description: null, isBaseline: false, assumptions: [] }] });
            }}
          >
            Add another scenario
          </Button>
        )}
      </section>

      {error && (
        <div className="field-error" role="alert" style={{ marginTop: 'var(--s-4)' }}>
          {error}
        </div>
      )}
      <div className="row-between" style={{ marginTop: 'var(--s-8)', paddingTop: 'var(--s-5)', borderTop: '1px solid var(--border)' }}>
        <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
          {categoryInfo(draft.category).label} · {draft.scenarios.length} scenarios
        </span>
        <Button variant="primary" size="lg" onClick={onCreate} loading={busy}>
          Create decision
        </Button>
      </div>
    </div>
  );
}

