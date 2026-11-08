/** Small pure helpers shared by the engine modules. */

export function isValidMonth(date: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(date);
}

/** Absolute month number (year * 12 + monthIndex) of a `YYYY-MM` string. */
export function monthNumber(date: string): number {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return y * 12 + (m - 1);
}

export function monthNumberToDate(n: number): string {
  const y = Math.floor(n / 12);
  const m = n - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function addMonths(date: string, months: number): string {
  return monthNumberToDate(monthNumber(date) + months);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Converts an annual rate in percentage points to the equivalent compounded monthly rate. */
export function monthlyRate(annualPct: number): number {
  const r = annualPct / 100;
  if (r <= -1) return -1;
  return Math.pow(1 + r, 1 / 12) - 1;
}

/** Standard annuity payment. */
export function annuityPayment(principal: number, annualRatePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Rounds to cents to keep outputs stable and readable. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Deterministic PRNG (mulberry32). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples a triangular distribution with the given bounds and mode. */
export function sampleTriangular(u: number, low: number, mode: number, high: number): number {
  if (high <= low) return mode;
  const c = (mode - low) / (high - low);
  if (u < c) return low + Math.sqrt(u * (high - low) * (mode - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

/** Linear-interpolated percentile of a pre-sorted array. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

/** Stable JSON serialisation (sorted keys) used for hashing inputs. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 64-bit (two 32-bit lanes) non-cryptographic hash, rendered as 16 hex chars. */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  } catch {
    return `${Math.round(value).toLocaleString('en-US')} ${currency}`;
  }
}

export function formatMonthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${y}`;
}

export function formatPct(value: number, digits = 0): string {
  return `${value.toFixed(digits)} %`;
}
