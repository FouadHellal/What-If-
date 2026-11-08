import { useMemo, useState, type ReactNode } from 'react';
import { linear, niceTicks, useWidth } from './scale';

export interface LinePoint {
  x: number;
  y: number | null;
}
export interface LineSeries {
  id: string;
  label: string;
  color: string;
  points: LinePoint[];
  dashed?: boolean;
  /** Thin, recessive line (e.g. best/worst case). */
  faint?: boolean;
  hideLabel?: boolean;
}
export interface Band {
  id: string;
  color: string;
  label: string;
  points: { x: number; lo: number; hi: number }[];
  opacity?: number;
}
export interface Marker {
  x: number;
  label: string;
}

interface Props {
  series: LineSeries[];
  bands?: Band[];
  markers?: Marker[];
  height?: number;
  xFormat: (x: number) => string;
  xTickFormat?: (x: number) => string;
  yFormat: (v: number) => string;
  yTickFormat?: (v: number) => string;
  ariaLabel: string;
  legend?: boolean;
  /** Content rendered under the series values in the tooltip. */
  tooltipExtra?: (x: number) => ReactNode;
}

const PAD = { top: 12, right: 16, bottom: 28, left: 56 };

export function LineChart({ series, bands = [], markers = [], height = 280, xFormat, xTickFormat, yFormat, yTickFormat, ariaLabel, legend = true, tooltipExtra }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const xs = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) for (const p of s.points) set.add(p.x);
    for (const b of bands) for (const p of b.points) set.add(p.x);
    return [...set].sort((a, b) => a - b);
  }, [series, bands]);

  const labelSpace = series.filter((s) => !s.faint && !s.hideLabel).length > 0 && series.length <= 4 && width > 560 ? 132 : 0;
  const innerW = Math.max(10, width - PAD.left - PAD.right - labelSpace);
  const innerH = height - PAD.top - PAD.bottom;

  const { x, y, yTicks, xTicks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const p of s.points) if (p.y !== null && Number.isFinite(p.y)) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    for (const b of bands) for (const p of b.points) {
      lo = Math.min(lo, p.lo);
      hi = Math.max(hi, p.hi);
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (lo > 0 && lo < hi * 0.35) lo = 0;
    const nt = niceTicks(Math.min(lo, hi), Math.max(lo, hi), height < 200 ? 3 : 5);
    const x0 = xs[0] ?? 0;
    const x1 = xs[xs.length - 1] ?? 1;
    const xScale = linear([x0, x1 === x0 ? x0 + 1 : x1], [PAD.left, PAD.left + innerW]);
    const yScale = linear([nt.min, nt.max], [PAD.top + innerH, PAD.top]);
    // ~1 x tick per 90px
    const maxTicks = Math.max(2, Math.floor(innerW / 90));
    const stepIdx = Math.max(1, Math.ceil(xs.length / maxTicks));
    const xt = xs.filter((_, i) => i % stepIdx === 0);
    return { x: xScale, y: yScale, yTicks: nt.ticks, xTicks: xt };
  }, [series, bands, xs, innerW, innerH, height]);

  const path = (pts: LinePoint[]) => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (p.y === null || !Number.isFinite(p.y)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const bandPath = (b: Band) => {
    if (b.points.length === 0) return '';
    const top = b.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.hi).toFixed(1)}`).join('');
    const bottom = [...b.points].reverse().map((p) => `L${x(p.x).toFixed(1)},${y(p.lo).toFixed(1)}`).join('');
    return `${top}${bottom}Z`;
  };

  // Direct end labels, skipped when they would collide.
  const endLabels = useMemo(() => {
    if (!labelSpace) return [];
    const items = series
      .filter((s) => !s.faint && !s.hideLabel)
      .map((s) => {
        const last = [...s.points].reverse().find((p) => p.y !== null);
        return last ? { id: s.id, label: s.label, color: s.color, x: x(last.x), y: y(last.y!) } : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.y - b.y);
    const placed: typeof items = [];
    for (const it of items) if (!placed.some((p) => Math.abs(p.y - it.y) < 14)) placed.push(it);
    return placed;
  }, [series, x, y, labelSpace]);

  const hoverX = hover !== null ? xs[hover] : undefined;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const target = x.invert(px);
    let best = 0;
    let dist = Infinity;
    xs.forEach((v, i) => {
      const d = Math.abs(v - target);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const tooltipLeft = hoverX !== undefined ? x(hoverX) : 0;
  const flip = tooltipLeft > width * 0.6;

  return (
    <div className="chart" ref={ref}>
      {legend && series.filter((s) => !s.faint).length + bands.length > 1 && (
        <ul className="chart-legend" aria-label="Legend">
          {series
            .filter((s) => !s.faint)
            .map((s) => (
              <li key={s.id}>
                <span className="swatch-line" style={{ background: s.color, ...(s.dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)`, background: 'none' } : {}) }} />
                {s.label}
              </li>
            ))}
          {bands.map((b) => (
            <li key={b.id}>
              <span className="swatch-band" style={{ background: b.color }} />
              {b.label}
            </li>
          ))}
        </ul>
      )}
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          {/* grid */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                {(yTickFormat ?? yFormat)(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="chart-tick">
              {(xTickFormat ?? xFormat)(t)}
            </text>
          ))}
          {/* markers (milestones) */}
          {markers.map((m, i) => (
            <g key={`${m.x}-${i}`}>
              <line x1={x(m.x)} x2={x(m.x)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="2 3" />
            </g>
          ))}
          {/* bands */}
          {bands.map((b) => (
            <path key={b.id} d={bandPath(b)} fill={b.color} opacity={b.opacity ?? 0.12} />
          ))}
          {/* lines */}
          {series.map((s) => (
            <path
              key={s.id}
              d={path(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.faint ? 1.25 : 2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={s.faint ? 0.7 : 1}
            />
          ))}
          {/* end labels */}
          {endLabels.map((l) => (
            <g key={l.id}>
              <circle cx={l.x} cy={l.y} r={4} fill={l.color} stroke="var(--chart-surface)" strokeWidth={2} />
              <text x={l.x + 10} y={l.y} dy="0.32em" className="chart-end-label">
                {l.label.length > 18 ? `${l.label.slice(0, 17)}…` : l.label}
              </text>
            </g>
          ))}
          {/* hover */}
          {hoverX !== undefined && (
            <g pointerEvents="none">
              <line x1={x(hoverX)} x2={x(hoverX)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--text-3)" strokeWidth={1} />
              {series.map((s) => {
                const p = s.points.find((pt) => pt.x === hoverX);
                if (!p || p.y === null) return null;
                return <circle key={s.id} cx={x(hoverX)} cy={y(p.y)} r={s.faint ? 3 : 4.5} fill={s.color} stroke="var(--chart-surface)" strokeWidth={2} />;
              })}
            </g>
          )}
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} style={{ touchAction: 'pan-y' }} />
        </svg>
      )}
      {hoverX !== undefined && (
        <div className="chart-tooltip" style={{ left: flip ? undefined : tooltipLeft + 12, right: flip ? width - tooltipLeft + 12 : undefined, top: PAD.top + (legend ? 30 : 0) }}>
          <div className="chart-tooltip-title">{xFormat(hoverX)}</div>
          {series.map((s) => {
            const p = s.points.find((pt) => pt.x === hoverX);
            if (!p || p.y === null) return null;
            return (
              <div key={s.id} className={`chart-tooltip-row ${s.faint ? 'faint' : ''}`}>
                <span className="swatch-line" style={{ background: s.color }} />
                <span className="label">{s.label}</span>
                <span className="value num">{yFormat(p.y)}</span>
              </div>
            );
          })}
          {bands.map((b) => {
            const p = b.points.find((pt) => pt.x === hoverX);
            if (!p) return null;
            return (
              <div key={b.id} className="chart-tooltip-row faint">
                <span className="swatch-band" style={{ background: b.color }} />
                <span className="label">{b.label}</span>
                <span className="value num">
                  {yFormat(p.lo)} – {yFormat(p.hi)}
                </span>
              </div>
            );
          })}
          {tooltipExtra?.(hoverX)}
        </div>
      )}
    </div>
  );
}
