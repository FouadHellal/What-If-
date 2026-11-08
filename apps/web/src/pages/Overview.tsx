import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { BookOpen, Flag, Plus, Sparkles, Split } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { JOURNAL_TYPE_LABELS, STATUS_LABELS, categoryInfo, type DecisionSummaryDTO } from '@whatif/shared';
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

      {d && d.counts.decisions === 0 && (
        <div className="overview-empty">
          <EmptyState
            icon={<Split />}
            title="Start with a question"
            actions={
              <>
                <ButtonLink to="/decisions/new" variant="primary" icon={<Plus aria-hidden />}>
                  Describe a decision
                </ButtonLink>
                {!d.hasExample && (
                  <Button icon={<Sparkles aria-hidden />} onClick={() => void loadExample()}>
                    Explore the example
                  </Button>
                )}
              </>
            }
          >
            Write what you are considering — “What if I move to Lisbon?” — and What-If will turn it into scenarios with explicit, editable assumptions you can compare.
          </EmptyState>
        </div>
      )}

      {d && d.counts.decisions > 0 && (
        <>
          <div className="stats" style={{ marginBottom: 'var(--s-10)' }}>
            <div className="stat">
              <div className="stat-label">Active decisions</div>
              <div className="stat-value num">{d.counts.decisions}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Scenarios</div>
              <div className="stat-value num">{d.counts.scenarios}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Decided</div>
              <div className="stat-value num">{d.counts.decided}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Journal entries</div>
              <div className="stat-value num">{d.counts.journal}</div>
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
