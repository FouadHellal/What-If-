/**
 * Grounding check: every number the AI writes should come from the facts it
 * was given. Numbers that cannot be matched are surfaced to the user as
 * "unverified" rather than silently trusted.
 */

const NUMBER_RE = /(?<![\w.])([-−]?\s?(?:[€$£¥₹]\s?)?\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|[-−]?\s?(?:[€$£¥₹]\s?)?\d+(?:\.\d+)?)\s?(k|m|bn|million|thousand|billion|%|percent)?(?![\w])/gi;

export function collectFactNumbers(facts: unknown, out: number[] = []): number[] {
  if (typeof facts === 'number' && Number.isFinite(facts)) {
    out.push(facts);
  } else if (Array.isArray(facts)) {
    for (const f of facts) collectFactNumbers(f, out);
  } else if (facts && typeof facts === 'object') {
    for (const v of Object.values(facts)) collectFactNumbers(v, out);
  } else if (typeof facts === 'string') {
    for (const n of extractNumbers(facts)) out.push(n.value);
  }
  return out;
}

export function extractNumbers(text: string): { raw: string; value: number; percent: boolean }[] {
  const out: { raw: string; value: number; percent: boolean }[] = [];
  let m: RegExpExecArray | null;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(text))) {
    const raw = m[0].trim();
    const numStr = m[1]!.replace(/[€$£¥₹\s,]/g, '').replace('−', '-');
    let value = Number(numStr);
    if (!Number.isFinite(value)) continue;
    const suffix = (m[2] ?? '').toLowerCase();
    if (suffix === 'k' || suffix === 'thousand') value *= 1_000;
    else if (suffix === 'm' || suffix === 'million') value *= 1_000_000;
    else if (suffix === 'bn' || suffix === 'billion') value *= 1_000_000_000;
    out.push({ raw, value, percent: suffix === '%' || suffix === 'percent' });
  }
  return out;
}

function matches(value: number, fact: number): boolean {
  if (value === fact) return true;
  const a = Math.abs(value);
  const b = Math.abs(fact);
  if (Math.sign(value) !== Math.sign(fact) && a > 0 && b > 0) {
    // Allow "a loss of 5,000" phrased without the sign.
    return matches(a, b);
  }
  const tol = Math.max(0.6, b * 0.02);
  return Math.abs(a - b) <= tol;
}

/** Returns the raw strings of numbers in `text` that do not correspond to any fact. */
export function findUnverifiedNumbers(text: string, facts: unknown): string[] {
  const factNums = collectFactNumbers(facts);
  const expanded = new Set<number>();
  for (const f of factNums) {
    expanded.add(f);
    expanded.add(Math.round(f));
    if (Math.abs(f) <= 1) expanded.add(f * 100); // probabilities written as percentages
  }
  const list = [...expanded];
  const unverified: string[] = [];
  for (const n of extractNumbers(text)) {
    const v = n.value;
    // Small counts, ordinals and calendar years are not claims about outcomes.
    if (Math.abs(v) <= 12 && Number.isInteger(v) && !n.percent) continue;
    if (v >= 1900 && v <= 2150 && Number.isInteger(v)) continue;
    if (!list.some((f) => matches(v, f) || matches(v, Math.abs(f)))) unverified.push(n.raw);
  }
  return [...new Set(unverified)].slice(0, 20);
}
