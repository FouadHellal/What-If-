import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DecisionDTO, GoalInput } from '@whatif/shared';
import { patch } from '../../api/client';
import { Button, Dialog, Field, Input, NumberInput, Select, Switch } from '../../components/ui';

export function DecisionSettingsDialog({ open, onClose, decision, onSaved }: { open: boolean; onClose: () => void; decision: DecisionDTO; onSaved: (d: DecisionDTO) => void }) {
  const [runs, setRuns] = useState(500);
  const [independent, setIndependent] = useState(false);
  const [goals, setGoals] = useState<GoalInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRuns(decision.settings.runs ?? 500);
    setIndependent(decision.settings.correlations === 'none');
    setGoals(decision.settings.goals ?? []);
    setError(null);
  }, [open, decision]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await patch<DecisionDTO>(`/decisions/${decision.id}`, {
        settings: { runs, correlations: independent ? 'none' : 'default', goals: goals.filter((g) => g.label.trim()) },
      });
      onSaved(d);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Simulation settings & goals"
      description="These apply to every scenario in this decision, so their simulated futures stay comparable."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Simulated futures" htmlFor="runs" hint="More runs give smoother percentiles but take longer to calculate.">
          <Select id="runs" value={String(runs)} onChange={(e) => setRuns(Number(e.target.value))}>
            <option value="500">500 — fast</option>
            <option value="1000">1,000</option>
            <option value="2000">2,000</option>
            <option value="5000">5,000 — most precise</option>
          </Select>
        </Field>
        <div className="toggle-row" style={{ alignSelf: 'end' }}>
          <div className="text">
            Treat inputs as independent
            <small>By default, related inputs move together (inflation with salary growth and rent).</small>
          </div>
          <Switch checked={independent} onChange={setIndependent} label="Treat inputs as independent" />
        </div>
      </div>
      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          Goals <span className="optional">in {decision.baseCurrency}</span>
        </div>
        {goals.length === 0 && <p className="faint" style={{ fontSize: 'var(--text-sm)', marginBottom: 8 }}>No goals yet.</p>}
        <div className="stack-sm">
          {goals.map((g, i) => (
            <div key={g.id} className="goal-row">
              <Input aria-label="Goal name" value={g.label} placeholder="e.g. House deposit saved" onChange={(e) => setGoals((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
              <Select aria-label="Goal type" value={g.kind} onChange={(e) => setGoals((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value as GoalInput['kind'] } : y)))}>
                <option value="net_worth_at">Net worth at least</option>
                <option value="cash_floor">Cash never below</option>
              </Select>
              <NumberInput ariaLabel="Target" value={g.target} digits={0} suffix={decision.baseCurrency} onChange={(v) => setGoals((x) => x.map((y, j) => (j === i ? { ...y, target: v ?? 0 } : y)))} />
              {g.kind === 'net_worth_at' ? (
                <Input aria-label="By month" type="month" value={g.date ?? ''} onChange={(e) => setGoals((x) => x.map((y, j) => (j === i ? { ...y, date: e.target.value || null } : y)))} title="Leave empty for the end of the horizon" />
              ) : (
                <span />
              )}
              <Button variant="ghost" size="sm" iconOnly icon={<Trash2 />} onClick={() => setGoals((x) => x.filter((_, j) => j !== i))}>
                Remove goal
              </Button>
            </div>
          ))}
        </div>
        {goals.length < 6 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus />}
            style={{ marginTop: 8 }}
            onClick={() => setGoals((x) => [...x, { id: `g${Date.now().toString(36)}`, label: '', kind: 'net_worth_at', target: 0, date: null }])}
          >
            Add goal
          </Button>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
