import { useMemo } from 'react';
import {
  DEFAULT_RUNS,
  DEFAULT_SEED,
  compareScenarios,
  hashInputs,
  simulate,
  type Comparison,
  type ScenarioModel,
  type SeriesField,
  type SimulationResult,
} from '@whatif/engine';
import type { DecisionDTO, ScenarioDTO } from '@whatif/shared';

/**
 * The browser runs the same deterministic engine as the server, so projections
 * update instantly while editing. Results are cached by input hash; the server
 * stores the authoritative, reproducible run when changes are saved.
 */
const cache = new Map<string, SimulationResult>();
const MAX = 64;

export function toModel(s: Pick<ScenarioDTO, 'startDate' | 'horizonYears' | 'currency' | 'variables' | 'flows'>): ScenarioModel {
  return { startDate: s.startDate, horizonYears: s.horizonYears, currency: s.currency, variables: s.variables, flows: s.flows };
}

export function simulateCached(model: ScenarioModel): SimulationResult {
  const options = { seed: DEFAULT_SEED, runs: DEFAULT_RUNS };
  const h = hashInputs(model, options);
  const hit = cache.get(h);
  if (hit) {
    cache.delete(h);
    cache.set(h, hit);
    return hit;
  }
  const r = simulate(model, options);
  cache.set(h, r);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return r;
}

export function useSimulation(s: ScenarioDTO | null | undefined): SimulationResult | null {
  return useMemo(() => {
    if (!s) return null;
    try {
      return simulateCached(toModel(s));
    } catch {
      return null;
    }
  }, [s]);
}

export function useSimulations(scenarios: ScenarioDTO[]): Map<string, SimulationResult> {
  return useMemo(() => {
    const m = new Map<string, SimulationResult>();
    for (const s of scenarios) {
      try {
        m.set(s.id, simulateCached(toModel(s)));
      } catch {
        /* invalid model: shown as an error in the editor */
      }
    }
    return m;
  }, [scenarios]);
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
