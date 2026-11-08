import PDFDocument from 'pdfkit';
import type { ReportSnapshot } from '@whatif/shared';
import { SOURCE_LABELS, categoryInfo } from '@whatif/shared';

/** Scenario colours — kept in sync with the web palette (apps/web/src/styles/tokens.css). */
export const SCENARIO_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const INK = '#1C1B19';
const MUTED = '#6B6863';
const RULE = '#E2DFD8';
const ACCENT = '#2F4B6E';

const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Standard PDF fonts only cover Windows-1252; replace anything else so text never renders as garbage. */
function clean(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[−‒]/g, '-')
    .replace(/[→⇒]/g, '->')
    .replace(/≈/g, '~')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/ | | /g, ' ')
    .replace(/./gu, (ch) => {
      const c = ch.codePointAt(0)!;
      if (c < 0x80 || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) return ch;
      return '?';
    });
}

function money(v: number | null | undefined, currency: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(v));
  } catch {
    return `${Math.round(v).toLocaleString('en-US')} ${currency}`;
  }
}

function compact(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch {
    return `${Math.round(v)}`;
  }
}

function fmtMetric(v: number | null, unit: string, currency: string): string {
  if (v === null || v === undefined) return '—';
  switch (unit) {
    case 'currency':
    case 'currency_month':
      return money(v, currency) + (unit === 'currency_month' ? '/mo' : '');
    case 'percent':
      return `${Math.round(v * 100)} %`;
    case 'hours_week':
      return `${v.toFixed(0)} h/wk`;
    default:
      return String(Math.round(v));
  }
}

function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

function varValue(v: { value: number | null; unit: string }, currency: string): string {
  if (v.value === null) return 'Not set';
  switch (v.unit) {
    case 'currency':
      return money(v.value, currency);
    case 'currency_month':
      return `${money(v.value, currency)}/mo`;
    case 'currency_year':
      return `${money(v.value, currency)}/yr`;
    case 'percent':
    case 'percent_year':
      return `${v.value} %`;
    case 'months':
      return `${v.value} mo`;
    case 'years':
      return `${v.value} yr`;
    case 'hours_week':
      return `${v.value} h/wk`;
    default:
      return String(v.value);
  }
}

export function renderReportPdf(snapshot: ReportSnapshot, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 56, right: 56 }, info: { Title: clean(title), Creator: 'What-If', Producer: 'What-If' }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const L = doc.page.margins.left;
    const base = snapshot.decision.baseCurrency;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    let section = 0;
    const heading = (text: string) => {
      ensure(60);
      section += 1;
      doc.moveDown(1.2);
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(String(section).padStart(2, '0'), L, doc.y, { characterSpacing: 1 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(clean(text));
      const y = doc.y + 4;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.y = y + 10;
    };
    const para = (text: string, opts: { color?: string; size?: number } = {}) => {
      doc.font('Helvetica').fontSize(opts.size ?? 9.5).fillColor(opts.color ?? INK).text(clean(text), L, doc.y, { width: W, lineGap: 2 });
    };
    const label = (text: string) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(clean(text).toUpperCase(), L, doc.y, { characterSpacing: 0.6 });
      doc.moveDown(0.2);
    };

    /** Simple table with wrapping first column. */
    const table = (cols: { header: string; width: number; align?: 'left' | 'right' }[], rows: string[][], opts: { highlight?: (r: number, c: number) => boolean } = {}) => {
      const pad = 4;
      const drawHeader = () => {
        let x = L;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
        const y = doc.y;
        for (const c of cols) {
          doc.text(clean(c.header).toUpperCase(), x + pad, y, { width: c.width - pad * 2, align: c.align ?? 'left', characterSpacing: 0.4 });
          x += c.width;
        }
        doc.y = y + 14;
        doc.moveTo(L, doc.y - 3).lineTo(L + W, doc.y - 3).lineWidth(0.5).strokeColor(RULE).stroke();
      };
      ensure(40);
      drawHeader();
      rows.forEach((row, ri) => {
        doc.font('Helvetica').fontSize(8.5);
        const heights = row.map((cell, ci) => doc.heightOfString(clean(cell), { width: cols[ci]!.width - pad * 2 }));
        const h = Math.max(...heights) + 6;
        if (doc.y + h > bottom()) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        let x = L;
        row.forEach((cell, ci) => {
          const col = cols[ci]!;
          const hl = opts.highlight?.(ri, ci);
          doc.font(hl ? 'Helvetica-Bold' : ci === 0 ? 'Helvetica' : 'Helvetica').fontSize(8.5).fillColor(ci === 0 ? INK : hl ? ACCENT : INK);
          doc.text(clean(cell), x + pad, y + 3, { width: col.width - pad * 2, align: col.align ?? 'left' });
          x += col.width;
        });
        doc.y = y + h;
        doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.3).strokeColor(RULE).stroke();
      });
      doc.moveDown(0.6);
    };

    // ── Cover ───────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT).text('WHAT-IF  ·  DECISION REPORT', L, doc.y, { characterSpacing: 1.2 });
    doc.moveDown(1.2);
    doc.font('Times-Roman').fontSize(24).fillColor(INK).text(clean(snapshot.decision.title), { width: W, lineGap: 2 });
    doc.moveDown(0.6);
    para(
      `${categoryInfo(snapshot.decision.category).label} · ${snapshot.scenarios.length} scenarios · ${snapshot.decision.horizonYears}-year horizon · amounts in ${base} · generated ${new Date(snapshot.generatedAt).toISOString().slice(0, 10)}`,
      { color: MUTED, size: 9 },
    );
    doc.moveDown(0.8);
    para(
      'Projections in this report were calculated by a deterministic engine from the assumptions listed. They are estimates for exploring trade-offs, not predictions or financial advice.',
      { color: MUTED, size: 8.5 },
    );

    // 1. Overview
    heading('Decision overview');
    if (snapshot.decision.question) para(snapshot.decision.question);
    if (snapshot.decision.description) {
      doc.moveDown(0.4);
      para(snapshot.decision.description, { color: MUTED });
    }

    // 2. Baseline
    heading('Current baseline');
    const b = snapshot.baseline;
    if (!b) para('No baseline profile was included.', { color: MUTED });
    else {
      const cur = b.currency ?? base;
      const rows: string[][] = [];
      const place = [b.city, b.country].filter(Boolean).join(', ');
      if (place) rows.push(['Location', place]);
      if (b.occupation) rows.push(['Occupation', b.occupation]);
      if (b.annualIncome != null) rows.push(['Gross annual income', money(b.annualIncome, cur)]);
      if (b.monthlyHousingCost != null) rows.push(['Housing cost', `${money(b.monthlyHousingCost, cur)}/mo`]);
      if (b.monthlyLivingCost != null) rows.push(['Other living costs', `${money(b.monthlyLivingCost, cur)}/mo`]);
      if (b.savings != null) rows.push(['Savings', money(b.savings, cur)]);
      if (b.riskTolerance) rows.push(['Risk tolerance', b.riskTolerance]);
      if (b.goals?.length) rows.push(['Goals', b.goals.join('; ')]);
      if (rows.length) table([{ header: 'Item', width: W * 0.35 }, { header: 'Value', width: W * 0.65 }], rows);
      else para('The baseline profile is empty.', { color: MUTED });
    }

    // 3. Scenarios
    heading('Compared scenarios');
    snapshot.scenarios.forEach((s, i) => {
      ensure(40);
      const y = doc.y;
      doc.rect(L, y + 2, 6, 6).fill(SCENARIO_COLORS[i % SCENARIO_COLORS.length]!);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(`${s.name}${s.isBaseline ? '  (baseline)' : ''}`), L + 14, y, { width: W - 14 });
      if (s.description) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(s.description), L + 14, doc.y, { width: W - 14 });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(clean(`Currency ${s.currency}${s.currency !== base ? ` · 1 ${s.currency} = ${s.exchangeRateToBase ?? '?'} ${base}` : ''} · input version ${s.version} · run ${s.runId.slice(0, 8)} · hash ${s.inputHash}`), L + 14, doc.y, { width: W - 14 });
      doc.moveDown(0.6);
    });

    // 4. Assumptions
    heading('Key assumptions');
    snapshot.scenarios.forEach((s) => {
      ensure(60);
      label(s.name);
      table(
        [
          { header: 'Assumption', width: W * 0.36 },
          { header: 'Value', width: W * 0.2, align: 'right' },
          { header: 'Range', width: W * 0.24, align: 'right' },
          { header: 'Source', width: W * 0.2 },
        ],
        s.variables
          .filter((v) => v.value !== null || v.source === 'user')
          .map((v) => [
            v.label,
            varValue(v, s.currency),
            v.low !== null || v.high !== null ? `${varValue({ value: v.low ?? v.value, unit: v.unit }, s.currency)} – ${varValue({ value: v.high ?? v.value, unit: v.unit }, s.currency)}` : '',
            SOURCE_LABELS[v.source].label,
          ])
          .concat(s.flows.map((f) => [f.label, f.amount === null ? 'Not set' : f.kind === 'time' ? `${f.amount} h/wk` : money(f.amount, s.currency) + (f.kind.startsWith('one_time') ? '' : '/mo'), `from month ${f.startMonth}${f.endMonth ? ` to ${f.endMonth}` : ''}`, SOURCE_LABELS[f.source].label])),
      );
      const qual = snapshot.assumptions.filter((a) => a.scenarioId === s.id && a.category === 'assumption');
      for (const a of qual) para(`· ${a.text}`, { size: 8.5, color: MUTED });
    });

    // 5. Financial projections
    heading('Financial projections');
    para(`Expected-case net worth over time, converted to ${base}.`, { color: MUTED, size: 8.5 });
    doc.moveDown(0.4);
    ensure(200);
    drawChart(doc, snapshot, L, doc.y, W, 170);
    doc.y += 186;
    const maxYears = Math.max(...snapshot.scenarios.map((s) => s.yearly.length));
    const step = maxYears > 12 ? Math.ceil(maxYears / 10) : 1;
    const yearIdx = Array.from({ length: maxYears }, (_, i) => i).filter((i) => i % step === step - 1 || i === maxYears - 1);
    const colW = (W * 0.78) / Math.max(1, snapshot.scenarios.length);
    table(
      [{ header: 'Year end', width: W * 0.22 }, ...snapshot.scenarios.map((s) => ({ header: s.name.slice(0, 22), width: colW, align: 'right' as const }))],
      yearIdx.map((i) => [
        snapshot.scenarios.find((s) => s.yearly[i])?.yearly[i]?.label ?? `Year ${i + 1}`,
        ...snapshot.scenarios.map((s) => {
          const y = s.yearly[i];
          return y ? money(y.netWorth * (s.currency === base ? 1 : (s.exchangeRateToBase ?? 1)), base) : '—';
        }),
      ]),
    );

    // 6. Timeline
    heading('Timeline');
    const events = [
      ...snapshot.milestones.map((m) => ({ date: m.date, title: m.title, who: snapshot.scenarios.find((s) => s.id === m.scenarioId)?.name ?? 'All scenarios', detail: m.description ?? '' })),
      ...snapshot.scenarios.flatMap((s) => s.milestones.filter((m) => m.kind !== 'start' && m.kind !== 'end').map((m) => ({ date: m.date, title: m.title, who: s.name, detail: m.detail }))),
    ].sort((a, b) => a.date.localeCompare(b.date));
    if (events.length === 0) para('No milestones.', { color: MUTED });
    else table([{ header: 'When', width: W * 0.15 }, { header: 'Milestone', width: W * 0.3 }, { header: 'Scenario', width: W * 0.2 }, { header: 'Detail', width: W * 0.35 }], events.slice(0, 40).map((e) => [monthLabel(e.date), e.title, e.who, e.detail]));

    // 7 & 8. Risks / opportunities
    const insightSection = (kind: 'risk' | 'opportunity', title: string) => {
      heading(title);
      let any = false;
      snapshot.scenarios.forEach((s) => {
        const items = s.insights.filter((i) => i.kind === kind);
        const user = snapshot.assumptions.filter((a) => a.scenarioId === s.id && a.category === kind);
        if (!items.length && !user.length) return;
        any = true;
        ensure(40);
        label(s.name);
        for (const i of items) {
          ensure(30);
          doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(clean(`${i.title}`), L, doc.y, { width: W, continued: false });
          para(`${i.detail}  [${i.severity}, calculated]`, { size: 8.5, color: MUTED });
          doc.moveDown(0.3);
        }
        for (const a of user) {
          para(`· ${a.text}${a.likelihood ? `  [likelihood ${a.likelihood}, impact ${a.impact ?? '?'}]` : ''}  (${SOURCE_LABELS[a.source].label})`, { size: 8.5 });
          doc.moveDown(0.2);
        }
        doc.moveDown(0.3);
      });
      if (!any) para(`No ${kind === 'risk' ? 'risks' : 'opportunities'} were identified.`, { color: MUTED });
    };
    insightSection('risk', 'Risks');
    insightSection('opportunity', 'Opportunities');

    // 9. Sensitivity
    heading('Sensitivity analysis');
    para('How much final net worth changes when one input moves across its range while all others stay at their expected values.', { color: MUTED, size: 8.5 });
    doc.moveDown(0.3);
    snapshot.scenarios.forEach((s) => {
      if (!s.sensitivity.length) return;
      ensure(60);
      label(s.name);
      table(
        [{ header: 'Input', width: W * 0.34 }, { header: 'At low', width: W * 0.22, align: 'right' }, { header: 'At high', width: W * 0.22, align: 'right' }, { header: 'Swing', width: W * 0.22, align: 'right' }],
        s.sensitivity.slice(0, 6).map((x) => [`${x.label}${x.basis === 'default' ? ' (±std.)' : ''}`, money(x.atLow, s.currency), money(x.atHigh, s.currency), money(x.swing, s.currency)]),
      );
    });

    // 10. Trade-offs
    heading('Main trade-offs');
    const sc = snapshot.scenarios;
    const cw = (W * 0.64) / Math.max(1, sc.length);
    table(
      [{ header: 'Measure', width: W * 0.36 }, ...sc.map((s) => ({ header: s.name.slice(0, 20), width: cw, align: 'right' as const }))],
      snapshot.comparison.map((row) => [row.label, ...sc.map((s) => fmtMetric(row.values[s.id] ?? null, row.unit, base))]),
      { highlight: (r, c) => c > 0 && snapshot.comparison[r]!.leader === sc[c - 1]?.id },
    );
    if (sc.some((s) => s.fit !== null)) {
      para(`Fit with stated priorities: ${sc.map((s) => `${s.name} ${s.fit ?? '—'}/100`).join(' · ')}`, { size: 8.5 });
    }
    if (snapshot.aiSummary) {
      doc.moveDown(0.6);
      label(`AI analyst summary (${snapshot.aiSummary.provider} · ${snapshot.aiSummary.model})`);
      para(snapshot.aiSummary.output.summary);
      for (const p of snapshot.aiSummary.output.points) {
        doc.moveDown(0.3);
        ensure(30);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(clean(p.title), L, doc.y, { width: W });
        para(p.detail, { size: 8.5, color: MUTED });
      }
      if (snapshot.aiSummary.unverifiedNumbers.length) {
        doc.moveDown(0.3);
        para(`Numbers not found in the simulation results: ${snapshot.aiSummary.unverifiedNumbers.join(', ')}`, { size: 8, color: '#A6505F' });
      }
    }

    // 11. Uncertainties
    heading('Uncertainties');
    snapshot.scenarios.forEach((s) => {
      ensure(40);
      label(s.name);
      const u = s.uncertainty;
      if (u?.hasUncertainty) {
        para(`Across ${u.runs} simulated variations of the ranged assumptions (seed ${u.seed}): 80 % of outcomes end between ${money(u.finalNetWorth.p10, s.currency)} and ${money(u.finalNetWorth.p90, s.currency)} (median ${money(u.finalNetWorth.p50, s.currency)}). Chance of a cash shortfall at some point: ${Math.round(u.shortfallProbability * 100)} %.`, { size: 8.5 });
      } else para('No ranges were given, so no uncertainty band was calculated.', { size: 8.5, color: MUTED });
      para(`Best case ${money(s.best, s.currency)} · worst case ${money(s.worst, s.currency)}.`, { size: 8.5 });
      const missing = s.warnings.filter((w) => w.code === 'missing_value');
      if (missing.length) para(`Missing inputs: ${missing.map((m) => m.message).join(' ')}`, { size: 8.5, color: '#A6505F' });
      const q = snapshot.assumptions.filter((a) => a.scenarioId === s.id && a.category === 'question');
      for (const a of q) para(`Open question: ${a.text}`, { size: 8.5 });
      doc.moveDown(0.4);
    });

    // 12. Decision
    heading('Final decision');
    const chosen = snapshot.scenarios.find((s) => s.id === snapshot.decision.chosenScenarioId);
    if (chosen) {
      para(`Chosen: ${chosen.name}${snapshot.decision.decidedAt ? ` (decided ${snapshot.decision.decidedAt.slice(0, 10)})` : ''}`);
      if (snapshot.decision.rationale) {
        doc.moveDown(0.4);
        label('Why');
        para(snapshot.decision.rationale);
      }
      if (snapshot.decision.expectations) {
        doc.moveDown(0.4);
        label('Expectations');
        para(snapshot.decision.expectations);
      }
    } else para('No decision has been recorded yet.', { color: MUTED });

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 40;
      doc.font('Helvetica').fontSize(7).fillColor(MUTED);
      doc.text(clean(`${snapshot.decision.title.slice(0, 90)}`), L, y, { width: W * 0.75, lineBreak: false });
      doc.text(`${i + 1} / ${range.count}`, L + W * 0.75, y, { width: W * 0.25, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

function drawChart(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot, x: number, y: number, w: number, h: number) {
  const base = snapshot.decision.baseCurrency;
  const series = snapshot.scenarios.map((s) => {
    const fx = s.currency === base ? 1 : (s.exchangeRateToBase ?? 1);
    return [s.summary.startingNetWorth * fx, ...s.yearly.map((p) => p.netWorth * fx)];
  });
  const all = series.flat().filter(Number.isFinite);
  if (all.length === 0) return;
  let min = Math.min(0, ...all);
  let max = Math.max(...all);
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.06;
  min -= min < 0 ? pad : 0;
  max += pad;
  const n = Math.max(...series.map((s) => s.length));
  const left = x + 52;
  const plotW = w - 52;
  const sx = (i: number) => left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const sy = (v: number) => y + h - ((v - min) / (max - min)) * h;
  // grid
  doc.font('Helvetica').fontSize(7).fillColor(MUTED);
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    const yy = sy(v);
    doc.moveTo(left, yy).lineTo(left + plotW, yy).lineWidth(0.3).strokeColor(RULE).stroke();
    doc.text(compact(v, base), x, yy - 4, { width: 48, align: 'right', lineBreak: false });
  }
  if (min < 0 && max > 0) doc.moveTo(left, sy(0)).lineTo(left + plotW, sy(0)).lineWidth(0.6).strokeColor('#B9B5AC').stroke();
  // lines
  series.forEach((s, i) => {
    const color = SCENARIO_COLORS[i % SCENARIO_COLORS.length]!;
    s.forEach((v, j) => {
      if (j === 0) doc.moveTo(sx(j), sy(v));
      else doc.lineTo(sx(j), sy(v));
    });
    doc.lineWidth(1.4).strokeColor(color).stroke();
  });
  // x labels
  const first = snapshot.scenarios[0];
  if (first) {
    const startYear = Number(first.yearly[0]?.label ?? '0') - 1;
    for (let j = 0; j < n; j += Math.max(1, Math.ceil(n / 8))) {
      doc.fillColor(MUTED).text(String(startYear + j), sx(j) - 15, y + h + 4, { width: 30, align: 'center', lineBreak: false });
    }
  }
  // legend
  let lx = left;
  const ly = y - 12;
  snapshot.scenarios.forEach((s, i) => {
    doc.rect(lx, ly + 1, 8, 2).fill(SCENARIO_COLORS[i % SCENARIO_COLORS.length]!);
    doc.fillColor(INK).fontSize(7).text(clean(s.name.slice(0, 28)), lx + 11, ly - 2, { lineBreak: false });
    lx += 16 + doc.widthOfString(clean(s.name.slice(0, 28)));
  });
}
