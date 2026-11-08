/**
 * Randomness for the uncertainty analysis. Everything is seeded and pure.
 *
 * Common random numbers: each run draws from independent *streams* (parameters,
 * markets, employment, shocks, flows), each derived from (seed, stream, run).
 * Scenarios of the same decision therefore see the same market path and the
 * same parameter quantiles in run k, which makes pairwise comparisons
 * ("A beats B in 72 % of futures") meaningful instead of noise.
 */
import { createRandom } from './util';

export type StreamName = 'params' | 'market' | 'employment' | 'shocks' | 'flows';
const STREAM_IDS: Record<StreamName, number> = { params: 1, market: 2, employment: 3, shocks: 4, flows: 5 };

/** 32-bit integer mix (lowbias32). */
function mix(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function stream(seed: number, name: StreamName, run: number): () => number {
  return createRandom(mix(mix(seed ^ Math.imul(STREAM_IDS[name], 0x9e3779b1)) ^ Math.imul(run + 1, 0x85ebca6b)));
}

/** Standard normal via Box–Muller (uses two uniforms, returns one value). */
export function normal(rand: () => number): number {
  let u = rand();
  if (u < 1e-12) u = 1e-12;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Cholesky factor of a symmetric positive-definite matrix, or null if it is not PD. */
export function cholesky(m: number[][]): number[][] | null {
  const n = m.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i]![j]!;
      for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (sum <= 1e-12) return null;
        L[i]![j] = Math.sqrt(sum);
      } else {
        L[i]![j] = sum / L[j]![j]!;
      }
    }
  }
  return L;
}

/** Poisson draw by inversion (fine for the small rates used here), capped. */
export function poisson(rand: () => number, lambda: number, cap = 8): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L && k <= cap);
  return Math.min(k - 1, cap);
}

/**
 * Lognormal annual return with the given arithmetic mean and volatility
 * (both as fractions). E[1 + R] = 1 + mean.
 */
export function lognormalReturn(z: number, mean: number, vol: number): number {
  if (vol <= 0) return mean;
  const m1 = 1 + mean;
  if (m1 <= 0) return mean;
  const s2 = Math.log(1 + (vol * vol) / (m1 * m1));
  const mu = Math.log(m1) - s2 / 2;
  return Math.exp(mu + Math.sqrt(s2) * z) - 1;
}
