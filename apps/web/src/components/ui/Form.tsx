import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CircleHelp } from 'lucide-react';
import { getNumberLocale, parseNumberInput } from '../../lib/format';

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  htmlFor,
  help,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
  htmlFor?: string;
  help?: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="optional">Optional</span>}
        {help && <Help text={help} />}
      </label>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Help({ text }: { text: string }) {
  return (
    <span className="tip" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
      <button type="button" className="help-icon" aria-label={text}>
        <CircleHelp aria-hidden />
      </button>
      <span className="tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className ?? ''}`} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className ?? ''}`} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${className ?? ''}`} {...props}>
      {children}
    </select>
  );
}

function formatForDisplay(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return '';
  return new Intl.NumberFormat(getNumberLocale(), { maximumFractionDigits: digits }).format(v);
}

/**
 * Numeric input that shows grouped digits when idle, accepts "2.5k", "12 000",
 * and reports `null` when cleared. Commits on blur and on Enter; also on change
 * when the typed value parses cleanly, so projections update while typing.
 */
export function NumberInput({
  value,
  onChange,
  suffix,
  digits = 2,
  min,
  max,
  placeholder,
  id,
  size,
  ariaLabel,
  invalid,
  disabled,
  className,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  suffix?: string;
  digits?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  id?: string;
  size?: 'sm';
  ariaLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatForDisplay(value ?? null, digits));
  const [error, setError] = useState(false);
  const last = useRef(value);

  useEffect(() => {
    if (!focused && value !== last.current) setText(formatForDisplay(value ?? null, digits));
    last.current = value;
  }, [value, focused, digits]);

  useEffect(() => {
    if (!focused) setText(formatForDisplay(value ?? null, digits));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const commit = (raw: string, final: boolean) => {
    const n = parseNumberInput(raw);
    if (n === null) {
      setError(false);
      if (value !== null) onChange(null);
      return;
    }
    if (Number.isNaN(n)) {
      setError(final);
      return;
    }
    let v = n;
    if (min !== undefined && v < min) v = final ? min : v;
    if (max !== undefined && v > max) v = final ? max : v;
    setError(false);
    if (v !== value) {
      last.current = v;
      onChange(v);
    }
  };

  return (
    <div className={`input-affix ${className ?? ''}`}>
      <input
        id={id}
        className={`input num ${size === 'sm' ? 'input-sm' : ''}`}
        inputMode="decimal"
        value={text}
        placeholder={placeholder ?? 'Not set'}
        aria-label={ariaLabel}
        aria-invalid={error || invalid || undefined}
        disabled={disabled}
        style={{ paddingRight: suffix ? 22 + suffix.length * 6.6 : 10 }}
        onFocus={(e) => {
          setFocused(true);
          setText(value === null || value === undefined ? '' : String(value));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value, false);
        }}
        onBlur={(e) => {
          commit(e.target.value, true);
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden />
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useFieldId(prefix = 'f') {
  const id = useId();
  return `${prefix}${id.replace(/:/g, '')}`;
}
