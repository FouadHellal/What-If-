/**
 * Deterministic, rule-based understanding of a "What if…" question.
 * Works offline and without AI. It never invents numbers: only amounts that
 * appear in the question are extracted; everything else is left for the user.
 */
import { findPlaces, type PlaceMatch } from './geo';
import type { DecisionCategory, ScenarioDraft } from './schemas';
import { buildFromTemplate, materializeScenarios, type Baseline, type TemplateEntities } from './templates';

export interface ParsedAmount {
  value: number;
  currency: string | null;
  period: 'month' | 'year' | null;
  raw: string;
  index: number;
}

export interface ParsedQuestion {
  category: DecisionCategory;
  confidence: 'high' | 'medium' | 'low';
  title: string;
  question: string;
  entities: TemplateEntities & { places: PlaceMatch[]; amounts: ParsedAmount[] };
  /** Human-readable notes about what was detected. */
  notes: string[];
}

export interface DecisionDraft {
  title: string;
  question: string;
  category: DecisionCategory;
  baseCurrency: string;
  horizonYears: number;
  scenarios: ScenarioDraft[];
  notes: string[];
  /** Variables that still need input, per scenario name. */
  missing: { scenario: string; items: string[] }[];
  origin: 'parser' | 'ai' | 'template';
}

const CATEGORY_RULES: { category: DecisionCategory; patterns: RegExp[]; weight: number }[] = [
  { category: 'military_service', weight: 4, patterns: [/\b(military|national|army) service\b/, /\bservice (militaire|national)\b/, /\b(conscription|sursis|dispense)\b/, /\bexempt(ion|ed)? from (the )?(military |national |army )?service\b/] },
  { category: 'study_abroad', weight: 4, patterns: [/\bstudy(ing)? abroad\b/, /\bstudent visa\b/] },
  { category: 'remote_work', weight: 4, patterns: [/\b(remote|remotely)\b.*\b(work|job|clients?)\b/, /\b(freelanc\w*|upwork|fiverr)\b.*\b(foreign|abroad|clients? (in|from)|europe|usa)\b/, /\bwork(ing)? remotely\b/] },
  { category: 'public_private', weight: 4, patterns: [/\b(public|government|state) (sector|job)\b/, /\bprivate sector\b/, /\b(fonction publique|civil servant)\b/] },
  { category: 'move_in_together', weight: 4, patterns: [/\bmove in together\b/, /\b(moving|live|living) together\b/, /\b(get(ting)? married|marry|wedding)\b/] },
  { category: 'side_income', weight: 3, patterns: [/\bside (project|hustle|business|income|gig)\b/, /\b(second job|extra income)\b/] },
  { category: 'housing', weight: 3, patterns: [/\bbuy(ing)?\b.*\b(house|home|flat|apartment|property|condo)\b/, /\b(mortgage|instead of renting|rent or buy|buy or rent)\b/] },
  { category: 'investing', weight: 3, patterns: [/\binvest(ing|ment)?\b/, /\b(etf|index fund|stocks|portfolio)\b/] },
  { category: 'business', weight: 3, patterns: [/\b(start|launch|open|found)(ing)?\b.*\b(business|company|startup|start-up|shop|agency|consultancy|consulting|restaurant|venture|freelanc\w*)\b/, /\bgo(ing)? freelance\b/, /\bself[- ]employed\b/] },
  { category: 'family', weight: 3, patterns: [/\b(start(ing)? a family|have (a )?(baby|child|children|kids)|become parents?|another child)\b/] },
  { category: 'sabbatical', weight: 3, patterns: [/\b(year off|time off|sabbatical|gap year|career break|take a break|months off)\b/] },
  { category: 'career_change', weight: 2, patterns: [/\b(change|switch|pivot)(ing)? (my )?(career|profession|field)\b/, /\bretrain(ing)?\b/, /\bbecome an? \w+/] },
  { category: 'education', weight: 2, patterns: [/\b(learn(ing)?|study(ing)?|master'?s|mba|degree|bootcamp|course|certification|phd)\b/] },
  { category: 'job_offer', weight: 3, patterns: [/\b(accept|take)(ing)? (the |a |this )?(new )?(job )?offer\b/, /\bjob offer\b/] },
  { category: 'debt_payoff', weight: 3, patterns: [/\bpay (off|down) (my )?(debt|loans?|credit card|student loan)/, /\b(debt|loan)s? (off|faster|early)\b/] },
  { category: 'major_purchase', weight: 2, patterns: [/\bbuy(ing)? (a |an )?(new )?(car|vehicle|motorbike|boat|camper)\b/, /\b(major|big|large) purchase\b/] },
  { category: 'working_hours', weight: 3, patterns: [/\b(part[- ]time|four[- ]day week|4[- ]day week|fewer hours|reduce (my )?hours|work less)\b/] },
  { category: 'certification', weight: 3, patterns: [/\b(certification|certificate|certified|ccnp|cissp|pmp|aws certif)/] },
  { category: 'study_path', weight: 3, patterns: [/\b(university|degree) (or|vs\.?|versus) (self[- ]study|online|bootcamp|working)\b/, /\bself[- ]study\b/, /\bstudy full[- ]time\b/] },
  { category: 'job_change', weight: 2, patterns: [/\b(leave|quit|resign)(ing)? (from )?(my )?(current )?(job|role|position|work|employer)\b/, /\b(new job|job offer|change jobs?|another job|promotion)\b/] },
  { category: 'relocation', weight: 2, patterns: [/\b(move|moving|relocat\w*|emigrat\w*|live|living)\b.*\b(to|in|abroad)\b/, /\babroad\b/] },
];

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eighteen: 18, twenty: 20, half: 0.5,
};

const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'chf': 'CHF', 'da': 'DZD', 'dzd': 'DZD' };
const CURRENCY_CODE_RE = /\b(EUR|USD|GBP|CHF|CAD|AUD|JPY|INR|DZD|MAD|TND|AED|SAR|SEK|NOK|DKK|PLN|TRY|ZAR|BRL|MXN|SGD|NZD|CNY|EGP)\b/i;

export function parseAmounts(text: string): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  const re = /(€|\$|£|¥|₹)?\s?(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|m|thousand|million|mn)?\b\s?(€|\$|£|eur|euros?|usd|dollars?|gbp|pounds?|chf|cad|aud|dzd|dinars?|da|mad|aed|inr)?(\s?(?:\/|per|a|each|every)\s?(month|mo|year|yr|annum))?(\s?(monthly|annually|yearly))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [raw, sym, numRaw, mult, cur, , per1, per2] = m;
    if (!numRaw) continue;
    // Skip years like 2027 when no currency/multiplier/period context exists.
    const plain = !sym && !mult && !cur && !per1 && !per2;
    let num = parseNumber(numRaw);
    if (plain && (num < 100 || (num >= 1900 && num <= 2100))) continue;
    const after = text.slice(m.index + raw.length, m.index + raw.length + 12).toLowerCase();
    if (plain && /^\s*(years?|months?|weeks?|days?|hours?|%|percent)/.test(after)) continue;
    if (mult) {
      const k = mult.toLowerCase();
      num *= k === 'k' || k === 'thousand' ? 1_000 : 1_000_000;
    }
    const symbol = (sym ?? cur ?? '').toLowerCase();
    let currency: string | null = null;
    if (symbol) {
      if (CURRENCY_SYMBOLS[symbol]) currency = CURRENCY_SYMBOLS[symbol]!;
      else if (/^euros?$/.test(symbol)) currency = 'EUR';
      else if (/^dollars?$/.test(symbol)) currency = 'USD';
      else if (/^pounds?$/.test(symbol)) currency = 'GBP';
      else if (/^dinars?$/.test(symbol)) currency = 'DZD';
      else if (/^[a-z]{3}$/.test(symbol)) currency = symbol.toUpperCase();
    }
    const p = (per1 ?? per2 ?? '').toLowerCase();
    const period = /^(month|mo|monthly)$/.test(p) ? 'month' : /^(year|yr|annum|annually|yearly)$/.test(p) ? 'year' : null;
    out.push({ value: num, currency, period, raw: raw.trim(), index: m.index });
  }
  return out;
}

function parseNumber(s: string): number {
  const t = s.replace(/\s/g, '');
  // "60,000" / "60.000" → thousands separators; "2.5" / "2,5" → decimal
  if (/^\d{1,3}([,.]\d{3})+$/.test(t)) return Number(t.replace(/[,.]/g, ''));
  return Number(t.replace(',', '.'));
}

export function parseDurationMonths(text: string, prefix = '(?<!\\b(?:stay|staying|wait|waiting)\\s)(?:for|spend(?:ing)?|take|taking|during)'): number | null {
  const re = new RegExp(`${prefix}\\s+(\\d+(?:\\.\\d+)?|${Object.keys(WORD_NUMBERS).join('|')})\\s+(years?|months?)`, 'i');
  const m = re.exec(text);
  const alt = /\b(\d+|one|two|three|four|five|six|a|an|half a)[- ](year|month)s?[- ](?:off|break|sabbatical|course|program|programme)/i.exec(text);
  const hit = m ?? alt;
  if (hit) {
    const n = toNumber(hit[1]!);
    const unit = hit[2]!.toLowerCase();
    if (n !== null) return Math.round(unit.startsWith('year') ? n * 12 : n);
  }
  if (/\b(a|one) year off\b|\bgap year\b|\bsabbatical year\b/i.test(text)) return 12;
  return null;
}

function toNumber(s: string): number | null {
  const lower = s.toLowerCase();
  if (lower === 'half a') return 0.5;
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower]!;
  const n = Number(lower);
  return Number.isFinite(n) ? n : null;
}

function detectDelay(text: string): number | null {
  const m = /\b(?:in|after|wait(?:ing)?(?: for)?|stay(?:ing)? (?:for|another))\s+(\d+|one|two|three|four|five|a|an)\s+(years?|months?)\b(?:\s+(?:and\s+)?then)?/i.exec(text);
  if (!m) return null;
  const n = toNumber(m[1]!);
  if (n === null) return null;
  return Math.round(m[2]!.toLowerCase().startsWith('year') ? n * 12 : n);
}

function detectRole(text: string): string | null {
  const m = /\b(?:as an?|become an?|work(?:ing)? as an?|job as an?|role as an?|switch to being an?)\s+([a-z][a-z\s-]{2,40}?)(?=\s+(?:in|at|for|with|and|or|instead|while|then|after|from)\b|[?.,!]|$)/i.exec(text);
  if (!m) return null;
  const role = m[1]!.trim().replace(/\s+/g, ' ');
  return role.length > 1 ? role : null;
}

function detectSkill(text: string): string | null {
  const m = /\blearn(?:ing)?\s+(?:a new skill(?: like| such as)?\s+)?([a-z][a-z\s+#.-]{1,40}?)(?=\s+(?:for|in|during|while|and|then|over|full[- ]time|part[- ]time)\b|[?.,!]|$)/i.exec(text);
  if (!m) return null;
  const s = m[1]!.trim();
  if (/^(a|the|new|one|two)$/i.test(s)) return null;
  return s;
}

function detectFrom(text: string, places: PlaceMatch[]): PlaceMatch | null {
  for (const p of places) {
    const before = text.slice(Math.max(0, p.index - 16), p.index).toLowerCase();
    if (/\b(from|leave|leaving|living in|based in|stay in|staying in|stay at)\s+(the\s+)?$/.test(before)) return p;
  }
  return null;
}

export function classify(text: string): { category: DecisionCategory; confidence: ParsedQuestion['confidence'] } {
  const lower = text.toLowerCase();
  const places = findPlaces(text);
  const scores = new Map<DecisionCategory, number>();
  for (const rule of CATEGORY_RULES) {
    for (const p of rule.patterns) if (p.test(lower)) scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight);
  }
  if (places.length > 0) {
    const sameCountry = places.length >= 2 && places.every((p) => p.country === places[0]!.country);
    const movey = /\b(move|moving|relocat\w*|emigrat\w*|live|living|abroad|work in|job in)\b/.test(lower);
    if (movey) {
      if (sameCountry && places.every((p) => p.kind === 'city')) scores.set('city_move', (scores.get('city_move') ?? 0) + 5);
      else scores.set('relocation', (scores.get('relocation') ?? 0) + 4);
    }
  }
  // A named place plus study words means studying there, not moving for work.
  if (places.length > 0 && /\b(study|studies|studying|masters?|degree|university|phd)\b/.test(lower)) scores.set('study_abroad', (scores.get('study_abroad') ?? 0) + 5);
  // Remote work for clients elsewhere means staying put: places name the clients, not a move.
  if (scores.has('remote_work')) scores.set('remote_work', (scores.get('remote_work') ?? 0) + (scores.get('relocation') ?? 0));
  if (/\b(another|new|different) city\b|\bcity\b.*\bmove\b/.test(lower)) scores.set('city_move', (scores.get('city_move') ?? 0) + 3);
  // The career rule catches "become a …" which also appears in relocation questions ("work as …").
  if (scores.has('relocation') && /\bas an?\b/.test(lower)) scores.set('career_change', Math.max(0, (scores.get('career_change') ?? 0) - 2));

  let best: DecisionCategory = 'other';
  let bestScore = 0;
  for (const [cat, sc] of scores) {
    if (sc > bestScore) {
      best = cat;
      bestScore = sc;
    }
  }
  const confidence = bestScore >= 4 ? 'high' : bestScore >= 2 ? 'medium' : 'low';
  return { category: best, confidence };
}

export function normalizeQuestion(text: string): string {
  let q = text.trim().replace(/\s+/g, ' ');
  if (!/^what if\b/i.test(q)) q = `What if ${q.charAt(0).toLowerCase()}${q.slice(1)}`;
  else q = `What if${q.slice(7)}`;
  if (!/[?.!]$/.test(q)) q += '?';
  return q;
}

export function parseQuestion(text: string): ParsedQuestion {
  const question = normalizeQuestion(text);
  const { category, confidence } = classify(text);
  const places = findPlaces(text);
  const amounts = parseAmounts(text);
  const from = detectFrom(text, places);
  const destinations = places
    .filter((p) => p !== from && (!from || p.label !== from.label))
    .map((p) => ({ label: p.label, currency: p.currency }));
  const notes: string[] = [];
  const entities: ParsedQuestion['entities'] = { places, amounts, destinations };
  if (from) entities.from = from.label;
  const role = detectRole(text);
  if (role) entities.role = role;
  const skill = detectSkill(text);
  if (skill) entities.skill = skill;
  const duration = parseDurationMonths(text);
  if (duration) entities.durationMonths = duration;
  const delay = detectDelay(text);
  if (delay) entities.delayMonths = delay;

  // Assign amounts to meaning based on nearby words.
  for (const a of amounts) {
    const ctx = text.slice(Math.max(0, a.index - 40), a.index + a.raw.length + 25).toLowerCase();
    if (a.currency) entities.currency = a.currency;
    if (/\binvest/.test(ctx) && (a.period === 'month' || /\bevery month|monthly\b/.test(ctx))) {
      entities.monthlyAmount = a.value;
    } else if (/\b(salary|earn|earning|paid|pay|income|make)\b/.test(ctx)) {
      entities.annualSalary = a.period === 'month' ? a.value * 12 : a.value;
    } else if (/\b(house|home|flat|apartment|property|condo)\b/.test(ctx) && a.value >= 10_000) {
      entities.propertyPrice = a.value;
    } else if (a.period === 'month') {
      entities.monthlyAmount = a.value;
    } else if (/\b(cost|costs|budget|fee|fees|tuition|savings of|spend)\b/.test(ctx)) {
      entities.oneTimeAmount = a.value;
    }
  }

  if (places.length) notes.push(`Places: ${places.map((p) => p.label).join(', ')}.`);
  if (role) notes.push(`Role: ${role}.`);
  if (skill && category === 'education') notes.push(`Skill: ${skill}.`);
  if (duration) notes.push(`Duration: ${duration} months.`);
  if (delay) notes.push(`Starts after: ${delay} months.`);
  if (amounts.length) notes.push(`Amounts: ${amounts.map((a) => a.raw).join(', ')}.`);

  return { category, confidence, title: question, question, entities, notes };
}

/** Builds a complete, editable decision draft from a question and the user's baseline. */
export function draftFromQuestion(
  text: string,
  opts: { baseline?: Baseline | null; startDate: string; baseCurrency?: string; horizonYears?: number; category?: DecisionCategory },
): DecisionDraft {
  const parsed = parseQuestion(text);
  const category = opts.category ?? parsed.category;
  const baseCurrency = opts.baseCurrency ?? opts.baseline?.currency ?? parsed.entities.currency ?? parsed.entities.destinations?.[0]?.currency ?? 'EUR';
  const ctx = { baseline: opts.baseline ?? null, startDate: opts.startDate, horizonYears: opts.horizonYears, baseCurrency };
  // A currency mentioned with an amount refers to that amount; ensure destination currencies carry over.
  const built = buildFromTemplate(category, ctx, parsed.entities);
  const scenarios = materializeScenarios(built.scenarios, ctx, baseCurrency);
  const horizonYears = scenarios[0]?.horizonYears ?? 10;
  return {
    title: parsed.question,
    question: parsed.question,
    category,
    baseCurrency,
    horizonYears,
    scenarios,
    notes: parsed.notes,
    missing: listMissing(scenarios),
    origin: 'parser',
  };
}

export function draftFromTemplate(
  category: DecisionCategory,
  opts: { baseline?: Baseline | null; startDate: string; baseCurrency?: string; horizonYears?: number },
): DecisionDraft {
  const baseCurrency = opts.baseCurrency ?? opts.baseline?.currency ?? 'EUR';
  const ctx = { baseline: opts.baseline ?? null, startDate: opts.startDate, horizonYears: opts.horizonYears, baseCurrency };
  const built = buildFromTemplate(category, ctx, {});
  const scenarios = materializeScenarios(built.scenarios, ctx, baseCurrency);
  return {
    title: built.title,
    question: '',
    category,
    baseCurrency,
    horizonYears: scenarios[0]?.horizonYears ?? 10,
    scenarios,
    notes: [],
    missing: listMissing(scenarios),
    origin: 'template',
  };
}

export function listMissing(scenarios: ScenarioDraft[]): DecisionDraft['missing'] {
  return scenarios
    .map((s) => {
      const items: string[] = [];
      for (const [key, v] of Object.entries(s.variables)) if (v && v.value === null) items.push(key);
      for (const f of s.flows) if (f.amount === null) items.push(`flow:${f.label}`);
      if (s.exchangeRateToBase === null) items.push('exchangeRate');
      return { scenario: s.name, items };
    })
    .filter((m) => m.items.length > 0);
}
