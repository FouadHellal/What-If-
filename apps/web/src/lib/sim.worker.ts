/// <reference lib="webworker" />
/**
 * Runs simulations and the Decision Intelligence analysis off the main thread,
 * so editing stays responsive even at 5,000 uncertainty runs.
 */
import { simulate, type ScenarioModel, type SimulationOptions, type SimulationResult } from '@whatif/engine';
import { buildIntelligence, type IntelligenceInput } from '@whatif/shared';

export type WorkerRequest =
  | { type: 'simulate'; id: number; hash: string; model: ScenarioModel; options: SimulationOptions }
  | { type: 'intelligence'; id: number; input: Omit<IntelligenceInput, 'results' | 'models'> & { results: [string, SimulationResult][]; models: [string, ScenarioModel][] } };

export type WorkerResponse =
  | { type: 'simulate'; id: number; hash: string; result?: SimulationResult; error?: string }
  | { type: 'intelligence'; id: number; result?: ReturnType<typeof buildIntelligence>; error?: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'simulate') {
      const result = simulate(msg.model, msg.options);
      (self as unknown as Worker).postMessage({ type: 'simulate', id: msg.id, hash: msg.hash, result } satisfies WorkerResponse);
    } else {
      const result = buildIntelligence({ ...msg.input, results: new Map(msg.input.results), models: new Map(msg.input.models) });
      (self as unknown as Worker).postMessage({ type: 'intelligence', id: msg.id, result } satisfies WorkerResponse);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: msg.type, id: msg.id, hash: msg.type === 'simulate' ? msg.hash : '', error: (err as Error).message } as WorkerResponse);
  }
};
