import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, Lock, LogOut, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { PRIORITY_FACTORS } from '@whatif/engine';
import { COUNTRIES, CURRENCIES, type AiStatusDTO, type Preferences, type ProfileDTO, type ProfileInput } from '@whatif/shared';
import { ApiError, del, download, get, post, put } from '../../api/client';
import { keys, useAiSettings, useAudit, useSessions } from '../../api/queries';
import { useSession } from '../../lib/session';
import { dateLabel, relativeTime } from '../../lib/format';
import { Badge, Button, Callout, ConfirmDialog, Dialog, Field, Input, NumberInput, Segmented, Select, Skeleton, Switch, Textarea, useToast } from '../../components/ui';
import { PriorityPips } from '../Onboarding';

const SECTIONS = [
  { id: 'profile', label: 'Baseline profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'ai', label: 'AI analyst' },
  { id: 'data', label: 'Your data' },
  { id: 'security', label: 'Security' },
  { id: 'admin', label: 'Instance', admin: true },
];

export default function Settings() {
  const { section = 'profile' } = useParams();
  const { user } = useSession();
  useEffect(() => {
    document.title = 'Settings · What-If';
  }, []);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.filter((s) => !s.admin || user?.role === 'admin').map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div>
          {section === 'profile' && <ProfileSettings />}
          {section === 'preferences' && <PreferenceSettings />}
          {section === 'ai' && <AiSettings />}
          {section === 'data' && <DataSettings />}
          {section === 'security' && <SecuritySettings />}
          {section === 'admin' && user?.role === 'admin' && <AdminSettings />}
        </div>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { profile, updateProfile } = useSession();
  const toast = useToast();
  const [p, setP] = useState<ProfileInput>(profile ?? {});
  const [goals, setGoals] = useState((profile?.goals ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setP((x) => ({ ...x, [k]: v }));
  const cur = p.currency ?? 'EUR';
  const save = async () => {
    setBusy(true);
    try {
      const { updatedAt: _u, ...rest } = p as ProfileDTO;
      const saved = await put<ProfileDTO>('/profile', { ...rest, goals: goals.split('\n').map((g) => g.trim()).filter(Boolean).slice(0, 12) });
      updateProfile(saved);
      toast('Baseline saved. New scenarios will start from these values.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-form">
      <div className="settings-group">
        <h2>Who you are</h2>
        <p>Used to pre-fill “stay as I am” scenarios. Every field is optional.</p>
        <div className="stack">
          <Field label="Display name" htmlFor="pn">
            <Input id="pn" value={p.displayName ?? ''} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label="Country" htmlFor="pc" optional>
              <Select id="pc" value={p.country ?? ''} onChange={(e) => set('country', e.target.value || null)}>
                <option value="">Not specified</option>
                {COUNTRIES.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="City" htmlFor="pcity" optional>
              <Input id="pcity" value={p.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Occupation" htmlFor="po" optional>
              <Input id="po" value={p.occupation ?? ''} onChange={(e) => set('occupation', e.target.value || null)} />
            </Field>
            <Field label="Education" htmlFor="pe" optional>
              <Input id="pe" value={p.education ?? ''} onChange={(e) => set('education', e.target.value || null)} />
            </Field>
          </div>
        </div>
      </div>
      <div className="settings-group">
        <h2>Finances</h2>
        <p>Stored only on this server. Never sent to an AI provider.</p>
        <div className="stack">
          <div className="field-row">
            <Field label="Currency" htmlFor="pcur">
              <Select id="pcur" value={cur} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Gross annual income" htmlFor="pinc" optional>
              <NumberInput id="pinc" value={p.annualIncome} onChange={(v) => set('annualIncome', v)} suffix={`${cur}/yr`} digits={0} min={0} />
            </Field>
            <Field label="Tax & social contributions" htmlFor="ptax" optional>
              <NumberInput id="ptax" value={p.effectiveTaxRate} onChange={(v) => set('effectiveTaxRate', v)} suffix="%" digits={1} min={0} max={100} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Rent or housing" htmlFor="ph" optional>
              <NumberInput id="ph" value={p.monthlyHousingCost} onChange={(v) => set('monthlyHousingCost', v)} suffix={`${cur}/mo`} digits={0} min={0} />
            </Field>
            <Field label="Other living costs" htmlFor="pl" optional>
              <NumberInput id="pl" value={p.monthlyLivingCost} onChange={(v) => set('monthlyLivingCost', v)} suffix={`${cur}/mo`} digits={0} min={0} />
            </Field>
            <Field label="Cash savings" htmlFor="ps" optional>
              <NumberInput id="ps" value={p.savings} onChange={(v) => set('savings', v)} suffix={cur} digits={0} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Investments" htmlFor="pi" optional>
              <NumberInput id="pi" value={p.investments} onChange={(v) => set('investments', v)} suffix={cur} digits={0} min={0} />
            </Field>
            <Field label="Debt" htmlFor="pd" optional>
              <NumberInput id="pd" value={p.debt} onChange={(v) => set('debt', v)} suffix={cur} digits={0} min={0} />
            </Field>
            <Field label="Debt repayment" htmlFor="pdp" optional>
              <NumberInput id="pdp" value={p.monthlyDebtPayment} onChange={(v) => set('monthlyDebtPayment', v)} suffix={`${cur}/mo`} digits={0} min={0} />
            </Field>
          </div>
        </div>
      </div>
      <div className="settings-group">
        <h2>Priorities</h2>
        <p>How much each factor matters, from 0 (not at all) to 5 (essential). Used to score how well each scenario fits you.</p>
        <div>
          {PRIORITY_FACTORS.map((f) => (
            <div key={f.key} className="weight-row">
              <div>
                <div style={{ fontWeight: 500 }}>{f.label}</div>
                <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                  {f.description}
                </div>
              </div>
              <PriorityPips label={f.label} value={p.priorities?.[f.key] ?? 3} onChange={(v) => set('priorities', { ...p.priorities, [f.key]: v })} />
            </div>
          ))}
        </div>
        <div className="field-row" style={{ marginTop: 'var(--s-5)' }}>
          <Field label="Risk tolerance" htmlFor="pr">
            <Select id="pr" value={p.riskTolerance ?? ''} onChange={(e) => set('riskTolerance', (e.target.value || null) as ProfileInput['riskTolerance'])}>
              <option value="">Not specified</option>
              <option value="low">Cautious</option>
              <option value="medium">Balanced</option>
              <option value="high">Adventurous</option>
            </Select>
          </Field>
          <Field label="Default planning horizon" htmlFor="phz">
            <NumberInput id="phz" value={p.planningHorizonYears ?? null} onChange={(v) => set('planningHorizonYears', v === null ? null : Math.max(1, Math.min(50, Math.round(v))))} suffix="years" digits={0} />
          </Field>
        </div>
        <Field label="Goals" htmlFor="pg" optional hint="One per line.">
          <Textarea id="pg" rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} />
        </Field>
      </div>
      <div>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save baseline
        </Button>
      </div>
    </div>
  );
}

function PreferenceSettings() {
  const { preferences, updatePreferences } = useSession();
  const toast = useToast();
  const save = async (patch: Preferences) => {
    const next = { ...preferences, ...patch };
    updatePreferences(next);
    try {
      await put('/preferences', patch);
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };
  return (
    <div className="settings-form">
      <div className="settings-group">
        <h2>Appearance</h2>
        <p>Follow your system or choose a theme.</p>
        <Segmented
          label="Theme"
          value={preferences.theme ?? 'system'}
          onChange={(v) => void save({ theme: v })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>
      <div className="settings-group">
        <h2>Numbers</h2>
        <p>How amounts are formatted.</p>
        <Field label="Number format" htmlFor="nl">
          <Select id="nl" value={preferences.numberLocale ?? 'en-US'} onChange={(e) => void save({ numberLocale: e.target.value as Preferences['numberLocale'] })} style={{ maxWidth: 280 }}>
            <option value="en-US">1,234.56 (English, US)</option>
            <option value="en-GB">1,234.56 (English, UK)</option>
            <option value="de-DE">1.234,56 (Deutsch)</option>
            <option value="fr-FR">1 234,56 (Français)</option>
            <option value="es-ES">1.234,56 (Español)</option>
            <option value="it-IT">1.234,56 (Italiano)</option>
            <option value="nl-NL">1.234,56 (Nederlands)</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}

function AiSettings() {
  const q = useAiSettings();
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<{ enabled: boolean; provider: AiStatusDTO['provider']; baseUrl: string; model: string; apiKey: string; shareProfile: boolean; dailyLimit: number; maxOutputTokens: number } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  useEffect(() => {
    if (q.data && !form)
      setForm({
        enabled: q.data.enabled,
        provider: q.data.origin === 'user' ? q.data.provider : null,
        baseUrl: q.data.origin === 'user' ? (q.data.baseUrl ?? '') : '',
        model: q.data.origin === 'user' ? (q.data.model ?? '') : '',
        apiKey: '',
        shareProfile: q.data.shareProfile,
        dailyLimit: q.data.dailyLimit,
        maxOutputTokens: q.data.maxOutputTokens,
      });
  }, [q.data, form]);

  if (!q.data || !form) return <Skeleton height={300} />;
  const s = q.data;
  const isAdmin = user?.role === 'admin';

  const save = async (removeKey = false) => {
    setBusy('save');
    try {
      const body = {
        enabled: form.enabled,
        provider: form.provider,
        baseUrl: form.provider && form.baseUrl.trim() ? form.baseUrl.trim() : null,
        model: form.provider ? form.model.trim() || null : null,
        apiKey: removeKey ? null : form.apiKey.trim() ? form.apiKey.trim() : undefined,
        shareProfile: form.shareProfile,
        dailyLimit: form.dailyLimit,
        maxOutputTokens: form.maxOutputTokens,
      };
      const next = await put<AiStatusDTO>('/ai/settings', body);
      qc.setQueryData(keys.aiSettings, next);
      setForm({ ...form, apiKey: '' });
      toast('AI settings saved.');
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await post<{ model: string; latencyMs: number }>('/ai/test');
      toast(`Connected to ${r.model} in ${(r.latencyMs / 1000).toFixed(1)} s.`);
      void qc.invalidateQueries({ queryKey: keys.aiSettings });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Connection failed.', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const keyNeeded = form.provider === 'anthropic' || (form.provider === 'openai' && !form.baseUrl);
  const placeholderModel = form.provider === 'anthropic' ? 'claude-sonnet-5-5' : form.provider === 'ollama' ? 'e.g. llama3.1:8b' : 'Model name offered by your provider';

  return (
    <div className="settings-form">
      <div className="settings-group">
        <h2>AI analyst</h2>
        <p>Optional. When enabled, an AI model can review assumptions, explain results and suggest alternatives. Every projection is still calculated by What-If’s own engine; the AI only sees results and never changes numbers without your approval.</p>
        <div className="toggle-row">
          <div className="text">
            Enable the AI analyst
            <small>Nothing is sent to any AI provider while this is off.</small>
          </div>
          <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enable the AI analyst" />
        </div>
        <div className="toggle-row">
          <div className="text">
            Share my profile context
            <small>Adds your location, occupation, goals, priorities and risk tolerance to requests. Your financial baseline figures are never included.</small>
          </div>
          <Switch checked={form.shareProfile} onChange={(v) => setForm({ ...form, shareProfile: v })} label="Share profile context" />
        </div>
        <Callout icon={<Lock aria-hidden />}>
          What-If does not use your data for training. Whether your provider does depends on its terms — most API plans do not by default. A local model through Ollama keeps everything on your network.
        </Callout>
      </div>

      <div className="settings-group">
        <h2>Provider</h2>
        {s.origin === 'instance' && !form.provider && (
          <Callout>
            Using the provider configured by your administrator ({s.provider} · {s.model}).
          </Callout>
        )}
        <div className="stack">
          <Field label="Provider" htmlFor="aip">
            <Select id="aip" value={form.provider ?? ''} onChange={(e) => setForm({ ...form, provider: (e.target.value || null) as AiStatusDTO['provider'] })}>
              <option value="">{s.origin === 'instance' || s.origin === 'none' ? 'Use instance default' : 'None'}</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI-compatible API</option>
              <option value="ollama">Ollama (local)</option>
            </Select>
          </Field>
          {form.provider && (
            <>
              <Field label="Model" htmlFor="aim" hint={form.provider === 'anthropic' ? 'Leave empty to use claude-sonnet-5-5.' : undefined}>
                <Input id="aim" value={form.model} placeholder={placeholderModel} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </Field>
              <Field
                label="Endpoint URL"
                htmlFor="aiu"
                optional
                hint={isAdmin ? (form.provider === 'ollama' ? 'Default http://localhost:11434. In Docker, try http://host.docker.internal:11434.' : form.provider === 'openai' ? 'Default https://api.openai.com/v1. Any OpenAI-compatible server works (vLLM, LM Studio, OpenRouter…).' : 'Default https://api.anthropic.com.') : 'Only administrators can set a custom endpoint.'}
              >
                <Input id="aiu" value={form.baseUrl} disabled={!isAdmin} placeholder={form.provider === 'ollama' ? 'http://localhost:11434' : form.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              </Field>
              <Field label="API key" htmlFor="aik" optional={!keyNeeded} hint={s.keyHint && s.origin === 'user' ? `Stored encrypted (${s.keyHint}). Leave empty to keep it.` : 'Stored encrypted on the server and never shown again.'}>
                <Input id="aik" type="password" autoComplete="off" value={form.apiKey} placeholder={s.keyHint && s.origin === 'user' ? s.keyHint : ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </div>

      <div className="settings-group">
        <h2>Usage limits</h2>
        <p>
          {s.usedToday} of {s.dailyLimit} requests used today (resets at midnight UTC).
        </p>
        <div className="field-row">
          <Field label="Requests per day" htmlFor="ail">
            <NumberInput id="ail" value={form.dailyLimit} digits={0} min={1} max={1000} onChange={(v) => setForm({ ...form, dailyLimit: Math.max(1, Math.round(v ?? 25)) })} />
          </Field>
          <Field label="Max response length" htmlFor="ait" hint="Output tokens per request.">
            <NumberInput id="ait" value={form.maxOutputTokens} digits={0} min={256} max={16000} onChange={(v) => setForm({ ...form, maxOutputTokens: Math.max(256, Math.min(16000, Math.round(v ?? 2000))) })} />
          </Field>
        </div>
      </div>

      <div className="row">
        <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
          Save
        </Button>
        <Button loading={busy === 'test'} disabled={!s.configured || !s.enabled} onClick={() => void test()} title={!s.enabled ? 'Enable and save first' : undefined}>
          Test connection
        </Button>
        {s.keyHint && s.origin === 'user' && (
          <Button variant="ghost" icon={<KeyRound />} onClick={() => void save(true)}>
            Remove stored key
          </Button>
        )}
      </div>
    </div>
  );
}

function DataSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-form">
      <div className="settings-group">
        <h2>Export</h2>
        <p>Download everything you have stored — profile, decisions, scenarios with every assumption, simulation inputs, journal, analyses and reports — as a JSON file. API keys and passwords are never included.</p>
        <div>
          <Button icon={<Download />} onClick={() => download('/account/export', 'what-if-export.json').catch((e) => toast((e as Error).message, 'bad'))}>
            Export my data
          </Button>
        </div>
      </div>
      <div className="settings-group">
        <h2>Example data</h2>
        <p>The example decision uses illustrative values and is labelled everywhere it appears. Remove it when you no longer need it, or add it again to explore.</p>
        <div className="row">
          <Button icon={<Trash2 />} onClick={() => setConfirm(true)}>
            Remove example decisions
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await post('/account/example');
                void qc.invalidateQueries();
                toast('Example decision added.');
              } catch (err) {
                toast((err as Error).message, 'bad');
              }
            }}
          >
            Add the example again
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={busy}
        title="Remove example decisions?"
        description="Only decisions marked as examples are removed. Your own decisions are not affected."
        confirmLabel="Remove"
        onConfirm={async () => {
          setBusy(true);
          try {
            const r = await del<{ removed: number }>('/account/examples');
            void qc.invalidateQueries();
            toast(r.removed ? `Removed ${r.removed} example decision${r.removed === 1 ? '' : 's'}.` : 'There were no example decisions.');
          } catch (err) {
            toast((err as Error).message, 'bad');
          }
          setBusy(false);
          setConfirm(false);
        }}
      />
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'auth.register': 'Account created',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.locked': 'Account temporarily locked',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'auth.session_revoked': 'Session revoked',
  'account.exported': 'Data exported',
  'account.examples_removed': 'Example data removed',
  'profile.updated': 'Profile updated',
  'ai.settings_updated': 'AI settings changed',
  'ai.request': 'AI request',
  'decision.created': 'Decision created',
  'decision.deleted': 'Decision deleted',
  'decision.decided': 'Decision recorded',
  'scenario.deleted': 'Scenario deleted',
  'report.created': 'Report generated',
  'admin.settings_updated': 'Instance settings changed',
};

function SecuritySettings() {
  const { signOut } = useSession();
  const sessions = useSessions();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const audit = useAudit(page);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const navigate = useNavigate();

  return (
    <div className="settings-form">
      <div className="settings-group">
        <h2>Password</h2>
        <p>Changing your password signs you out on every other device.</p>
        <div className="stack" style={{ maxWidth: 380 }}>
          <Field label="Current password" htmlFor="cp">
            <Input id="cp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="np" hint="At least 10 characters." error={pwError}>
            <Input id="np" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <div>
            <Button
              variant="primary"
              loading={pwBusy}
              disabled={!pw.current || pw.next.length < 10}
              onClick={async () => {
                setPwBusy(true);
                setPwError(null);
                try {
                  await post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
                  setPw({ current: '', next: '' });
                  void qc.invalidateQueries({ queryKey: keys.sessions });
                  toast('Password changed. Other sessions were signed out.');
                } catch (err) {
                  setPwError((err as Error).message);
                } finally {
                  setPwBusy(false);
                }
              }}
            >
              Change password
            </Button>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h2>Active sessions</h2>
        <p>Devices where you are signed in. Sessions expire after inactivity.</p>
        <div className="list">
          {sessions.data?.map((s) => (
            <div key={s.id} className="list-row">
              <ShieldCheck size={15} className="faint" aria-hidden />
              <div className="grow">
                <div className="title">
                  {browserName(s.userAgent)} {s.current && <Badge tone="good">This device</Badge>}
                </div>
                <div className="sub">
                  {s.ip ?? 'Unknown address'} · last active {relativeTime(s.lastSeenAt)} · signed in {dateLabel(s.createdAt)}
                </div>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await del(`/auth/sessions/${s.id}`);
                    void qc.invalidateQueries({ queryKey: keys.sessions });
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 'var(--s-3)' }}>
          <Button
            size="sm"
            onClick={async () => {
              const r = await post<{ revoked: number }>('/auth/sessions/revoke-others');
              void qc.invalidateQueries({ queryKey: keys.sessions });
              toast(`Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}.`);
            }}
          >
            Sign out other sessions
          </Button>
          <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => void signOut()}>
            Sign out here
          </Button>
        </div>
      </div>

      <div className="settings-group">
        <h2>Activity log</h2>
        <p>Security-relevant events on your account. Amounts and personal values are never logged.</p>
        <table className="table">
          <tbody>
            {audit.data?.items.map((e) => (
              <tr key={e.id}>
                <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                <td className="faint">{e.ip ?? ''}</td>
                <td className="r faint">{relativeTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <Button size="sm" variant="ghost" disabled={(audit.data?.items.length ?? 0) < 30} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      </div>

      <div className="settings-group">
        <h2>Delete account</h2>
        <p>Permanently deletes your account and everything in it: profile, decisions, scenarios, simulation history, journal, analyses, reports and settings. Export your data first if you want a copy.</p>
        <div>
          <Button variant="danger" icon={<Trash2 />} onClick={() => setDeleteOpen(true)}>
            Delete my account
          </Button>
        </div>
      </div>
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        description="This cannot be undone."
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={deleteConfirm !== 'DELETE' || !deletePw}
              onClick={async () => {
                setDeleteError(null);
                try {
                  await del('/account', { password: deletePw, confirm: 'DELETE' });
                  await signOut();
                  navigate('/signin', { replace: true });
                } catch (err) {
                  setDeleteError((err as Error).message);
                }
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <Field label="Password" htmlFor="dpw" error={deleteError}>
          <Input id="dpw" type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
        </Field>
        <Field label="Type DELETE to confirm" htmlFor="dcf">
          <Input id="dcf" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}

function browserName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return os ? `${br} on ${os}` : br;
}

function AdminSettings() {
  const q = useQuery({ queryKey: keys.admin, queryFn: ({ signal }) => get<{ registrationOpen: boolean; userCount: number; aiInstanceProvider: string | null; version: string; database: string }>('/admin/settings', signal) });
  const qc = useQueryClient();
  const toast = useToast();
  if (!q.data) return <Skeleton height={200} />;
  return (
    <div className="settings-form">
      <div className="settings-group">
        <h2>Instance</h2>
        <p>Settings for everyone on this What-If server.</p>
        <dl className="report-dl">
          <dt>Version</dt>
          <dd>{q.data.version}</dd>
          <dt>Database</dt>
          <dd>{q.data.database === 'postgres' ? 'PostgreSQL' : 'Embedded (development only)'}</dd>
          <dt>Accounts</dt>
          <dd>{q.data.userCount}</dd>
          <dt>Instance AI provider</dt>
          <dd>{q.data.aiInstanceProvider ?? 'None configured (set AI_PROVIDER in the environment)'}</dd>
        </dl>
        {q.data.database !== 'postgres' && (
          <Callout tone="warn" icon={<Server aria-hidden />}>
            This instance uses the embedded development database. Use PostgreSQL in production (see the README).
          </Callout>
        )}
      </div>
      <div className="settings-group">
        <h2>Registration</h2>
        <div className="toggle-row">
          <div className="text">
            Allow new accounts
            <small>When off, only existing users can sign in. Recommended once everyone who needs access has an account.</small>
          </div>
          <Switch
            checked={q.data.registrationOpen}
            label="Allow new accounts"
            onChange={async (v) => {
              try {
                await put('/admin/settings', { registrationOpen: v });
                void qc.invalidateQueries({ queryKey: keys.admin });
                toast(v ? 'Registration opened.' : 'Registration closed.');
              } catch (err) {
                toast((err as Error).message, 'bad');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
