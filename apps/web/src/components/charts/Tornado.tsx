import { useState } from 'react';
import type { SensitivityItem } from '@whatif/engine';
import { linear, niceTicks, useWidth } from './scale';

/**
 * One-at-a-time sensitivity: each bar spans the final outcome when one input
 * moves from its low to its high value. The vertical rule is the expected case.
 */
export function Tornado({
  items,
  base,
  format,
  formatInput,
}: {
  items: SensitivityItem[];
  base: number;
  format: (v: number) => string;
  formatInput: (item: SensitivityItem, v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const rowH = 30;
  const labelW = width < 520 ? 120 : 200;
  const pad = { left: labelW, right: 24, top: 8, bottom: 24 };
  const innerW = Math.max(40, width - pad.left - pad.right);
  const h = items.length * rowH + pad.top + pad.bottom;
  const lo = Math.min(base, ...items.map((i) => Math.min(i.atLow, i.atHigh)));
  const hi = Math.max(base, ...items.map((i) => Math.max(i.atLow, i.atHigh)));
  const nt = niceTicks(lo, hi, 4);
  const x = linear([nt.min, nt.max], [pad.left, pad.left + innerW]);

  return (
    <div className="chart" ref={ref}>
      <ul className="chart-legend">
        <li>
          <span className="swatch-band" style={{ background: 'var(--series-8)', opacity: 0.8 }} /> Outcome falls
        </li>
        <li>
          <span className="swatch-band" style={{ background: 'var(--series-1)', opacity: 0.8 }} /> Outcome rises
        </li>
        <li>
          <span className="swatch-line" style={{ background: 'var(--text)' }} /> Expected case
        </li>
      </ul>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label="Sensitivity of final net worth to each input">
          {nt.ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={pad.top} y2={h - pad.bottom} stroke="var(--chart-grid)" shapeRendering="crispEdges" />
              <text x={x(t)} y={h - 6} textAnchor="middle" className="chart-tick">
                {format(t)}
              </text>
            </g>
          ))}
          {items.map((it, i) => {
            const yTop = pad.top + i * rowH + 7;
            const barH = 16;
            const left = Math.min(it.atLow, it.atHigh);
            const right = Math.max(it.atLow, it.atHigh);
            const active = hover === it.key;
            return (
              <g key={it.key} onPointerEnter={() => setHover(it.key)} onPointerLeave={() => setHover(null)}>
                <rect x={0} y={yTop - 7} width={width} height={rowH} fill={active ? 'var(--hover)' : 'transparent'} />
                <text x={labelW - 12} y={yTop + barH / 2} dy="0.32em" textAnchor="end" className="chart-row-label">
                  {it.label.length > (labelW < 150 ? 16 : 28) ? `${it.label.slice(0, labelW < 150 ? 15 : 27)}…` : it.label}
                </text>
                {left < base && <rect x={x(left)} y={yTop} width={Math.max(1, x(Math.min(base, right)) - x(left))} height={barH} rx={3} fill="var(--series-8)" opacity={0.85} />}
                {right > base && <rect x={x(Math.max(base, left))} y={yTop} width={Math.max(1, x(right) - x(Math.max(base, left)))} height={barH} rx={3} fill="var(--series-1)" opacity={0.85} />}
              </g>
            );
          })}
          <line x1={x(base)} x2={x(base)} y1={pad.top} y2={h - pad.bottom} stroke="var(--text)" strokeWidth={1.5} />
        </svg>
      )}
      {hover && (() => {
        const it = items.find((i) => i.key === hover)!;
        const idx = items.indexOf(it);
        return (
          <div className="chart-tooltip" style={{ left: pad.left + 8, top: 34 + pad.top + (idx + 1) * rowH }}>
            <div className="chart-tooltip-title">{it.label}</div>
            <div className="chart-tooltip-row">
              <span className="label">At {formatInput(it, it.lowInput)}</span>
              <span className="value num">{format(it.atLow)}</span>
            </div>
            <div className="chart-tooltip-row">
              <span className="label">At {formatInput(it, it.highInput)}</span>
              <span className="value num">{format(it.atHigh)}</span>
            </div>
            <div className="chart-tooltip-row faint">
              <span className="label">{it.basis === 'range' ? 'Your range' : 'Standard ± spread (no range set)'}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
