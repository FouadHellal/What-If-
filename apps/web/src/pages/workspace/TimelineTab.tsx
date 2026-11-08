import { useMemo, useState } from 'react';
import { Check, CircleDot, Flag, Pencil, Plus, Trash2, X } from 'lucide-react';
import { monthNumber, monthNumberToDate, type DerivedMilestone } from '@whatif/engine';
import type { MilestoneDTO } from '@whatif/shared';
import { del, patch, post } from '../../api/client';
import { useWidth } from '../../components/charts/scale';
import { monthLabel, currentMonth, todayISO } from '../../lib/format';
import { Badge, Button, ConfirmDialog, Dialog, Field, Input, Menu, ScenarioDot, Segmented, Select, Textarea, seriesColor, useToast } from '../../components/ui';
import type { WorkspaceContext } from './Workspace';

interface Item {
  key: string;
  date: string;
  title: string;
  detail: string;
  scenarioId: string | null;
  kind: 'custom' | DerivedMilestone['kind'];
  custom?: MilestoneDTO;
}

export function TimelineTab({ ctx }: { ctx: WorkspaceContext }) {
  const { decision, drafts, results, refresh } = ctx;
  const toast = useToast();
  const active = drafts.scenarios.filter((s) => s.status === 'active');
  const [filter, setFilter] = useState<string>('all');
  const [showProjected, setShowProjected] = useState(true);
  const [editing, setEditing] = useState<MilestoneDTO | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MilestoneDTO | null>(null);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const m of decision.milestones) {
      if (m.scenarioId && !active.some((s) => s.id === m.scenarioId)) continue;
      out.push({ key: m.id, date: m.date, title: m.title, detail: m.description ?? '', scenarioId: m.scenarioId, kind: 'custom', custom: m });
    }
    if (showProjected) {
      for (const s of active) {
        const r = results.get(s.id);
        if (!r) continue;
        for (const m of r.milestones) {
          if (m.kind === 'start' || m.kind === 'end') continue;
          out.push({ key: `${s.id}:${m.id}`, date: m.date, title: m.title, detail: m.detail, scenarioId: s.id, kind: m.kind });
        }
      }
    }
    return out
      .filter((i) => filter === 'all' || i.scenarioId === filter || (i.scenarioId === null && i.kind === 'custom'))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'custom' ? -1 : 1));
  }, [decision.milestones, active, results, showProjected, filter]);

  const byYear = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) {
      const y = i.date.slice(0, 4);
      m.set(y, [...(m.get(y) ?? []), i]);
    }
    return [...m.entries()];
  }, [items]);

  const setStatus = async (m: MilestoneDTO, status: MilestoneDTO['status']) => {
    try {
      await patch(`/milestones/${m.id}`, { status, achievedOn: status === 'achieved' ? todayISO() : null });
      refresh();
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  const nameOf = (id: string | null) => (id ? active.find((s) => s.id === id)?.name ?? '' : 'All scenarios');
  const colorOf = (id: string | null) => {
    const s = active.find((x) => x.id === id);
    return s ? seriesColor(s.colorIndex) : 'var(--text)';
  };

  return (
    <div className="timeline-tab">
      <div className="chart-head">
        <div className="row">
          <Select aria-label="Scenario" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} className="input-sm">
            <option value="all">All scenarios</option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Segmented
            label="Milestones shown"
            value={showProjected ? 'all' : 'custom'}
            onChange={(v) => setShowProjected(v === 'all')}
            options={[
              { value: 'all', label: 'Projected & yours' },
              { value: 'custom', label: 'Yours only' },
            ]}
          />
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
          Add milestone
        </Button>
      </div>

      <TimelineLanes ctx={ctx} items={items} filter={filter} />

      {byYear.length === 0 ? (
        <p className="faint" style={{ padding: 'var(--s-8) 0' }}>
          No milestones to show. Add your own, or fill in scenario assumptions to see projected ones.
        </p>
      ) : (
        <div className="timeline-list">
          {byYear.map(([year, list]) => (
            <section key={year} className="timeline-year">
              <h3 className="timeline-year-label num">{year}</h3>
              <ol>
                {list.map((i) => (
                  <li key={i.key} className={`timeline-item ${i.kind === 'custom' ? 'custom' : 'derived'} ${i.custom?.status ?? ''}`}>
                    <span className="timeline-marker" style={{ background: i.kind === 'custom' ? colorOf(i.scenarioId) : 'var(--surface)', borderColor: colorOf(i.scenarioId) }} aria-hidden />
                    <div className="timeline-when num">{monthLabel(i.date)}</div>
                    <div className="timeline-what">
                      <div className="row" style={{ gap: 8 }}>
                        <span className="timeline-title">{i.title}</span>
                        {i.kind === 'custom' ? (
                          i.custom!.status !== 'planned' && <Badge tone={i.custom!.status === 'achieved' ? 'good' : i.custom!.status === 'missed' ? 'bad' : undefined}>{i.custom!.status}</Badge>
                        ) : (
                          <Badge outline title="Calculated from this scenario’s assumptions">
                            Projected
                          </Badge>
                        )}
                        {i.kind === 'shortfall' && <Badge tone="bad">Risk</Badge>}
                      </div>
                      <div className="timeline-detail">
                        <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                          {i.scenarioId ? <ScenarioDot index={active.find((s) => s.id === i.scenarioId)?.colorIndex ?? 0} /> : <CircleDot size={10} aria-hidden />}
                          {nameOf(i.scenarioId)}
                        </span>
                        {i.detail && <> · {i.detail}</>}
                      </div>
                    </div>
                    {i.custom && (
                      <div className="timeline-actions">
                        {i.custom.status === 'planned' && i.date <= currentMonth() && (
                          <>
                            <Button size="sm" variant="ghost" icon={<Check />} onClick={() => void setStatus(i.custom!, 'achieved')}>
                              Achieved
                            </Button>
                            <Button size="sm" variant="ghost" icon={<X />} onClick={() => void setStatus(i.custom!, 'missed')}>
                              Missed
                            </Button>
                          </>
                        )}
                        <Menu
                          items={[
                            { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(i.custom!) },
                            ...(i.custom.status !== 'achieved' ? [{ label: 'Mark achieved', icon: <Check />, onSelect: () => void setStatus(i.custom!, 'achieved') }] : []),
                            ...(i.custom.status !== 'planned' ? [{ label: 'Mark as planned', icon: <Flag />, onSelect: () => void setStatus(i.custom!, 'planned') }] : []),
                            'sep' as const,
                            { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => setDeleting(i.custom!) },
                          ]}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <MilestoneDialog ctx={ctx} value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        danger
        title="Delete milestone?"
        description={`“${deleting?.title}” will be removed.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await del(`/milestones/${deleting!.id}`);
            refresh();
          } catch (err) {
            toast((err as Error).message, 'bad');
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function TimelineLanes({ ctx, items, filter }: { ctx: WorkspaceContext; items: Item[]; filter: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const active = ctx.drafts.scenarios.filter((s) => s.status === 'active' && (filter === 'all' || s.id === filter));
  const [hover, setHover] = useState<Item | null>(null);
  if (active.length === 0) return null;
  const starts = active.map((s) => monthNumber(s.startDate));
  const ends = active.map((s) => monthNumber(s.startDate) + s.horizonYears * 12);
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const left = width < 600 ? 90 : 160;
  const right = 16;
  const laneH = 34;
  const h = active.length * laneH + 30 + (items.some((i) => i.scenarioId === null) ? laneH : 0);
  const x = (m: number) => left + ((m - min) / Math.max(1, max - min)) * Math.max(10, width - left - right);
  const lanes = [...active.map((s) => ({ id: s.id as string | null, name: s.name, color: seriesColor(s.colorIndex), start: monthNumber(s.startDate), end: monthNumber(s.startDate) + s.horizonYears * 12 }))];
  if (items.some((i) => i.scenarioId === null)) lanes.push({ id: null, name: 'All scenarios', color: 'var(--text-2)', start: min, end: max });
  const years: number[] = [];
  for (let y = Math.ceil(min / 12); y * 12 <= max; y++) years.push(y);
  const step = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor((width - left) / 70))));
  const now = monthNumber(currentMonth());
  return (
    <div className="chart timeline-lanes" ref={ref}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label="Milestones on a timeline per scenario">
          {years.filter((_, i) => i % step === 0).map((y) => (
            <g key={y}>
              <line x1={x(y * 12)} x2={x(y * 12)} y1={0} y2={h - 22} stroke="var(--chart-grid)" />
              <text x={x(y * 12)} y={h - 6} textAnchor="middle" className="chart-tick">
                {y}
              </text>
            </g>
          ))}
          {now >= min && now <= max && (
            <g>
              <line x1={x(now)} x2={x(now)} y1={0} y2={h - 22} stroke="var(--text-3)" strokeDasharray="2 3" />
            </g>
          )}
          {lanes.map((l, i) => {
            const cy = 14 + i * laneH;
            return (
              <g key={l.id ?? 'all'}>
                <text x={left - 12} y={cy} dy="0.32em" textAnchor="end" className="chart-row-label">
                  {l.name.length > (left < 120 ? 11 : 22) ? `${l.name.slice(0, left < 120 ? 10 : 21)}…` : l.name}
                </text>
                <line x1={x(l.start)} x2={x(l.end)} y1={cy} y2={cy} stroke={l.color} strokeOpacity={0.35} strokeWidth={2} strokeLinecap="round" />
                {items
                  .filter((it) => it.scenarioId === l.id)
                  .map((it) => (
                    <circle
                      key={it.key}
                      cx={x(monthNumber(it.date))}
                      cy={cy}
                      r={it.kind === 'custom' ? 5 : 4}
                      fill={it.kind === 'custom' ? l.color : 'var(--chart-surface)'}
                      stroke={it.kind === 'custom' ? 'var(--chart-surface)' : l.color}
                      strokeWidth={2}
                      onPointerEnter={() => setHover(it)}
                      onPointerLeave={() => setHover(null)}
                      style={{ cursor: 'default' }}
                    />
                  ))}
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(x(monthNumber(hover.date)) + 10, width - 220), top: 0 }}>
          <div className="chart-tooltip-title">{hover.title}</div>
          <div className="faint">{monthLabel(hover.date)}</div>
          {hover.detail && <div style={{ marginTop: 4 }}>{hover.detail}</div>}
        </div>
      )}
      <ul className="chart-legend" style={{ marginTop: 6 }}>
        <li>
          <span className="dot" style={{ background: 'var(--text-2)' }} /> Your milestone
        </li>
        <li>
          <span className="dot" style={{ background: 'transparent', boxShadow: 'inset 0 0 0 2px var(--text-2)' }} /> Projected from assumptions
        </li>
        <li>
          <span className="swatch-line" style={{ background: 'var(--text-3)' }} /> Today
        </li>
      </ul>
    </div>
  );
}

function MilestoneDialog({ ctx, value, onClose }: { ctx: WorkspaceContext; value: MilestoneDTO | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const active = ctx.drafts.scenarios.filter((s) => s.status === 'active');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(currentMonth());
  const [scenarioId, setScenarioId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const k = value === null ? null : value === 'new' ? 'new' : value.id;
  if (k !== key) {
    setKey(k);
    setError(null);
    if (value && value !== 'new') {
      setTitle(value.title);
      setDate(value.date);
      setScenarioId(value.scenarioId ?? '');
      setDescription(value.description ?? '');
    } else {
      setTitle('');
      setDate(active[0]?.startDate ?? currentMonth());
      setScenarioId('');
      setDescription('');
    }
  }
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { title, date, scenarioId: scenarioId || null, description: description || null };
      if (value === 'new') await post(`/decisions/${ctx.decision.id}/milestones`, body);
      else if (value) await patch(`/milestones/${value.id}`, body);
      ctx.refresh();
      toast(value === 'new' ? 'Milestone added.' : 'Milestone updated.');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={value !== null}
      onClose={onClose}
      title={value === 'new' ? 'Add milestone' : 'Edit milestone'}
      description="Milestones mark moments you want to plan for or check against reality."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void submit()}>
            {value === 'new' ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Title" htmlFor="mt" error={error}>
        <Input id="mt" value={title} placeholder="e.g. Language certificate (B1)" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="field-row">
        <Field label="Month" htmlFor="md">
          <Input id="md" type="month" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="Scenario" htmlFor="ms">
          <Select id="ms" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            <option value="">All scenarios</option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor="mn" optional>
        <Textarea id="mn" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Dialog>
  );
}

export { monthNumberToDate };
