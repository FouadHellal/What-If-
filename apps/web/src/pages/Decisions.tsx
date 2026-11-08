import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Search, Split } from 'lucide-react';
import { CATEGORIES, DECISION_STATUSES, STATUS_LABELS } from '@whatif/shared';
import { useDecisions } from '../api/queries';
import { Button, ButtonLink, EmptyState, ErrorState, Input, Select, Skeleton } from '../components/ui';
import { DecisionRow } from './Overview';

export default function Decisions() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? 'active';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'updated';
  const page = Number(params.get('page') ?? 1) || 1;
  const [search, setSearch] = useState(q);

  useEffect(() => {
    document.title = 'Decisions · What-If';
  }, []);

  // Debounce search input into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) update({ q: search, page: '' });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const list = useDecisions({ q: q || undefined, status, category: category || undefined, sort, page });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(q || category || status !== 'active');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Decisions</h1>
          <p className="page-subtitle">Every question you are exploring, with its scenarios and status.</p>
        </div>
        <ButtonLink to="/decisions/new" variant="primary" icon={<Plus aria-hidden />}>
          New decision
        </ButtonLink>
      </header>

      <div className="filters">
        <div className="search">
          <Search aria-hidden />
          <Input type="search" placeholder="Search decisions" aria-label="Search decisions" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => update({ status: e.target.value, page: '' })}>
          <option value="active">All active</option>
          {DECISION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          <option value="all">Everything</option>
        </Select>
        <Select aria-label="Category" value={category} onChange={(e) => update({ category: e.target.value, page: '' })}>
          <option value="">All types</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Sort by" value={sort} onChange={(e) => update({ sort: e.target.value })}>
          <option value="updated">Last modified</option>
          <option value="created">Newest</option>
          <option value="title">Title</option>
        </Select>
      </div>

      {list.isLoading && (
        <div className="stack">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={76} />
          ))}
        </div>
      )}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={<Split />}
          title={filtered ? 'No decisions match' : 'No decisions yet'}
          actions={
            filtered ? (
              <Button
                onClick={() => {
                  setSearch('');
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Clear filters
              </Button>
            ) : (
              <ButtonLink to="/decisions/new" variant="primary" icon={<Plus aria-hidden />}>
                New decision
              </ButtonLink>
            )
          }
        >
          {filtered ? 'Try a different search or filter.' : 'Describe a decision you are facing and compare the paths in front of you.'}
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className="list" style={{ opacity: list.isFetching ? 0.6 : 1, transition: 'opacity 120ms' }}>
            {data.items.map((d) => (
              <DecisionRow key={d.id} d={d} />
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 'var(--s-6)' }}>
            <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
              {data.total} decision{data.total === 1 ? '' : 's'}
            </span>
            {pages > 1 && (
              <div className="row">
                <Button size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                  Previous
                </Button>
                <span className="faint num" style={{ fontSize: 'var(--text-xs)' }}>
                  Page {page} of {pages}
                </span>
                <Button size="sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                  Next
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
