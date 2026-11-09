import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Lock, Sparkles, Trash2 } from 'lucide-react';
import { getVariableDefinition, isVariableKey } from '@whatif/engine';
import { AI_TASKS, AI_TASK_LABELS, type AiAnalysisDTO, type AiSuggestion, type AiTask } from '@whatif/shared';
import { ApiError, del, post } from '../../api/client';
import { keys, useAiSettings, useAnalyses } from '../../api/queries';
import { formatUnit, relativeTime } from '../../lib/format';
import { Badge, Button, Callout, ScenarioDot, Select, Skeleton, useToast } from '../../components/ui';
import type { WorkspaceContext } from './Workspace';

export function AnalysisTasks({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts } = ctx;
  const settings = useAiSettings();
  const list = useAnalyses(decision.id);
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<string>('');
  const [running, setRunning] = useState<AiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const s = settings.data;

  if (settings.isLoading) return <Skeleton height={200} />;

  if (!s?.enabled || !s.configured) return null;

  const run = async (task: AiTask) => {
    drafts.flush();
    setRunning(task);
    setError(null);
    try {
      await post<AiAnalysisDTO>(`/decisions/${decision.id}/ai`, { task, scenarioId: scope || null });
      void qc.invalidateQueries({ queryKey: keys.ai(decision.id) });
      void qc.invalidateQueries({ queryKey: keys.aiSettings });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The analysis failed.');
      void qc.invalidateQueries({ queryKey: keys.ai(decision.id) });
    } finally {
      setRunning(null);
    }
  };

  const apply = (sg: AiSuggestion) => {
    drafts.edit(sg.scenarioId, (sc) => ({
      ...sc,
      variables: { ...sc.variables, [sg.key]: { value: sg.value, low: sg.low ?? null, high: sg.high ?? null, source: 'ai', note: `AI estimate: ${sg.rationale}`.slice(0, 500) } },
    }));
    toast('Applied as an AI estimate. The projection has been updated.');
  };

  return (
    <div className="analyst">
      <div className="analyst-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <Badge tone="accent" icon={<Sparkles />}>
              {s.provider} · {s.model}
            </Badge>
            {s.isLocal && <Badge icon={<Lock />}>Runs locally</Badge>}
            <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
              {s.usedToday} of {s.dailyLimit} requests used today
            </span>
          </div>
          <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 8, maxWidth: '70ch' }}>
            Each request sends this decision’s scenarios, assumptions and calculated results{s.shareProfile ? ', plus your location, goals and priorities' : ''} to {s.isLocal ? 'your local model' : `${s.provider}`}. The analyst cannot change numbers — suggestions are shown for you to accept.
          </p>
        </div>
        <Select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} className="input-sm" style={{ width: 'auto' }}>
          <option value="">All scenarios</option>
          {active
            .filter((x) => !x.isBaseline)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} vs baseline
              </option>
            ))}
        </Select>
      </div>

      <div className="task-grid">
        {AI_TASKS.map((t) => (
          <button key={t} type="button" className="task" disabled={running !== null} onClick={() => void run(t)}>
            <span className="task-title">
              {AI_TASK_LABELS[t]!.label}
              {running === t && <span className="spinner" aria-label="Running" />}
            </span>
            <span className="task-desc">{AI_TASK_LABELS[t]!.description}</span>
          </button>
        ))}
      </div>
      {error && <Callout tone="bad">{error}</Callout>}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Analyses</h2>
          <span className="meta">Saved with the simulation runs they were based on</span>
        </div>
        {list.isLoading && <Skeleton height={120} />}
        {list.data?.length === 0 && <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-4) 0' }}>No analyses yet. Pick a task above.</p>}
        <div className="analysis-list">
          {list.data?.map((a) => (
            <article key={a.id} className={`analysis ${a.status}`}>
              <header className="row-between">
                <div className="row" style={{ gap: 8 }}>
                  <strong>{AI_TASK_LABELS[a.task]?.label ?? a.task}</strong>
                  {a.scenarioId && <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>{active.find((x) => x.id === a.scenarioId)?.name ?? 'Removed scenario'}</span>}
                  <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                    {a.model} · {relativeTime(a.createdAt)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={<Trash2 />}
                  onClick={async () => {
                    await del(`/ai/analyses/${a.id}`);
                    void qc.invalidateQueries({ queryKey: keys.ai(decision.id) });
                  }}
                >
                  Delete analysis
                </Button>
              </header>
              {a.status === 'failed' ? (
                <p className="field-error" style={{ marginTop: 6 }}>
                  {a.error}
                </p>
              ) : (
                a.output && (
                  <>
                    <p className="analysis-summary">{a.output.summary}</p>
                    {a.output.points.length > 0 && (
                      <ul className="analysis-points">
                        {a.output.points.map((p, i) => (
                          <li key={i}>
                            <span className={`kind kind-${p.kind ?? 'insight'}`}>{p.kind ?? 'insight'}</span>
                            <div>
                              <div className="p-title">{p.title}</div>
                              <div className="p-detail">{p.detail}</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.output.suggestions && a.output.suggestions.length > 0 && (
                      <div className="suggestions">
                        <div className="eyebrow" style={{ marginBottom: 6 }}>
                          Suggested changes
                        </div>
                        {a.output.suggestions.map((sg, i) => {
                          const sc = drafts.scenarios.find((x) => x.id === sg.scenarioId);
                          if (!sc || !isVariableKey(sg.key)) return null;
                          const def = getVariableDefinition(sg.key);
                          const cur = sc.variables[sg.key];
                          const appliedAlready = cur?.source === 'ai' && cur.value === sg.value;
                          return (
                            <div key={i} className="suggestion">
                              <ScenarioDot index={sc.colorIndex} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div>
                                  <strong>{def.label}</strong> in {sc.name}: {formatUnit(cur?.value ?? null, def.unit, sc.currency)} → <strong>{formatUnit(sg.value, def.unit, sc.currency)}</strong>
                                  {sg.low != null && sg.high != null && <span className="faint"> (range {formatUnit(sg.low, def.unit, sc.currency)} – {formatUnit(sg.high, def.unit, sc.currency)})</span>}
                                </div>
                                <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                                  {sg.rationale}
                                </div>
                              </div>
                              <Button size="sm" icon={appliedAlready ? <Check /> : undefined} disabled={appliedAlready} onClick={() => apply(sg)}>
                                {appliedAlready ? 'Applied' : 'Apply'}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {a.unverifiedNumbers.length > 0 && (
                      <p className="unverified">
                        <CircleAlert size={13} aria-hidden /> These figures do not appear in the simulation results and may be inaccurate: {a.unverifiedNumbers.join(', ')}
                      </p>
                    )}
                  </>
                )
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
