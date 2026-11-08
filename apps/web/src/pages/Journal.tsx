import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { JOURNAL_TYPES, JOURNAL_TYPE_LABELS, type DecisionSummaryDTO, type JournalEntryDTO, type Paginated } from '@whatif/shared';
import { useQuery } from '@tanstack/react-query';
import { del, get, patch, post } from '../api/client';
import { useJournal } from '../api/queries';
import { dateLabel, money, todayISO } from '../lib/format';
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Menu, NumberInput, Select, Skeleton, Textarea, useToast } from '../components/ui';

type JournalType = (typeof JOURNAL_TYPES)[number];

function useAllDecisions() {
  return useQuery({ queryKey: ['decisions', 'all-for-select'], queryFn: ({ signal }) => get<Paginated<DecisionSummaryDTO>>('/decisions?status=all&pageSize=100&sort=title', signal) });
}

export function JournalEntryDialog({
  open,
  onClose,
  entry,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  entry?: JournalEntryDTO | null;
  preset?: { type?: JournalType; decisionId?: string; scenarioId?: string };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const decisions = useAllDecisions();
  const [type, setType] = useState<JournalType>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [entryDate, setEntryDate] = useState(todayISO());
  const [decisionId, setDecisionId] = useState('');
  const [actuals, setActuals] = useState<NonNullable<JournalEntryDTO['actuals']>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setType((entry?.type as JournalType) ?? preset?.type ?? 'note');
    setTitle(entry?.title ?? (preset?.type === 'checkin' ? 'Check-in' : ''));
    setBody(entry?.body ?? '');
    setEntryDate(entry?.entryDate ?? todayISO());
    setDecisionId(entry?.decisionId ?? preset?.decisionId ?? '');
    setActuals(entry?.actuals ?? {});
  }, [open, entry, preset]);

  const decision = decisions.data?.items.find((d) => d.id === decisionId);
  const cur = decision?.baseCurrency ?? 'EUR';

  const save = async () => {
    setBusy(true);
    setError(null);
    const payload = {
      type,
      title: title.trim() || JOURNAL_TYPE_LABELS[type]!.label,
      body,
      entryDate,
      decisionId: decisionId || null,
      scenarioId: entry?.scenarioId ?? (decisionId && decisionId === preset?.decisionId ? (preset?.scenarioId ?? null) : null),
      actuals: type === 'checkin' ? actuals : null,
    };
    try {
      if (entry) await patch(`/journal/${entry.id}`, payload);
      else await post('/journal', payload);
      void qc.invalidateQueries({ queryKey: ['journal'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      toast(entry ? 'Entry updated.' : 'Entry added to your journal.');
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
      title={entry ? 'Edit journal entry' : 'New journal entry'}
      description={JOURNAL_TYPE_LABELS[type]?.description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {entry ? 'Save' : 'Add entry'}
          </Button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Type" htmlFor="jt">
          <Select id="jt" value={type} onChange={(e) => setType(e.target.value as JournalType)}>
            {JOURNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {JOURNAL_TYPE_LABELS[t]!.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="jd">
          <Input id="jd" type="date" value={entryDate} onChange={(e) => e.target.value && setEntryDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Decision" htmlFor="jdec" optional>
        <Select id="jdec" value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
          <option value="">Not linked to a decision</option>
          {decisions.data?.items.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" htmlFor="jtitle" error={error}>
        <Input id="jtitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      {type === 'checkin' && (
        <div className="checkin-grid">
          <Field label="Net worth today" htmlFor="anw" hint={decision ? `In ${cur}, the decision’s comparison currency.` : 'Link a decision to compare with its projection.'}>
            <NumberInput id="anw" value={actuals.netWorth ?? null} onChange={(v) => setActuals((a) => ({ ...a, netWorth: v }))} suffix={cur} digits={0} />
          </Field>
          <Field label="Cash" htmlFor="acash" optional>
            <NumberInput id="acash" value={actuals.cash ?? null} onChange={(v) => setActuals((a) => ({ ...a, cash: v }))} suffix={cur} digits={0} />
          </Field>
          <Field label="Monthly net income" htmlFor="ainc" optional>
            <NumberInput id="ainc" value={actuals.monthlyIncome ?? null} onChange={(v) => setActuals((a) => ({ ...a, monthlyIncome: v }))} suffix={`${cur}/mo`} digits={0} />
          </Field>
          <Field label="Monthly costs" htmlFor="aexp" optional>
            <NumberInput id="aexp" value={actuals.monthlyExpenses ?? null} onChange={(v) => setActuals((a) => ({ ...a, monthlyExpenses: v }))} suffix={`${cur}/mo`} digits={0} />
          </Field>
          <Field label="How satisfied are you?" optional>
            <div className="pips" role="group" aria-label="Satisfaction">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-pressed={actuals.satisfaction === n} onClick={() => setActuals((a) => ({ ...a, satisfaction: a.satisfaction === n ? null : n }))}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}
      <Field label="Entry" htmlFor="jbody" optional>
        <Textarea id="jbody" rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write freely. This is your private record." />
      </Field>
    </Dialog>
  );
}

export default function Journal() {
  const [decisionId, setDecisionId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useJournal({ decisionId: decisionId || undefined, type: type || undefined, page });
  const decisions = useAllDecisions();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<JournalEntryDTO | null | 'new'>(null);
  const [deleting, setDeleting] = useState<JournalEntryDTO | null>(null);

  useEffect(() => {
    document.title = 'Journal · What-If';
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, JournalEntryDTO[]>();
    for (const e of list.data?.items ?? []) {
      const k = e.entryDate.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [list.data]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Decision journal</h1>
          <p className="page-subtitle">Why you considered a decision, what you expected, what you chose — and, later, what actually happened.</p>
        </div>
        <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>
          New entry
        </Button>
      </header>
      <div className="filters">
        <Select aria-label="Decision" value={decisionId} onChange={(e) => (setDecisionId(e.target.value), setPage(1))}>
          <option value="">All decisions</option>
          {decisions.data?.items.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
        <Select aria-label="Type" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
          <option value="">All entry types</option>
          {JOURNAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {JOURNAL_TYPE_LABELS[t]!.label}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading && <Skeleton height={160} />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState icon={<BookOpen />} title={decisionId || type ? 'No entries match' : 'Your journal is empty'} actions={<Button variant="primary" onClick={() => setEditing('new')}>Write the first entry</Button>}>
          Write down your reasoning before you decide. In a year, it will be the most valuable part of the plan.
        </EmptyState>
      )}

      <div className="journal">
        {grouped.map(([month, entries]) => (
          <section key={month} className="journal-month">
            <h2 className="journal-month-label">{new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
            {entries.map((e) => (
              <article key={e.id} className="journal-entry">
                <div className="journal-entry-head">
                  <div className="row" style={{ gap: 8 }}>
                    <Badge tone={e.type === 'decision' ? 'good' : e.type === 'checkin' ? 'accent' : undefined}>{JOURNAL_TYPE_LABELS[e.type]?.label}</Badge>
                    <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                      {dateLabel(e.entryDate)}
                    </span>
                    {e.decisionTitle && e.decisionId && (
                      <Link to={`/decisions/${e.decisionId}`} style={{ fontSize: 'var(--text-xs)' }}>
                        {e.decisionTitle}
                      </Link>
                    )}
                  </div>
                  <Menu
                    items={[
                      { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(e) },
                      { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => setDeleting(e) },
                    ]}
                  />
                </div>
                <h3 className="journal-title serif">{e.title}</h3>
                {e.type === 'checkin' && e.actuals && (
                  <div className="checkin-compare">
                    {(['netWorth', 'cash', 'monthlyIncome', 'monthlyExpenses'] as const).map((k) => {
                      const a = e.actuals?.[k];
                      if (a === null || a === undefined) return null;
                      const p = e.projected?.[k] ?? null;
                      const label = { netWorth: 'Net worth', cash: 'Cash', monthlyIncome: 'Monthly income', monthlyExpenses: 'Monthly costs' }[k];
                      const cur = decisions.data?.items.find((d) => d.id === e.decisionId)?.baseCurrency ?? 'EUR';
                      const diff = p === null ? null : a - p;
                      const good = diff === null ? null : k === 'monthlyExpenses' ? diff <= 0 : diff >= 0;
                      return (
                        <div key={k}>
                          <span className="faint">{label}</span>
                          <strong className="num">{money(a, cur)}</strong>
                          {p !== null && (
                            <span className={`num ${good ? 'delta-good' : 'delta-bad'}`} style={{ fontSize: 'var(--text-xs)' }}>
                              {money(diff!, cur, { sign: true })} vs plan
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {e.body && <p className="journal-body">{e.body}</p>}
              </article>
            ))}
          </section>
        ))}
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--s-6)' }}>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span className="faint num" style={{ fontSize: 'var(--text-xs)' }}>
            Page {page} of {pages}
          </span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}

      <JournalEntryDialog open={editing !== null} onClose={() => setEditing(null)} entry={editing === 'new' ? null : editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        danger
        title="Delete this entry?"
        description="Journal entries are your historical record. Deleting one cannot be undone."
        confirmLabel="Delete entry"
        onConfirm={async () => {
          try {
            await del(`/journal/${deleting!.id}`);
            void qc.invalidateQueries({ queryKey: ['journal'] });
          } catch (err) {
            toast((err as Error).message, 'bad');
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
