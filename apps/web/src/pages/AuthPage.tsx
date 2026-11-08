import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { SessionDTO } from '@whatif/shared';
import { ApiError, get, post } from '../api/client';
import { useSession } from '../lib/session';
import { Button, Callout, Field, Input } from '../components/ui';
import { BrandMark } from '../layout/AppShell';

export function AuthPage({ mode }: { mode: 'signin' | 'register' }) {
  const { setSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ registrationOpen: boolean; hasUsers: boolean } | null>(null);

  useEffect(() => {
    get<{ registrationOpen: boolean; hasUsers: boolean }>('/auth/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    document.title = mode === 'signin' ? 'Sign in · What-If' : 'Create account · What-If';
  }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const s = await post<SessionDTO>(mode === 'signin' ? '/auth/login' : '/auth/register', mode === 'signin' ? { email, password } : { email, password, name });
      setSession(s);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fieldErrors);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const firstRun = status && !status.hasUsers;
  const closed = mode === 'register' && status && !status.registrationOpen;

  return (
    <div className="auth">
      <div className="auth-form-col">
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="brand" style={{ marginBottom: 'var(--s-6)' }}>
            <BrandMark />
            <span>What-If</span>
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 'var(--text-xl)' }}>
              {mode === 'signin' ? 'Welcome back' : firstRun ? 'Set up your instance' : 'Create your account'}
            </h1>
            <p className="page-subtitle" style={{ fontSize: 'var(--text-sm)' }}>
              {mode === 'signin'
                ? 'Sign in to continue planning.'
                : firstRun
                  ? 'The first account becomes the administrator of this What-If instance.'
                  : 'Your decisions and numbers stay on this server.'}
            </p>
          </div>
          {firstRun && mode === 'signin' && (
            <Callout>
              No accounts exist yet. <Link to="/register">Create the administrator account</Link> to get started.
            </Callout>
          )}
          {closed ? (
            <Callout tone="warn">Registration is closed on this instance. Ask the administrator to create an account for you.</Callout>
          ) : (
            <>
              {mode === 'register' && (
                <Field label="Name" htmlFor="name" error={fields.name}>
                  <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
              )}
              <Field label="Email" htmlFor="email" error={fields.email}>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Password" htmlFor="password" error={fields.password} hint={mode === 'register' ? 'At least 10 characters. A short sentence works well.' : undefined}>
                <Input id="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              {error && !Object.keys(fields).length && (
                <div className="field-error" role="alert">
                  {error}
                </div>
              )}
              <Button type="submit" variant="primary" size="lg" block loading={busy}>
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </Button>
            </>
          )}
          <p className="faint" style={{ fontSize: 'var(--text-sm)' }}>
            {mode === 'signin' ? (
              status?.registrationOpen !== false && (
                <>
                  New here? <Link to="/register">Create an account</Link>
                </>
              )
            ) : (
              <>
                Already have an account? <Link to="/signin">Sign in</Link>
              </>
            )}
          </p>
        </form>
      </div>
      <aside className="auth-aside" aria-hidden>
        <div className="eyebrow">Decision planning</div>
        <div>
          <p className="auth-quote">Explore the consequences of your decisions before you make them.</p>
          <p className="muted" style={{ marginTop: 'var(--s-5)', maxWidth: '44ch' }}>
            Model alternative futures with explicit assumptions, compare them side by side, and keep a record of what you expected — and what actually happened.
          </p>
        </div>
        <AuthIllustration />
      </aside>
    </div>
  );
}

/** A quiet, schematic illustration of diverging paths — decorative only. */
function AuthIllustration() {
  return (
    <svg viewBox="0 0 480 160" width="100%" style={{ maxWidth: 520 }}>
      <line x1="0" y1="120" x2="480" y2="120" stroke="var(--chart-grid)" />
      <line x1="0" y1="80" x2="480" y2="80" stroke="var(--chart-grid)" />
      <line x1="0" y1="40" x2="480" y2="40" stroke="var(--chart-grid)" />
      <path d="M20 112 C120 108 160 104 200 100" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" />
      <path d="M200 100 C280 96 360 84 460 74" fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinecap="round" />
      <path d="M200 100 C260 108 300 92 340 64 C380 40 420 30 460 22" fill="none" stroke="var(--series-2)" strokeWidth="2" strokeLinecap="round" />
      <path d="M200 100 C260 104 340 108 460 104" fill="none" stroke="var(--series-3)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="200" cy="100" r="5" fill="var(--text)" stroke="var(--surface)" strokeWidth="2" />
      <circle cx="460" cy="74" r="4" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
      <circle cx="460" cy="22" r="4" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />
      <circle cx="460" cy="104" r="4" fill="var(--series-3)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
