import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DecisionDTO, ScenarioDTO } from '@whatif/shared';
import { ApiError, put } from '../../api/client';
import { keys, setScenarioInCache } from '../../api/queries';
import { useToast } from '../../components/ui';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 700;

/**
 * Local, optimistic editing of scenario models.
 * - Edits apply immediately, so projections recalculate as you type.
 * - Each scenario saves independently (debounced) with optimistic concurrency.
 * - A 409 conflict replaces the local copy with the server's latest version.
 */
export function useScenarioDrafts(decision: DecisionDTO | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, ScenarioDTO>>({});
  const [state, setState] = useState<Record<string, SaveState>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seq = useRef<Record<string, number>>({});
  const localRef = useRef(local);
  localRef.current = local;
  const inFlight = useRef<Record<string, boolean>>({});

  const scenarios = useMemo(() => (decision ? decision.scenarios.map((s) => local[s.id] ?? s) : []), [decision, local]);

  const save = useCallback(
    async (id: string) => {
      const draft = localRef.current[id];
      if (!draft) return;
      if (inFlight.current[id]) {
        // Another save is running; try again when it finishes.
        timers.current[id] = setTimeout(() => void save(id), 300);
        return;
      }
      inFlight.current[id] = true;
      const startedAt = seq.current[id] ?? 0;
      setState((s) => ({ ...s, [id]: 'saving' }));
      try {
        const saved = await put<ScenarioDTO>(`/scenarios/${id}/model`, {
          expectedVersion: draft.version,
          startDate: draft.startDate,
          horizonYears: draft.horizonYears,
          currency: draft.currency,
          exchangeRateToBase: draft.exchangeRateToBase,
          exchangeRateSource: draft.exchangeRateSource,
          variables: draft.variables,
          flows: draft.flows,
          scores: draft.scores,
        });
        setScenarioInCache(qc, saved);
        setLocal((l) => {
          if ((seq.current[id] ?? 0) === startedAt) {
            const { [id]: _done, ...rest } = l;
            return rest;
          }
          // Newer edits arrived while saving: keep them, on top of the new version.
          const cur = l[id];
          return cur ? { ...l, [id]: { ...cur, version: saved.version, latestRun: saved.latestRun } } : l;
        });
        setState((s) => ({ ...s, [id]: (seq.current[id] ?? 0) === startedAt ? 'saved' : 'pending' }));
        setLastError(null);
        void qc.invalidateQueries({ queryKey: ['decisions'] });
        void qc.invalidateQueries({ queryKey: keys.overview });
        void qc.invalidateQueries({ queryKey: keys.runs(id) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const current = (err.details as { current?: ScenarioDTO } | undefined)?.current;
          if (current) setScenarioInCache(qc, current);
          setLocal(({ [id]: _drop, ...rest }) => rest);
          setState((s) => ({ ...s, [id]: 'idle' }));
          toast('This scenario was changed in another window. Showing the latest version — please reapply your last edit.', 'bad');
        } else {
          setState((s) => ({ ...s, [id]: 'error' }));
          const msg = err instanceof Error ? err.message : 'Saving failed.';
          setLastError(msg);
          toast(`Could not save: ${msg}`, 'bad');
        }
      } finally {
        inFlight.current[id] = false;
      }
    },
    [qc, toast],
  );

  const edit = useCallback(
    (id: string, updater: (s: ScenarioDTO) => ScenarioDTO) => {
      const base = localRef.current[id] ?? decision?.scenarios.find((s) => s.id === id);
      if (!base) return;
      const next = updater(base);
      seq.current[id] = (seq.current[id] ?? 0) + 1;
      setLocal((l) => ({ ...l, [id]: next }));
      setState((s) => ({ ...s, [id]: 'pending' }));
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => void save(id), DEBOUNCE_MS);
    },
    [decision, save],
  );

  const flush = useCallback(() => {
    for (const id of Object.keys(timers.current)) {
      clearTimeout(timers.current[id]);
      if (localRef.current[id]) void save(id);
    }
  }, [save]);

  const retry = useCallback((id: string) => void save(id), [save]);

  const dirty = Object.values(state).some((s) => s === 'pending' || s === 'saving');

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(localRef.current).length > 0) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [flush]);

  // Save pending edits when leaving the workspace.
  useEffect(() => () => flush(), [flush]);

  const overall: SaveState = Object.values(state).includes('error')
    ? 'error'
    : Object.values(state).some((s) => s === 'saving')
      ? 'saving'
      : Object.values(state).some((s) => s === 'pending')
        ? 'pending'
        : Object.values(state).includes('saved')
          ? 'saved'
          : 'idle';

  return { scenarios, edit, flush, retry, state, overall, dirty, lastError };
}

export function invalidateDecision(qc: ReturnType<typeof useQueryClient>, id: string) {
  void qc.invalidateQueries({ queryKey: keys.decision(id) });
  void qc.invalidateQueries({ queryKey: ['decisions'] });
  void qc.invalidateQueries({ queryKey: keys.overview });
}
