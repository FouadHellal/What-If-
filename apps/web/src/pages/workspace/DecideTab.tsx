import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FileText, Plus, Undo2 } from 'lucide-react';
import { monthNumber, monthNumberToDate, type SimulationResult } from '@whatif/engine';
import type { DecisionDTO, JournalEntryDTO, ReportDTO } from '@whatif/shared';
import { download, get, post } from '../../api/client';
import { keys, useJournal, useReports } from '../../api/queries';
import { LineChart } from '../../components/charts/LineChart';
import { dateLabel, money, monthLabel, relativeTime } from '../../lib/format';
import { fxFor } from '../../lib/simulation';
import { Badge, Button, Callout, Field, ScenarioDot, Switch, Textarea, seriesColor, useToast } from '../../components/ui';
import { JournalEntryDialog } from '../Journal';
import type { WorkspaceContext } from './Workspace';

export function DecideTab({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, refresh } = ctx;
  const toast = useToast();
  const qc = useQueryClient();
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const [choice, setChoice] = useState<string | null>(decision.chosenScenarioId ?? null);
  const [rationale, setRationale] = useState(decision.rationale ?? '');
  const [expectations, setExpectations] = useState(decision.expectations ?? '');
  const [busy, setBusy] = useState(false);
  const decided = decision.status === 'decided' && decision.chosenScenarioId;

  const record = async (chosenScenarioId: string | null) => {
    drafts.flush();
    setBusy(true);
    try {
      const d = await post<DecisionDTO>(`/decisions/${decision.id}/decide`, { chosenScenarioId, rationale: rationale || null, expectations: expectations || null });
      qc.setQueryData(keys.decision(decision.id), d);
      refresh();
      void qc.invalidateQueries({ queryKey: ['journal'] });
      toast(chosenScenarioId ? 'Decision recorded. The current projection is pinned for later comparison.' : 'Decision reopened.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="decide">
      <div className="grid-2">
        <section>
          <div className="section-head">
            <h2 className="section-title">{decided ? 'Your decision' : 'Make the call'}</h2>
            {decided && decision.decidedAt && <span className="meta">Recorded {dateLabel(decision.decidedAt)}</span>}
          </div>
          {decided ? (
            <div className="stack">
              <div className="decided-card">
                <ScenarioDot index={active.find((s) => s.id === decision.chosenScenarioId)?.colorIndex ?? 0} size={10} />
                <div>
                  <div className="eyebrow">Chosen path</div>
                  <div className="serif" style={{ fontSize: 'var(--text-xl)' }}>
                    {drafts.scenarios.find((s) => s.id === decision.chosenScenarioId)?.name ?? 'Removed scenario'}
                  </div>
                </div>
              </div>
              {decision.rationale && (
                <div>
                  <div className="eyebrow">Why</div>
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{decision.rationale}</p>
                </div>
              )}
              {decision.expectations && (
                <div>
                  <div className="eyebrow">What I expect</div>
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{decision.expectations}</p>
                </div>
              )}
              <div>
                <Button variant="ghost" size="sm" icon={<Undo2 />} loading={busy} onClick={() => void record(null)}>
                  Reopen decision
                </Button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                Recording a decision pins today’s projection for the chosen path, so you can later compare reality with what you expected.
              </p>
              <div className="choice-list" role="radiogroup" aria-label="Chosen scenario">
                {active.map((s) => {
                  const r = results.get(s.id);
                  const fx = fxFor(s, decision.baseCurrency);
                  return (
                    <label key={s.id} className={`choice-option ${choice === s.id ? 'on' : ''}`}>
                      <input type="radio" name="choice" checked={choice === s.id} onChange={() => setChoice(s.id)} />
                      <ScenarioDot index={s.colorIndex} />
                      <span className="grow">{s.name}</span>
                      {r && <span className="num faint">{money(r.expected.summary.finalNetWorth * fx.rate, fx.missing ? s.currency : decision.baseCurrency, { compact: true })}</span>}
                    </label>
                  );
                })}
              </div>
              <Field label="Why this path?" htmlFor="why" optional>
                <Textarea id="why" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="The reasons that tipped the balance." />
              </Field>
              <Field label="What do you expect to happen?" htmlFor="exp" optional>
                <Textarea id="exp" rows={3} value={expectations} onChange={(e) => setExpectations(e.target.value)} placeholder="e.g. Settled in Berlin within six months, saving 800 a month by the end of year one." />
              </Field>
              <div>
                <Button variant="primary" disabled={!choice} loading={busy} onClick={() => void record(choice)}>
                  Record decision
                </Button>
              </div>
            </div>
          )}
        </section>
        <ReportsSection decisionId={decision.id} flush={drafts.flush} />
      </div>
      {decided && <RealityCheck ctx={ctx} />}
    </div>
  );
}

function ReportsSection({ decisionId, flush }: { decisionId: string; flush: () => void }) {
  const list = useReports(decisionId);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [includeAi, setIncludeAi] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">Decision reports</h2>
        <span className="meta">A frozen snapshot with every assumption</span>
      </div>
      <div className="stack">
        <label className="row" style={{ gap: 8, fontSize: 'var(--text-sm)' }}>
          <Switch checked={includeAi} onChange={setIncludeAi} label="Include the latest AI executive summary" />
          Include the latest AI executive summary, if one exists
        </label>
        <div>
          <Button
            variant="secondary"
            icon={<Plus />}
            loading={busy}
            onClick={async () => {
              flush();
              setBusy(true);
              try {
                await new Promise((r) => setTimeout(r, 800)); // let pending autosaves land first
                const r = await post<ReportDTO>(`/decisions/${decisionId}/reports`, { includeAiSummary: includeAi });
                void qc.invalidateQueries({ queryKey: keys.reports(decisionId) });
                navigate(`/reports/${r.id}`);
              } catch (err) {
                toast((err as Error).message, 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Generate report
          </Button>
        </div>
        {list.data && list.data.length > 0 && (
          <div className="list">
            {list.data.map((r) => (
              <div key={r.id} className="list-row">
                <FileText size={15} className="faint" aria-hidden />
                <button className="grow link-button" style={{ textAlign: 'left' }} onClick={() => navigate(`/reports/${r.id}`)}>
                  <div className="title">{r.title}</div>
                  <div className="sub">{relativeTime(r.createdAt)}</div>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={<FileDown />}
                  onClick={() => download(`/reports/${r.id}/pdf`, 'decision-report.pdf').catch((e) => toast((e as Error).message, 'bad'))}
                >
                  Download PDF
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RealityCheck({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts } = ctx;
  const [adding, setAdding] = useState(false);
  const scenario = drafts.scenarios.find((s) => s.id === decision.chosenScenarioId);
  const run = useQuery({
    queryKey: ['run', decision.decidedRunId],
    queryFn: ({ signal }) => get<{ result: SimulationResult; createdAt: string; inputHash: string }>(`/runs/${decision.decidedRunId}`, signal),
    enabled: Boolean(decision.decidedRunId),
    staleTime: Infinity,
  });
  const journal = useJournal({ decisionId: decision.id, type: 'checkin' });
  const checkins = useMemo(() => (journal.data?.items ?? []).filter((j: JournalEntryDTO) => j.actuals?.netWorth != null).sort((a, b) => a.entryDate.localeCompare(b.entryDate)), [journal.data]);

  if (!scenario) return null;
  const fx = fxFor(scenario, decision.baseCurrency).rate;
  const cur = decision.baseCurrency;
  const result = run.data?.result;
  const start = result ? monthNumber(result.startDate) : 0;
  const projected = result ? result.expected.months.map((m) => ({ x: start + m.t, y: m.netWorth * fx })) : [];
  const actual = checkins.map((c) => ({ x: monthNumber(c.entryDate.slice(0, 7)), y: c.actuals!.netWorth! }));

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Plan versus reality</h2>
        <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
          Add check-in
        </Button>
      </div>
      {!decision.decidedRunId && <Callout tone="warn">The projection pinned at decision time is no longer available.</Callout>}
      {result && (
        <>
          <p className="faint" style={{ fontSize: 'var(--text-xs)', marginBottom: 12 }}>
            Projection pinned on {dateLabel(run.data!.createdAt)} (inputs {run.data!.inputHash}). Later edits to the scenario do not change it.
          </p>
          <LineChart
            series={[
              { id: 'p', label: 'Projected when you decided', color: seriesColor(scenario.colorIndex), points: projected },
              { id: 'a', label: 'Your check-ins', color: 'var(--text)', points: actual, dashed: false },
            ]}
            height={240}
            xFormat={(x) => monthLabel(monthNumberToDate(x))}
            xTickFormat={(x) => monthNumberToDate(x).slice(0, 4)}
            yFormat={(v) => money(v, cur)}
            yTickFormat={(v) => money(v, cur, { compact: true })}
            ariaLabel="Projected net worth versus recorded check-ins"
          />
          {checkins.length === 0 ? (
            <p className="faint" style={{ fontSize: 'var(--text-sm)', marginTop: 12 }}>
              No check-ins yet. Every few months, record your actual net worth and how it is going — What-If shows it against the plan.
            </p>
          ) : (
            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="r">Projected</th>
                  <th className="r">Actual</th>
                  <th className="r">Difference</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {checkins.map((c) => {
                  const p = c.projected?.netWorth ?? null;
                  const a = c.actuals!.netWorth!;
                  const diff = p === null ? null : a - p;
                  return (
                    <tr key={c.id}>
                      <td>{dateLabel(c.entryDate)}</td>
                      <td className="r">{money(p, cur)}</td>
                      <td className="r">{money(a, cur)}</td>
                      <td className={`r ${diff === null ? '' : diff >= 0 ? 'delta-good' : 'delta-bad'}`}>{diff === null ? '—' : money(diff, cur, { sign: true })}</td>
                      <td className="muted" style={{ maxWidth: 260 }}>
                        {c.title}
                        {c.actuals?.satisfaction ? <Badge outline>{c.actuals.satisfaction}/5</Badge> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      <JournalEntryDialog open={adding} onClose={() => setAdding(false)} preset={{ type: 'checkin', decisionId: decision.id, scenarioId: scenario.id }} />
    </section>
  );
}
