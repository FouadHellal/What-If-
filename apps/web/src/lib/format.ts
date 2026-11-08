import type { VariableUnit } from '@whatif/engine';

let locale = 'en-US';
export function setNumberLocale(l: string | undefined) {
  if (l) locale = l;
}
export function getNumberLocale() {
  return locale;
}

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `${locale}|${key}`;
  let f = cache.get(k);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, opts);
    } catch {
      f = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    }
    cache.set(k, f);
  }
  return f;
}

export function money(v: number | null | undefined, currency: string, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  // Compact notation only pays off for large values; "€851.7" reads worse than "€852".
  const compact = Boolean(opts.compact) && Math.abs(v) >= 10_000;
  const f = nf(`m:${currency}:${compact ? 'c' : 'f'}:${opts.sign ? 's' : ''}`, {
    style: 'currency',
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    minimumFractionDigits: 0,
    ...(compact ? { notation: 'compact' } : {}),
    ...(opts.sign ? { signDisplay: 'exceptZero' } : {}),
  });
  return f.format(compact ? v : Math.round(v));
}

export function number(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return nf(`n:${digits}`, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

export function compactNumber(v: number): string {
  return nf('cn', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${number(v, digits)} %`;
}

/** Probability 0–1 → "27 %". */
export function prob(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 100)} %`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? ''} ${y}`;
}

export function dateLabel(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return dateLabel(iso);
}

export function durationMonths(m: number): string {
  if (m === 0) return 'immediately';
  if (m % 12 === 0) return `${m / 12} year${m === 12 ? '' : 's'}`;
  if (m > 12) return `${Math.floor(m / 12)} yr ${m % 12} mo`;
  return `${m} month${m === 1 ? '' : 's'}`;
}

export function unitSuffix(unit: VariableUnit, currency: string): string {
  switch (unit) {
    case 'currency':
      return currency;
    case 'currency_month':
      return `${currency}/mo`;
    case 'currency_year':
      return `${currency}/yr`;
    case 'percent':
      return '%';
    case 'percent_year':
      return '%/yr';
    case 'months':
      return 'months';
    case 'years':
      return 'years';
    case 'hours_week':
      return 'h/week';
  }
}

export function formatUnit(v: number | null | undefined, unit: VariableUnit, currency: string): string {
  if (v === null || v === undefined) return 'Not set';
  switch (unit) {
    case 'currency':
      return money(v, currency);
    case 'currency_month':
      return `${money(v, currency)}/mo`;
    case 'currency_year':
      return `${money(v, currency)}/yr`;
    case 'percent':
    case 'percent_year':
      return pct(v, 1);
    case 'months':
      return durationMonths(v);
    case 'years':
      return `${number(v)} yr`;
    case 'hours_week':
      return `${number(v)} h/wk`;
  }
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses user-typed numbers, accepting thousands separators, spaces and k/m suffixes. */
export function parseNumberInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[\s  ']/g, '');
  if (s === '' || s === '-') return null;
  const m = /^(-?)([\d.,]+)(k|m)?$/.exec(s);
  if (!m) return Number.NaN;
  let body = m[2]!;
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the later one is the decimal separator.
    body = lastComma > lastDot ? body.replace(/\./g, '').replace(',', '.') : body.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "12,500" (thousands) vs "2,5" (decimal)
    body = /,\d{3}$/.test(body) && !/,\d{3},?\d{1,2}$/.test(body) ? body.replace(/,/g, '') : body.replace(',', '.');
  } else if ((body.match(/\./g) ?? []).length > 1) {
    body = body.replace(/\./g, '');
  }
  let n = Number(body);
  if (!Number.isFinite(n)) return Number.NaN;
  if (m[3] === 'k') n *= 1_000;
  if (m[3] === 'm') n *= 1_000_000;
  return m[1] ? -n : n;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
