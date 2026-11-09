import { useEffect, useMemo, useRef, useState } from 'react';
import {
  compareScenarios,
  hashInputs,
  simulate,
  type Comparison,
  type ScenarioModel,
  type SeriesField,
  type SimulationOptions,
  type SimulationResult,
} from '@whatif/engine';
import { simulationOptions, type DecisionDTO, type DecisionIntelligence, type DecisionSettings, type ScenarioDTO } from '@whatif/shared';
import type { WorkerRequest, WorkerResponse } from './sim.worker';

/**
 * The browser runs the same deterministic engine as the server, in a Web Worker,
 * so projections update while editing. Results are cached by input hash; the
 * server stores the authoritative, reproducible run when changes are saved.
 */
const cache = new Map<string, SimulationResult>();
const MAX = 96;

function remember(hash: string, r: SimulationResult) {
  cache.set(hash, r);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
}

export function toModel(s: Pick<ScenarioDTO, 'startDate' | 'horizonYears' | 'currency' | 'variables' | 'flows'> & { tax?: ScenarioDTO['tax'] }): ScenarioModel {
  const m: ScenarioModel = { startDate: s.startDate, horizonYears: s.horizonYears, currency: s.currency, variables: s.variables, flows: s.flows };
  if (s.tax && s.tax.brackets.length > 0) m.tax = s.tax;
  return m;
}

export function optionsFor(s: ScenarioDTO, decision: Pick<DecisionDTO, 'settings' | 'baseCurrency'> | undefined, settingsOverride?: DecisionSettings): SimulationOptions {
  return simulationOptions(settingsOverride ?? decision?.settings ?? {}, s, decision?.baseCurrency ?? s.currency);
}

// ── Worker plumbing ─────────────────────────────────────────────────────────

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: WorkerResponse) => void>();
const inflight = new Map<string, Promise<SimulationResult>>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const cb = pending.get(e.data.id);
        if (cb) {
          pending.delete(e.data.id);
          cb(e.data);
        }
      };
      worker.onerror = () => {
        worker = null;
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

export function simulateAsync(model: ScenarioModel, options: SimulationOptions): Promise<SimulationResult> {
  const hash = hashInputs(model, options);
  const hit = cache.get(hash);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(hash);
  if (running) return running;
  const w = getWorker();
  const p = new Promise<SimulationResult>((resolve, reject) => {
    if (!w) {
      try {
        const r = simulate(model, options);
        remember(hash, r);
        resolve(r);
      } catch (err) {
        reject(err);
      }
      return;
    }
    const id = ++seq;
    pending.set(id, (res) => {
      if (res.type === 'simulate' && res.result) {
        remember(hash, res.result);
        resolve(res.result);
      } else reject(new Error(res.error ?? 'Simulation failed'));
    });
    w.postMessage({ type: 'simulate', id, hash, model, options } satisfies WorkerRequest);
  }).finally(() => inflight.delete(hash));
  inflight.set(hash, p);
  return p;
}

export function intelligenceAsync(input: Extract<WorkerRequest, { type: 'intelligence' }>['input']): Promise<DecisionIntelligence> {
  const w = getWorker();
  if (!w) {
    return import('@whatif/shared').then(({ buildIntelligence }) => buildIntelligence({ ...input, results: new Map(input.results), models: new Map(input.models) }));
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (res) => {
      if (res.type === 'intelligence' && res.result) resolve(res.result);
      else reject(new Error(res.error ?? 'Analysis failed'));
    });
    w.postMessage({ type: 'intelligence', id, input } satisfies WorkerRequest);
  });
}

/** Synchronous cached simulation (used for quick previews and tests). */
export function simulateCached(model: ScenarioModel, options: SimulationOptions = {}): SimulationResult {
  const hash = hashInputs(model, options);
  const hit = cache.get(hash);
  if (hit) return hit;
  const r = simulate(model, options);
  remember(hash, r);
  return r;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Simulates every scenario of a decision. Keeps showing the previous result for
 * a scenario while its new inputs are being computed (no flicker), and reports
 * which ones are still computing.
 */
export function useSimulations(scenarios: ScenarioDTO[], decision?: Pick<DecisionDTO, 'settings' | 'baseCurrency'>): { results: Map<string, SimulationResult>; computing: Set<string>; errors: Map<string, string> } {
  const [, force] = useState(0);
  const last = useRef(new Map<string, SimulationResult>());
  const errorsRef = useRef(new Map<string, string>());
  const jobs = useMemo(
    () =>
      scenarios.map((s) => {
        const model = toModel(s);
        const options = optionsFor(s, decision);
        return { id: s.id, model, options, hash: hashInputs(model, options) };
      }),
    [scenarios, decision],
  );
  const computing = new Set<string>();
  for (const j of jobs) {
    const hit = cache.get(j.hash);
    if (hit) last.current.set(j.id, hit);
    else computing.add(j.id);
  }
  useEffect(() => {
    let alive = true;
    for (const j of jobs) {
      if (cache.has(j.hash)) continue;
      simulateAsync(j.model, j.options)
        .then((r) => {
          if (!alive) return;
          last.current.set(j.id, r);
          errorsRef.current.delete(j.id);
          force((n) => n + 1);
        })
        .catch((err: Error) => {
          if (!alive) return;
          errorsRef.current.set(j.id, err.message);
          force((n) => n + 1);
        });
    }
    return () => {
      alive = false;
    };
  }, [jobs]);
  const ids = new Set(scenarios.map((s) => s.id));
  const results = new Map([...last.current].filter(([id]) => ids.has(id)));
  return { results, computing, errors: errorsRef.current };
}

export function fxFor(s: ScenarioDTO, base: string): { rate: number; missing: boolean } {
  if (s.currency === base) return { rate: 1, missing: false };
  if (s.exchangeRateToBase && s.exchangeRateToBase > 0) return { rate: s.exchangeRateToBase, missing: false };
  return { rate: 1, missing: true };
}

export function useComparison(decision: DecisionDTO | undefined, scenarios: ScenarioDTO[], results: Map<string, SimulationResult>, field: SeriesField = 'netWorth'): Comparison | null {
  return useMemo(() => {
    if (!decision) return null;
    const items = scenarios
      .filter((s) => results.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        isBaseline: s.isBaseline,
        result: results.get(s.id)!,
        exchangeRateToBase: fxFor(s, decision.baseCurrency).rate,
        scores: s.scores,
      }));
    return compareScenarios(items, decision.baseCurrency, decision.priorities ?? {}, { field });
  }, [decision, scenarios, results, field]);
}

/** Decision Intelligence for the current scenarios, computed in the worker. */
export function useIntelligence(decision: DecisionDTO | undefined, scenarios: ScenarioDTO[], results: Map<string, SimulationResult>, lifeWeights: Record<string, number> | undefined): { data: DecisionIntelligence | null; loading: boolean } {
  const [data, setData] = useState<DecisionIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const active = scenarios.filter((s) => s.status === 'active');
  const ready = decision && active.length > 0 && active.every((s) => results.has(s.id));
  const key = ready ? active.map((s) => `${s.id}:${results.get(s.id)!.inputHash}:${s.exchangeRateToBase}:${JSON.stringify(s.scores)}`).join('|') + JSON.stringify(lifeWeights ?? {}) + decision!.assumptions.length : '';
  useEffect(() => {
    if (!ready || !decision) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      intelligenceAsync({
        title: decision.title,
        question: decision.question,
        category: decision.category,
        baseCurrency: decision.baseCurrency,
        scenarios: active,
        assumptions: decision.assumptions,
        lifeWeights: lifeWeights ?? {},
        results: active.map((s) => [s.id, results.get(s.id)!]),
        models: active.map((s) => [s.id, toModel(s)]),
      })
        .then((r) => alive && setData(r))
        .catch(() => alive && setData(null))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading };
}

export function useSimulation(s: ScenarioDTO | null | undefined, decision?: Pick<DecisionDTO, 'settings' | 'baseCurrency'>): SimulationResult | null {
  const list = useMemo(() => (s ? [s] : []), [s]);
  const { results } = useSimulations(list, decision);
  return s ? (results.get(s.id) ?? null) : null;
}
