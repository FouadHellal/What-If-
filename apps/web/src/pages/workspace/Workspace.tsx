import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ChartLine, ChevronRight, CircleCheck, CloudOff, Compass, Eye, FileText, Flag, FlaskConical, Gavel, Layers, LogOut, Pencil, ShieldAlert, SlidersHorizontal, Sparkles, Trash2, Users } from 'lucide-react';
import { DECISION_STATUSES, STATUS_LABELS, categoryInfo, type DecisionDTO, type DecisionStatus } from '@whatif/shared';
import { del, patch, post } from '../../api/client';
import { keys, useDecision } from '../../api/queries';
import { useIntelligence, useSimulations } from '../../lib/simulation';
import { useSession } from '../../lib/session';
import type { DecisionIntelligence } from '@whatif/shared';
import { SummaryTab, SummaryStrip } from './SummaryTab';
import { LabTab } from './LabTab';
import { DecisionSettingsDialog } from './DecisionSettingsDialog';
import type { SimulationResult } from '@whatif/engine';
import { Badge, Button, Callout, ConfirmDialog, Dialog, ErrorState, Field, Input, Menu, Select, Skeleton, Spinner, Textarea, useToast } from '../../components/ui';
import { useScenarioDrafts, type SaveState } from './useScenarioDrafts';
import { CompareTab } from './CompareTab';
import { ScenariosTab } from './ScenariosTab';
import { TimelineTab } from './TimelineTab';
import { RisksTab } from './RisksTab';
import { AnalystTab } from './AnalystPanels';
import { DecideTab } from './DecideTab';
import { ShareDialog } from './ShareDialog';

const TABS = [
  { id: 'summary', label: 'Summary', icon: Compass, hint: 'The short answer: which path looks best, how sure that is, and what is still missing.', edits: false },
  { id: 'scenarios', label: 'Scenarios', icon: Layers, hint: 'Each path you are considering, with its numbers. Fill in anything marked “Needs your input”.', edits: true },
  { id: 'compare', label: 'Compare', icon: ChartLine, hint: 'All paths side by side over time — money, time and how each fits your priorities.', edits: false },
  { id: 'lab', label: 'Lab', icon: FlaskConical, hint: 'Try “what if this number were different?” without changing your scenarios.', edits: true },
  { id: 'risks', label: 'Risks & sensitivity', icon: ShieldAlert, hint: 'Which guesses matter most, and how bad the bad cases get.', edits: false },
  { id: 'timeline', label: 'Timeline', icon: Flag, hint: 'Milestones and dates, so you know what has to happen when.', edits: true },
  { id: 'analyst', label: 'Analyst', icon: Sparkles, hint: 'Ask questions about this decision in plain language (needs an AI provider).', edits: false },
  { id: 'decide', label: 'Decide', icon: Gavel, hint: 'Record what you chose and why, and make a report to keep or share.', edits: true },
] as const;
export type TabId = (typeof TABS)[number]['id'];

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'idle') return null;
  if (state === 'error')
    return (
      <button className="save-indicator bad" onClick={onRetry}>
        <CloudOff size={13} aria-hidden /> Not saved — retry
      </button>
    );
  return (
    <span className="save-indicator" aria-live="polite">
      {state === 'saved' ? <CircleCheck size={13} aria-hidden /> : <Spinner label="Saving" />}
      {state === 'saved' ? 'All changes saved' : state === 'saving' ? 'Saving…' : 'Unsaved changes'}
    </span>
  );
}

export type WorkspaceContext = {
  decision: DecisionDTO;
  drafts: ReturnType<typeof useScenarioDrafts>;
  results: Map<string, SimulationResult>;
  computing: Set<string>;
  intel: DecisionIntelligence | null;
  intelLoading: boolean;
  lifeWeights: Record<string, number>;
  goTo: (tab: TabId, scenarioId?: string) => void;
  selectedId: string | null;
  refresh: () => void;
};

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'summary') as TabId;
  const q = useDecision(id);
  const decision = q.data;
  const drafts = useScenarioDrafts(decision);
  const active = useMemo(() => drafts.scenarios.filter((s) => s.status === 'active'), [drafts.scenarios]);
  const sim = useSimulations(drafts.scenarios, decision);
  const results = sim.results;
  const { profile, user } = useSession();
  const lifeWeights = (decision?.priorities ?? profile?.priorities ?? {}) as Record<string, number>;
  const intel = useIntelligence(decision, drafts.scenarios, results, lifeWeights);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (decision) document.title = `${decision.title} · What-If`;
  }, [decision]);

  const selectedId = params.get('s') ?? active.find((s) => !s.isBaseline)?.id ?? active[0]?.id ?? null;

  const goTo = (t: TabId, scenarioId?: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    if (scenarioId) next.set('s', scenarioId);
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.decision(id!) });
    void qc.invalidateQueries({ queryKey: ['decisions'] });
    void qc.invalidateQueries({ queryKey: keys.overview });
  };

  if (q.isLoading)
    return (
      <div className="page">
        <Skeleton height={14} width={120} />
        <Skeleton height={36} width="60%" style={{ marginTop: 16 }} />
        <Skeleton height={320} style={{ marginTop: 40 }} />
      </div>
    );
  if (q.error || !decision)
    return (
      <div className="page">
        <ErrorState error={q.error ?? new Error('Decision not found.')} onRetry={() => void q.refetch()} />
      </div>
    );

  const setStatus = async (status: DecisionStatus) => {
    try {
      const d = await patch<DecisionDTO>(`/decisions/${decision.id}`, { status });
      qc.setQueryData(keys.decision(decision.id), d);
      refresh();
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  const isOwner = decision.access === 'owner';
  const readOnly = decision.access === 'viewer';
  const tabInfo = TABS.find((t) => t.id === tab)!;
  const ctx: WorkspaceContext = { decision, drafts, results, computing: sim.computing, intel: intel.data, intelLoading: intel.loading, lifeWeights, goTo, selectedId, refresh };

  return (
    <div className="page workspace">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/decisions">Decisions</Link>
        <ChevronRight size={13} aria-hidden />
        <span>{categoryInfo(decision.category).label}</span>
      </nav>
      <header className="ws-header">
        <div className="ws-title-block">
          <h1 className="ws-title serif">{decision.title}</h1>
          <div className="ws-meta">
            <Select aria-label="Status" className="status-select" value={decision.status} disabled={readOnly} onChange={(e) => void setStatus(e.target.value as DecisionStatus)}>
              {DECISION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <span>{active.length} scenarios</span>
            <span>{decision.horizonYears}-year horizon</span>
            <span>Compared in {decision.baseCurrency}</span>
            {decision.isExample && <Badge outline>Example · illustrative values</Badge>}
            {decision.people.members.length > 0 && (
              <button type="button" className="people-chip" onClick={() => setShareOpen(true)} title="People on this decision">
                <Users size={13} aria-hidden />
                {[decision.people.owner, ...decision.people.members].map((p) => p.name.split(' ')[0]).join(', ')}
              </button>
            )}
            <SaveIndicator state={drafts.overall} onRetry={() => drafts.flush()} />
          </div>
        </div>
        <div className="row">
          <Button icon={<Users aria-hidden />} onClick={() => setShareOpen(true)}>
            {isOwner ? 'Share' : 'People'}
          </Button>
          <Button icon={<FileText aria-hidden />} onClick={() => goTo('decide')} className="desktop-only">
            Report
          </Button>
          <Menu
            items={
              readOnly
                ? [{ label: 'Leave this decision', icon: <LogOut />, danger: true, onSelect: () => setConfirmLeave(true) }]
                : [
                    { label: 'Edit title & description', icon: <Pencil />, onSelect: () => setEditing(true) },
                    { label: 'Simulation settings & goals', icon: <SlidersHorizontal />, onSelect: () => setSettingsOpen(true) },
                    decision.status === 'archived'
                      ? { label: 'Restore from archive', icon: <ArchiveRestore />, onSelect: () => void setStatus('exploring') }
                      : { label: 'Archive decision', icon: <Archive />, onSelect: () => void setStatus('archived') },
                    'sep',
                    isOwner
                      ? { label: 'Delete decision', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete(true) }
                      : { label: 'Leave this decision', icon: <LogOut />, danger: true, onSelect: () => setConfirmLeave(true) },
                  ]
            }
          />
        </div>
      </header>
      {decision.description && <p className="ws-description">{decision.description}</p>}
      {!isOwner && (
        <Callout icon={readOnly ? <Eye aria-hidden /> : <Users aria-hidden />}>
          <strong>{decision.sharedBy}</strong> shared this decision with you.{' '}
          {readOnly ? 'You can look at everything but not change it.' : 'You can change it together — your edits are saved for everyone.'}
        </Callout>
      )}
      {decision.status === 'archived' && (
        <Callout tone="warn">This decision is archived. It stays fully editable and is hidden from your active lists.</Callout>
      )}

      <SummaryStrip ctx={ctx} />

      <div className="tabs ws-tabs" role="tablist" aria-label="Workspace sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => goTo(t.id)}>
            <t.icon aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <p className="tab-hint">{tabInfo.hint}</p>

      <div className="ws-body" role="tabpanel">
        {/* Viewers see the same screens with every control switched off. */}
        <fieldset className="ws-fieldset" disabled={readOnly && tabInfo.edits}>
          {tab === 'summary' && <SummaryTab ctx={ctx} openSettings={() => setSettingsOpen(true)} />}
          {tab === 'lab' && <LabTab ctx={ctx} />}
          {tab === 'compare' && <CompareTab ctx={ctx} />}
          {tab === 'scenarios' && <ScenariosTab ctx={ctx} />}
          {tab === 'timeline' && <TimelineTab ctx={ctx} />}
          {tab === 'risks' && <RisksTab ctx={ctx} />}
          {tab === 'analyst' && <AnalystTab ctx={ctx} />}
          {tab === 'decide' && <DecideTab ctx={ctx} />}
        </fieldset>
      </div>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} decision={decision} onChanged={refresh} />
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Leave this decision?"
        description={`You will no longer see it. ${decision.sharedBy ?? 'The owner'} can share it with you again.`}
        confirmLabel="Leave"
        danger
        onConfirm={async () => {
          try {
            await del(`/decisions/${decision.id}/people/${user!.id}`);
            refresh();
            navigate('/decisions', { replace: true });
            toast('You left the decision.');
          } catch (err) {
            toast((err as Error).message, 'bad');
          }
        }}
      />

      <DecisionSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} decision={decision} onSaved={(d) => qc.setQueryData(keys.decision(d.id), d)} />
      <EditDecisionDialog open={editing} onClose={() => setEditing(false)} decision={decision} onSaved={(d) => qc.setQueryData(keys.decision(d.id), d)} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        loading={busy}
        title="Delete this decision?"
        description="All scenarios, simulation runs, milestones, analyses and reports for this decision are permanently deleted. Journal entries are kept, unlinked. This cannot be undone."
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          setBusy(true);
          try {
            await del(`/decisions/${decision.id}`);
            refresh();
            navigate('/decisions', { replace: true });
            toast('Decision deleted.');
          } catch (err) {
            toast((err as Error).message, 'bad');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function EditDecisionDialog({ open, onClose, decision, onSaved }: { open: boolean; onClose: () => void; decision: DecisionDTO; onSaved: (d: DecisionDTO) => void }) {
  const [title, setTitle] = useState(decision.title);
  const [description, setDescription] = useState(decision.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle(decision.title);
      setDescription(decision.description ?? '');
      setError(null);
    }
  }, [open, decision]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit decision"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                onSaved(await patch<DecisionDTO>(`/decisions/${decision.id}`, { title, description: description || null }));
                onClose();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Title" htmlFor="dt" error={error}>
        <Input id="dt" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="dd" optional hint="Context worth remembering — why this matters now.">
        <Textarea id="dd" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Dialog>
  );
}

