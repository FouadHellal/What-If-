import { DEFAULT_RUNS, DEFAULT_SEED, monthNumber, type GoalSpec, type SimulationOptions } from '@whatif/engine';
import { decisionSettingsSchema, type DecisionSettings } from './schemas';

/** Parses stored decision settings, dropping anything invalid instead of failing. */
export function parseSettings(raw: unknown): DecisionSettings {
  const r = decisionSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

/**
 * The exact simulation options for one scenario of a decision. The server (stored
 * runs) and the browser (live preview) both use this, so their input hashes match.
 * All scenarios share one seed, so their uncertainty runs are paired (common random numbers).
 */
export function simulationOptions(
  settings: DecisionSettings | null | undefined,
  scenario: { startDate: string; currency: string; exchangeRateToBase: number | null },
  baseCurrency: string,
): SimulationOptions {
  const fx = scenario.currency === baseCurrency ? 1 : scenario.exchangeRateToBase && scenario.exchangeRateToBase > 0 ? scenario.exchangeRateToBase : null;
  const start = monthNumber(scenario.startDate);
  const goals: GoalSpec[] = fx
    ? (settings?.goals ?? [])
        .map((g) => ({
          id: g.id,
          label: g.label,
          kind: g.kind,
          target: g.target / fx,
          month: g.kind === 'net_worth_at' && g.date ? monthNumber(g.date) - start : null,
        }))
        .filter((g) => g.month === null || g.month >= 0)
    : [];
  return {
    seed: DEFAULT_SEED,
    runs: settings?.runs ?? DEFAULT_RUNS,
    correlations: settings?.correlations ?? 'default',
    goals,
  };
}
