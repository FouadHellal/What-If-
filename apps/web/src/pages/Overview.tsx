import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useState } from 'react';
import { ArrowRight, BookOpen, FileText, Flag, FlaskConical, Plus, Sparkles, Split, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { JOURNAL_TYPE_LABELS, STATUS_LABELS, categoryInfo, type DecisionSummaryDTO, type OverviewDTO } from '@whatif/shared';
import { keys, useOverview } from '../api/queries';
import { post } from '../api/client';
import { useSession } from '../lib/session';
import { money, monthLabel, relativeTime } from '../lib/format';
import { Badge, Button, ButtonLink, EmptyState, ErrorState, ScenarioDot, Skeleton, useToast } from '../components/ui';

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function StatusBadge({ status }: { status: DecisionSummaryDTO['status'] }) {
  const tone = status === 'decided' ? 'good' : status === 'deciding' ? 'accent' : undefined;
  return <Badge tone={tone}>{STATUS_LABELS[status]}</Badge>;
}

export function DecisionRow({ d }: { d: DecisionSummaryDTO }) {
  const best = d.preview.filter((p) => p.finalNetWorth !== null).sort((a, b) => b.finalNetWorth! - a.finalNetWorth!)[0];
  return (
    <Link to={`/decisions/${d.id}`} className="list-row decision-row">
      <div className="grow">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <span className="title serif" style={{ fontSize: 'var(--text-md)' }}>
            {d.title}
          </span>
          {d.isExample && <Badge outline>Example</Badge>}
        </div>
        <div className="sub row" style={{ gap: 12 }}>
          <span>{categoryInfo(d.category).label}</span>
          <span>{d.horizonYears}-year horizon</span>
          <span>Updated {relativeTime(d.updatedAt)}</span>
        </div>
        <div className="scenario-chips">
          {d.preview.slice(0, 4).map((p) => (
            <span key={p.id} className="scenario-chip">
              <ScenarioDot index={p.colorIndex} />
              <span className="name">{p.name}</span>
              {p.finalNetWorth !== null && <span className="num faint">{money(p.finalNetWorth, p.currency, { compact: true })}</span>}
            </span>
          ))}
          {d.preview.length > 4 && <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>+{d.preview.length - 4} more</span>}
        </div>
      </div>
      <div className="decision-row-side">
        <StatusBadge status={d.status} />
        {best && d.preview.length > 1 && (
          <span className="faint" style={{ fontSize: 'var(--text-xs)', textAlign: 'right' }}>
            Highest outcome: {best.name}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Overview() {
  const { user, profile } = useSession();
  const q = useOverview();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    document.title = 'Overview · What-If';
  }, []);

  const loadExample = async () => {
    try {
      const { id } = await post<{ id: string }>('/account/example');
      void qc.invalidateQueries({ queryKey: keys.overview });
      navigate(`/decisions/${id}`);
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  const name = profile?.displayName || user?.name || '';
  const d = q.data;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {greeting()}
            {name ? `, ${name.split(' ')[0]}` : ''}
          </h1>
          {d && d.counts.decisions > 0 && (
            <p className="page-subtitle">
              You are weighing {d.counts.decisions} decision{d.counts.decisions === 1 ? '' : 's'} across {d.counts.scenarios} scenario{d.counts.scenarios === 1 ? '' : 's'}.
            </p>
          )}
        </div>
        <ButtonLink to="/decisions/new" variant="primary" icon={<Plus aria-hidden />}>
          New decision
        </ButtonLink>
      </header>

      {q.isLoading && (
        <div className="stack">
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      )}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}

      {d && d.counts.decisions === 0 && <Welcome hasExample={d.hasExample} onExample={() => void loadExample()} />}

      {d && d.counts.decisions > 0 && (
        <>
          {d.attention.length > 0 && (
            <section className="attention">
              <div className="section-head">
                <h2 className="section-title">Needs your attention</h2>
              </div>
              {d.attention.map((a) => (
                <Link key={`${a.decisionId}-${a.reason}`} to={`/decisions/${a.decisionId}?tab=${a.reason === 'missing_inputs' ? 'scenarios' : a.reason === 'checkin_due' || a.reason === 'deciding' ? (a.reason === 'deciding' ? 'summary' : 'decide') : 'summary'}`} className="attention-row">
                  <span className={`reason ${a.reason}`}>{ATTENTION[a.reason]}</span>
                  <span className="grow">
                    <span className="title serif">{a.title}</span>
                    <span className="sub" style={{ display: 'block' }}>
                      {a.detail}
                    </span>
                  </span>
                  <ArrowRight size={14} className="faint" aria-hidden />
                </Link>
              ))}
            </section>
          )}
          {d.profileCompleteness < 60 && (
            <div className="callout" style={{ marginBottom: 'var(--s-8)', alignItems: 'center' }}>
              <UserRound size={16} aria-hidden />
              <div style={{ flex: 1 }}>
                <strong>Your baseline is {d.profileCompleteness} % complete.</strong> A few numbers about today make every “stay as I am” scenario accurate. All optional.
                <div className="progress" style={{ marginTop: 8, maxWidth: 260 }}>
                  <span style={{ width: `${d.profileCompleteness}%` }} />
                </div>
              </div>
              <ButtonLink to="/onboarding" size="sm">
                Set up baseline
              </ButtonLink>
            </div>
          )}

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Active decisions</h2>
              <Link to="/decisions" className="meta">
                View all
              </Link>
            </div>
            <div className="list">
              {d.activeDecisions.map((x) => (
                <DecisionRow key={x.id} d={x} />
              ))}
            </div>
          </section>

          <div className="grid-2 section">
            <section>
              <div className="section-head">
                <h2 className="section-title">Upcoming milestones</h2>
              </div>
              {d.upcomingMilestones.length === 0 ? (
                <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-4) 0' }}>
                  No planned milestones. Add them from a decision’s Timeline.
                </p>
              ) : (
                <div className="list">
                  {d.upcomingMilestones.map((m) => (
                    <Link key={m.id} to={`/decisions/${m.decisionId}?tab=timeline`} className="list-row">
                      <div className="milestone-date num">{monthLabel(m.date)}</div>
                      <div className="grow">
                        <div className="title">{m.title}</div>
                        <div className="sub">
                          {m.decisionTitle}
                          {m.scenarioName ? ` · ${m.scenarioName}` : ''}
                        </div>
                      </div>
                      <Flag size={14} className="faint" aria-hidden />
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <section>
              <div className="section-head">
                <h2 className="section-title">Recent activity</h2>
                <Link to="/journal" className="meta">
                  Journal
                </Link>
              </div>
              <div className="list">
                {d.recentScenarios.map((s) => (
                  <Link key={s.id} to={`/decisions/${s.decisionId}?tab=scenarios&s=${s.id}`} className="list-row">
                    <ScenarioDot index={s.colorIndex} />
                    <div className="grow">
                      <div className="title">{s.name}</div>
                      <div className="sub">{s.decisionTitle}</div>
                    </div>
                    <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                      {relativeTime(s.updatedAt)}
                    </span>
                  </Link>
                ))}
                {d.recentJournal.map((j) => (
                  <Link key={j.id} to="/journal" className="list-row">
                    <BookOpen size={14} className="faint" aria-hidden />
                    <div className="grow">
                      <div className="title">{j.title}</div>
                      <div className="sub">
                        {JOURNAL_TYPE_LABELS[j.type]?.label}
                        {j.decisionTitle ? ` · ${j.decisionTitle}` : ''}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
          {(d.recentExperiments.length > 0 || d.recentReports.length > 0) && (
            <div className="grid-2 section">
              <section>
                <div className="section-head">
                  <h2 className="section-title">Recent experiments</h2>
                </div>
                {d.recentExperiments.length === 0 ? (
                  <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
                    Try variations safely in a decision’s Lab.
                  </p>
                ) : (
                  <div className="list">
                    {d.recentExperiments.map((e) => (
                      <Link key={e.id} to={`/decisions/${e.decisionId}?tab=lab`} className="list-row">
                        <FlaskConical size={14} className="faint" aria-hidden />
                        <div className="grow">
                          <div className="title">{e.name}</div>
                          <div className="sub">
                            {e.decisionTitle} · {relativeTime(e.createdAt)}
                          </div>
                        </div>
                        <span className={`num ${e.delta >= 0 ? 'delta-good' : 'delta-bad'}`} style={{ fontSize: 'var(--text-sm)' }}>
                          {money(e.delta, e.currency, { sign: true, compact: true })}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
              <section>
                <div className="section-head">
                  <h2 className="section-title">Saved reports</h2>
                </div>
                {d.recentReports.length === 0 ? (
                  <p className="faint" style={{ fontSize: 'var(--text-sm)', padding: 'var(--s-3) 0' }}>
                    Generate a report from a decision’s Decide tab.
                  </p>
                ) : (
                  <div className="list">
                    {d.recentReports.map((r) => (
                      <Link key={r.id} to={`/reports/${r.id}`} className="list-row">
                        <FileText size={14} className="faint" aria-hidden />
                        <div className="grow">
                          <div className="title">{r.title}</div>
                          <div className="sub">{relativeTime(r.createdAt)}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ATTENTION: Record<OverviewDTO['attention'][number]['reason'], string> = {
  missing_inputs: 'Missing inputs',
  checkin_due: 'Check-in due',
  deciding: 'Ready to decide',
  stale: 'Untouched',
};

function Welcome({ hasExample, onExample }: { hasExample: boolean; onExample: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <div className="welcome">
      <h2 className="page-title" style={{ fontSize: 'var(--text-xl)' }}>
        What decision are you facing?
      </h2>
      <p className="page-subtitle">Start with a sentence. You can add details — and your financial baseline — as you go.</p>
      <form
        className="question-box"
        style={{ marginTop: 'var(--s-5)' }}
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/decisions/new?q=${encodeURIComponent(q)}`);
        }}
      >
        <label htmlFor="welcome-q" className="sr-only">
          Your decision
        </label>
        <textarea id="welcome-q" className="question-input serif" rows={2} placeholder="What if I move to Lisbon and work remotely?" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="question-actions">
          <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
            Interpreted on this server — no AI needed.
          </span>
          <Button type="submit" variant="primary" disabled={q.trim().length < 5}>
            Set up scenarios <ArrowRight aria-hidden />
          </Button>
        </div>
      </form>
      <div className="row" style={{ marginTop: 'var(--s-4)' }}>
        {!hasExample && (
          <Button icon={<Sparkles aria-hidden />} onClick={onExample}>
            Explore a worked example
          </Button>
        )}
        <ButtonLink to="/decisions/new" variant="ghost">
          Browse templates
        </ButtonLink>
      </div>
      <div className="welcome-steps">
        <div>
          <span className="num-badge">1</span>
          <h3>Describe the paths</h3>
          <p>Each alternative becomes a scenario with explicit assumptions. Unknown values are flagged — never invented.</p>
        </div>
        <div>
          <span className="num-badge">2</span>
          <h3>See what it depends on</h3>
          <p>Ranges, risks and break-even points show how robust each path is, and which facts would change the outcome.</p>
        </div>
        <div>
          <span className="num-badge">3</span>
          <h3>Decide, then compare reality</h3>
          <p>Record your choice and why. Later check-ins show how life compares with the plan.</p>
        </div>
      </div>
    </div>
  );
}
