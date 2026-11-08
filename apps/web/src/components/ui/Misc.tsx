import type { ReactNode } from 'react';
import { CircleAlert, Info, Sparkles, TriangleAlert } from 'lucide-react';
import { SOURCE_LABELS, type ValueSourceT } from '@whatif/shared';

export function Badge({ children, tone, icon, outline, title }: { children: ReactNode; tone?: 'accent' | 'good' | 'warn' | 'bad'; icon?: ReactNode; outline?: boolean; title?: string }) {
  return (
    <span className={`badge ${tone ? `badge-${tone}` : ''} ${outline ? 'badge-outline' : ''}`} title={title}>
      {icon}
      {children}
    </span>
  );
}

export function SourceTag({ source, missing }: { source: ValueSourceT; missing?: boolean }) {
  if (missing) return <span className="src src-missing">Needs input</span>;
  const s = SOURCE_LABELS[source];
  return (
    <span className={`src src-${source}`} title={s.description}>
      {s.label}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Skeleton({ height = 16, width = '100%', style }: { height?: number | string; width?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden />;
}

export function EmptyState({ icon, title, children, actions, center }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; center?: boolean }) {
  return (
    <div className={`empty ${center ? 'center' : ''}`}>
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{actions}</div>}
    </div>
  );
}

export function Callout({ tone, children, icon }: { tone?: 'warn' | 'bad' | 'ai'; children: ReactNode; icon?: ReactNode }) {
  const ic = icon ?? (tone === 'warn' ? <TriangleAlert aria-hidden /> : tone === 'bad' ? <CircleAlert aria-hidden /> : tone === 'ai' ? <Sparkles aria-hidden /> : <Info aria-hidden />);
  return (
    <div className={`callout ${tone ? `callout-${tone}` : ''}`}>
      {ic}
      <div>{children}</div>
    </div>
  );
}

export function ScenarioDot({ index, size = 8 }: { index: number; size?: number }) {
  return <span className="dot" style={{ background: `var(--series-${(index % 8) + 1})`, width: size, height: size }} aria-hidden />;
}

export function seriesColor(index: number) {
  return `var(--series-${(index % 8) + 1})`;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        <CircleAlert />
      </div>
      <h3>We couldn’t load this</h3>
      <p>{msg}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
