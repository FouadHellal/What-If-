import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { ScenarioDTO } from '@whatif/shared';
import { del, patch, post } from '../../api/client';
import { money } from '../../lib/format';
import { fxFor } from '../../lib/simulation';
import { Badge, Button, Callout, ConfirmDialog, Dialog, EmptyState, Field, Input, Menu, ScenarioDot, Textarea, useToast } from '../../components/ui';
import type { WorkspaceContext } from './Workspace';
import { FlowsEditor, ScenarioSettings, ScoresEditor, VariableGroups } from './VariableEditor';
import { ProjectionPanel } from './ProjectionPanel';

export function ScenariosTab({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, selectedId, goTo, refresh } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<ScenarioDTO | null>(null);
  const [deleting, setDeleting] = useState<ScenarioDTO | null>(null);
  const [busy, setBusy] = useState(false);
  void qc;

  const visible = drafts.scenarios.filter((s) => showArchived || s.status === 'active');
  const selected = drafts.scenarios.find((s) => s.id === selectedId) ?? visible[0];
  const archivedCount = drafts.scenarios.filter((s) => s.status === 'archived').length;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    drafts.flush();
    try {
      await fn();
      refresh();
      if (done) toast(done);
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  const addScenario = (fromScenarioId?: string) =>
    act(async () => {
      const s = await post<ScenarioDTO>(`/decisions/${decision.id}/scenarios`, fromScenarioId ? { fromScenarioId } : { name: 'New scenario' });
      goTo('scenarios', s.id);
    }, fromScenarioId ? 'Scenario duplicated.' : 'Scenario added.');

  if (!selected)
    return (
      <EmptyState icon={<Plus />} title="No scenarios" actions={<Button variant="primary" onClick={() => void addScenario()}>Add a scenario</Button>}>
        Add the paths you want to compare.
      </EmptyState>
    );

  const result = results.get(selected.id);
  const fx = fxFor(selected, decision.baseCurrency);

  return (
    <div className="scenarios-tab">
      <div className="scenario-rail" role="tablist" aria-label="Scenarios">
        {visible.map((s) => {
          const r = results.get(s.id);
          const st = drafts.state[s.id];
          return (
            <button key={s.id} role="tab" aria-selected={s.id === selected.id} className={`rail-item ${s.status === 'archived' ? 'archived' : ''}`} onClick={() => goTo('scenarios', s.id)}>
              <ScenarioDot index={s.colorIndex} />
              <span className="rail-text">
                <span className="rail-name">
                  {s.name}
                  {(st === 'pending' || st === 'saving') && <span className="unsaved-dot" title="Unsaved changes" />}
                </span>
                <span className="rail-sub num">
                  {s.isBaseline ? 'Baseline · ' : ''}
                  {r ? money(r.expected.summary.finalNetWorth, s.currency, { compact: true }) : '—'}
                </span>
              </span>
            </button>
          );
        })}
        <div className="rail-actions">
          <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => void addScenario()} disabled={drafts.scenarios.length >= 8}>
            Add scenario
          </Button>
          {archivedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
            </Button>
          )}
        </div>
      </div>

      <div className="scenario-main">
        <div className="scenario-head">
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <ScenarioDot index={selected.colorIndex} size={10} />
              <h2 className="scenario-title">{selected.name}</h2>
              {selected.isBaseline && <Badge tone="accent">Baseline</Badge>}
              {selected.status === 'archived' && <Badge>Archived</Badge>}
            </div>
            {selected.description && <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>{selected.description}</p>}
          </div>
          <Menu
            items={[
              { label: 'Rename & describe', icon: <Pencil />, onSelect: () => setRenaming(selected) },
              { label: 'Duplicate', icon: <Copy />, onSelect: () => void addScenario(selected.id), disabled: drafts.scenarios.length >= 8 },
              { label: 'Use as baseline', icon: <Star />, disabled: selected.isBaseline, onSelect: () => void act(() => patch(`/scenarios/${selected.id}`, { isBaseline: true }), `${selected.name} is now the baseline.`) },
              selected.status === 'active'
                ? { label: 'Archive', icon: <Archive />, disabled: selected.isBaseline, onSelect: () => void act(() => patch(`/scenarios/${selected.id}`, { status: 'archived' }), 'Scenario archived.') }
                : { label: 'Restore', icon: <ArchiveRestore />, onSelect: () => void act(() => patch(`/scenarios/${selected.id}`, { status: 'active' }), 'Scenario restored.') },
              'sep',
              { label: 'Delete', icon: <Trash2 />, danger: true, disabled: drafts.scenarios.length <= 1, onSelect: () => setDeleting(selected) },
            ]}
          />
        </div>

        <ScenarioSettings scenario={selected} baseCurrency={decision.baseCurrency} edit={(u) => drafts.edit(selected.id, u)} />
        {fx.missing && (
          <Callout tone="warn">
            Set the exchange rate from <strong>{selected.currency}</strong> to <strong>{decision.baseCurrency}</strong> to compare this scenario with the others. Rates are never looked up automatically.
          </Callout>
        )}

        <div className="scenario-grid">
          <div className="scenario-editor">
            <VariableGroups scenario={selected} edit={(u) => drafts.edit(selected.id, u)} warnings={result?.warnings ?? []} />
            <FlowsEditor scenario={selected} edit={(u) => drafts.edit(selected.id, u)} />
            <ScoresEditor scenario={selected} edit={(u) => drafts.edit(selected.id, u)} />
          </div>
          <div className="scenario-results">
            <div className="sticky-results">{result ? <ProjectionPanel scenario={selected} result={result} /> : <Callout tone="bad">This scenario’s inputs could not be simulated. Check the start date and currency.</Callout>}</div>
          </div>
        </div>
      </div>

      <RenameDialog
        scenario={renaming}
        onClose={() => setRenaming(null)}
        onSave={(name, description) => act(() => patch(`/scenarios/${renaming!.id}`, { name, description: description || null }), 'Scenario updated.').then(() => setRenaming(null))}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        danger
        loading={busy}
        title={`Delete “${deleting?.name}”?`}
        description="The scenario, its stored simulation runs, milestones and notes are permanently removed. Reports created earlier keep their snapshot."
        confirmLabel="Delete scenario"
        onConfirm={async () => {
          setBusy(true);
          await act(() => del(`/scenarios/${deleting!.id}`), 'Scenario deleted.');
          setBusy(false);
          setDeleting(null);
          goTo('scenarios', drafts.scenarios.find((s) => s.id !== deleting?.id)?.id);
        }}
      />
    </div>
  );
}

function RenameDialog({ scenario, onClose, onSave }: { scenario: ScenarioDTO | null; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  if (scenario && key !== scenario.id) {
    setKey(scenario.id);
    setName(scenario.name);
    setDescription(scenario.description ?? '');
  }
  if (!scenario && key !== null) setKey(null);
  return (
    <Dialog
      open={Boolean(scenario)}
      onClose={onClose}
      title="Rename scenario"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave(name.trim(), description.trim());
              setBusy(false);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="sn">
        <Input id="sn" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="sd" optional>
        <Textarea id="sd" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Dialog>
  );
}
