import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ChartLine, ChevronRight, CircleCheck, CloudOff, FileText, Flag, Gavel, Layers, Pencil, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { DECISION_STATUSES, STATUS_LABELS, categoryInfo, type DecisionDTO, type DecisionStatus } from '@whatif/shared';
import { del, patch, post } from '../../api/client';
import { keys, useDecision } from '../../api/queries';
import { useSimulations } from '../../lib/simulation';
import { Badge, Button, Callout, ConfirmDialog, Dialog, ErrorState, Field, Input, Menu, Select, Skeleton, Spinner, Textarea, useToast } from '../../components/ui';
import { useScenarioDrafts, type SaveState } from './useScenarioDrafts';
import { CompareTab } from './CompareTab';
import { ScenariosTab } from './ScenariosTab';
import { TimelineTab } from './TimelineTab';
import { RisksTab } from './RisksTab';
import { AnalystTab } from './AnalystTab';
import { DecideTab } from './DecideTab';

const TABS = [
  { id: 'compare', label: 'Compare', icon: ChartLine },
  { id: 'scenarios', label: 'Scenarios', icon: Layers },
  { id: 'timeline', label: 'Timeline', icon: Flag },
  { id: 'risks', label: 'Risks & sensitivity', icon: ShieldAlert },
  { id: 'analyst', label: 'AI analyst', icon: Sparkles },
  { id: 'decide', label: 'Decide', icon: Gavel },
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
  results: ReturnType<typeof useSimulations>;
  goTo: (tab: TabId, scenarioId?: string) => void;
  selectedId: string | null;
  refresh: () => void;
};

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'compare') as TabId;
  const q = useDecision(id);
  const decision = q.data;
  const drafts = useScenarioDrafts(decision);
  const active = useMemo(() => drafts.scenarios.filter((s) => s.status === 'active'), [drafts.scenarios]);
  const results = useSimulations(drafts.scenarios);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const ctx: WorkspaceContext = { decision, drafts, results, goTo, selectedId, refresh };

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
            <Select aria-label="Status" className="status-select" value={decision.status} onChange={(e) => void setStatus(e.target.value as DecisionStatus)}>
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
            <SaveIndicator state={drafts.overall} onRetry={() => drafts.flush()} />
          </div>
        </div>
        <div className="row">
          <Button icon={<FileText aria-hidden />} onClick={() => goTo('decide')} className="desktop-only">
            Report
          </Button>
          <Menu
            items={[
              { label: 'Edit title & description', icon: <Pencil />, onSelect: () => setEditing(true) },
              decision.status === 'archived'
                ? { label: 'Restore from archive', icon: <ArchiveRestore />, onSelect: () => void setStatus('exploring') }
                : { label: 'Archive decision', icon: <Archive />, onSelect: () => void setStatus('archived') },
              'sep',
              { label: 'Delete decision', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete(true) },
            ]}
          />
        </div>
      </header>
      {decision.description && <p className="ws-description">{decision.description}</p>}
      {decision.status === 'archived' && (
        <Callout tone="warn">This decision is archived. It stays fully editable and is hidden from your active lists.</Callout>
      )}

      <div className="tabs ws-tabs" role="tablist" aria-label="Workspace sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => goTo(t.id)}>
            <t.icon aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <div className="ws-body" role="tabpanel">
        {tab === 'compare' && <CompareTab ctx={ctx} />}
        {tab === 'scenarios' && <ScenariosTab ctx={ctx} />}
        {tab === 'timeline' && <TimelineTab ctx={ctx} />}
        {tab === 'risks' && <RisksTab ctx={ctx} />}
        {tab === 'analyst' && <AnalystTab ctx={ctx} />}
        {tab === 'decide' && <DecideTab ctx={ctx} />}
      </div>

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

