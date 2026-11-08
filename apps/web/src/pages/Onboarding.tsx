import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Lock, Sparkles, Split } from 'lucide-react';
import { PRIORITY_FACTORS } from '@whatif/engine';
import { COUNTRIES, CURRENCIES, currencyForCountry, type ProfileDTO, type ProfileInput } from '@whatif/shared';
import { post, put } from '../api/client';
import { useSession } from '../lib/session';
import { Button, Callout, Field, Input, NumberInput, Select, useToast } from '../components/ui';
import { BrandMark } from '../layout/AppShell';

const AGE = [
  ['under_25', 'Under 25'],
  ['25_34', '25–34'],
  ['35_44', '35–44'],
  ['45_54', '45–54'],
  ['55_64', '55–64'],
  ['65_plus', '65 or older'],
] as const;

const EMPLOYMENT = [
  ['employed', 'Employed'],
  ['self_employed', 'Self-employed'],
  ['student', 'Student'],
  ['unemployed', 'Looking for work'],
  ['career_break', 'On a career break'],
  ['retired', 'Retired'],
  ['other', 'Other'],
] as const;

export function PriorityPips({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="pips" role="group" aria-label={`${label} importance`}>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)} title={n === 0 ? 'Not important' : n === 5 ? 'Essential' : undefined}>
          {n}
        </button>
      ))}
    </div>
  );
}

export default function Onboarding() {
  const { profile, user, updateProfile } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [p, setP] = useState<ProfileInput>(() => ({
    displayName: profile?.displayName ?? user?.name ?? '',
    country: profile?.country ?? null,
    city: profile?.city ?? null,
    ageRange: profile?.ageRange ?? null,
    employmentStatus: profile?.employmentStatus ?? null,
    occupation: profile?.occupation ?? null,
    education: profile?.education ?? null,
    currency: profile?.currency ?? 'EUR',
    annualIncome: profile?.annualIncome ?? null,
    effectiveTaxRate: profile?.effectiveTaxRate ?? null,
    monthlyHousingCost: profile?.monthlyHousingCost ?? null,
    monthlyLivingCost: profile?.monthlyLivingCost ?? null,
    savings: profile?.savings ?? null,
    investments: profile?.investments ?? null,
    debt: profile?.debt ?? null,
    monthlyDebtPayment: profile?.monthlyDebtPayment ?? null,
    goals: profile?.goals ?? [],
    priorities: { financial: 3, career: 3, time: 3, relationships: 3, lifestyle: 3, growth: 3, ...(profile?.priorities ?? {}) },
    riskTolerance: profile?.riskTolerance ?? 'medium',
    planningHorizonYears: profile?.planningHorizonYears ?? 10,
  }));
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [goalText, setGoalText] = useState((profile?.goals ?? []).join('\n'));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Get started · What-If';
  }, []);

  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setP((x) => ({ ...x, [k]: v }));

  const save = async (finish: boolean) => {
    const body: ProfileInput = {
      ...p,
      goals: goalText
        .split('\n')
        .map((g) => g.trim())
        .filter(Boolean)
        .slice(0, 12),
      onboardingCompleted: finish ? true : undefined,
    };
    const saved = await put<ProfileDTO>('/profile', body);
    updateProfile(saved);
    return saved;
  };

  const finish = async (next: 'example' | 'new' | 'overview') => {
    setBusy(true);
    try {
      await save(true);
      if (next === 'example') {
        const { id } = await post<{ id: string }>('/account/example');
        navigate(`/decisions/${id}`, { replace: true });
      } else navigate(next === 'new' ? '/decisions/new' : '/', { replace: true });
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const steps = ['About you', 'Your finances', 'What matters', 'Get started'];

  return (
    <div className="page page-narrow" style={{ paddingTop: 'var(--s-12)' }}>
      <div className="row-between" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="brand">
          <BrandMark />
          <span>What-If</span>
        </div>
        <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
          Step {step + 1} of {steps.length} · {steps[step]}
        </span>
      </div>
      <div className="steps" aria-hidden>
        {steps.map((s, i) => (
          <span key={s} className={i <= step ? 'done' : ''} />
        ))}
      </div>

      {step === 0 && (
        <div className="stack" style={{ gap: 'var(--s-6)' }}>
          <div>
            <h1 className="page-title">Your starting point</h1>
            <p className="page-subtitle">
              A baseline lets every scenario start from where you are today. Everything here is optional and you can change it later in Settings.
            </p>
          </div>
          <Field label="What should we call you?" htmlFor="dn">
            <Input id="dn" value={p.displayName ?? ''} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label="Country" htmlFor="country" optional>
              <Select
                id="country"
                value={p.country ?? ''}
                onChange={(e) => {
                  const c = e.target.value || null;
                  set('country', c);
                  const cur = currencyForCountry(c);
                  if (cur && !currencyTouched) set('currency', cur);
                }}
              >
                <option value="">Not specified</option>
                {COUNTRIES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="City" htmlFor="city" optional>
              <Input id="city" value={p.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
            </Field>
          </div>
          <Field label="Age range" optional>
            <div className="choice-grid">
              {AGE.map(([v, l]) => (
                <button key={v} type="button" className="choice" aria-pressed={p.ageRange === v} onClick={() => set('ageRange', p.ageRange === v ? null : v)}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <div className="field-row">
            <Field label="Work situation" htmlFor="emp" optional>
              <Select id="emp" value={p.employmentStatus ?? ''} onChange={(e) => set('employmentStatus', (e.target.value || null) as ProfileInput['employmentStatus'])}>
                <option value="">Not specified</option>
                {EMPLOYMENT.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Occupation" htmlFor="occ" optional>
              <Input id="occ" placeholder="e.g. Network engineer" value={p.occupation ?? ''} onChange={(e) => set('occupation', e.target.value || null)} />
            </Field>
          </div>
          <Field label="Education or qualifications" htmlFor="edu" optional>
            <Input id="edu" placeholder="e.g. MSc Telecommunications, CCNP" value={p.education ?? ''} onChange={(e) => set('education', e.target.value || null)} />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="stack" style={{ gap: 'var(--s-6)' }}>
          <div>
            <h1 className="page-title">Money, if you’d like</h1>
            <p className="page-subtitle">These numbers pre-fill your “stay as I am” scenarios. Skip anything you’d rather not share — the simulations will simply ask when they need it.</p>
          </div>
          <Callout icon={<Lock aria-hidden />}>
            Stored only in this What-If instance’s database. It is never sent to an AI provider unless you turn that on explicitly in Settings.
          </Callout>
          <div className="field-row">
            <Field label="Currency" htmlFor="cur">
              <Select
                id="cur"
                value={p.currency ?? 'EUR'}
                onChange={(e) => {
                  setCurrencyTouched(true);
                  set('currency', e.target.value);
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Gross annual income" optional htmlFor="inc">
              <NumberInput id="inc" value={p.annualIncome} onChange={(v) => set('annualIncome', v)} suffix={`${p.currency}/yr`} min={0} digits={0} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Tax & social contributions" optional htmlFor="tax" hint="Your effective rate on gross income.">
              <NumberInput id="tax" value={p.effectiveTaxRate} onChange={(v) => set('effectiveTaxRate', v)} suffix="%" min={0} max={100} digits={1} />
            </Field>
            <Field label="Rent or housing" optional htmlFor="house">
              <NumberInput id="house" value={p.monthlyHousingCost} onChange={(v) => set('monthlyHousingCost', v)} suffix={`${p.currency}/mo`} min={0} digits={0} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Other living costs" optional htmlFor="living" hint="Food, transport, bills, leisure.">
              <NumberInput id="living" value={p.monthlyLivingCost} onChange={(v) => set('monthlyLivingCost', v)} suffix={`${p.currency}/mo`} min={0} digits={0} />
            </Field>
            <Field label="Cash savings" optional htmlFor="sav">
              <NumberInput id="sav" value={p.savings} onChange={(v) => set('savings', v)} suffix={p.currency} digits={0} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Investments" optional htmlFor="inv">
              <NumberInput id="inv" value={p.investments} onChange={(v) => set('investments', v)} suffix={p.currency} min={0} digits={0} />
            </Field>
            <Field label="Debt (excluding mortgage)" optional htmlFor="debt">
              <NumberInput id="debt" value={p.debt} onChange={(v) => set('debt', v)} suffix={p.currency} min={0} digits={0} />
            </Field>
          </div>
          {(p.debt ?? 0) > 0 && (
            <Field label="Monthly debt repayment" optional htmlFor="dp">
              <NumberInput id="dp" value={p.monthlyDebtPayment} onChange={(v) => set('monthlyDebtPayment', v)} suffix={`${p.currency}/mo`} min={0} digits={0} />
            </Field>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="stack" style={{ gap: 'var(--s-6)' }}>
          <div>
            <h1 className="page-title">What matters to you</h1>
            <p className="page-subtitle">Numbers are only part of a decision. Your priorities weight how well each scenario fits you, alongside the financial projections.</p>
          </div>
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
          <Field label="How comfortable are you with risk?">
            <div className="choice-grid">
              {(
                [
                  ['low', 'Cautious', 'I prefer certainty'],
                  ['medium', 'Balanced', 'Some risk for upside'],
                  ['high', 'Adventurous', 'I accept volatility'],
                ] as const
              ).map(([v, l, d]) => (
                <button key={v} type="button" className="choice" aria-pressed={p.riskTolerance === v} onClick={() => set('riskTolerance', v)}>
                  {l}
                  <small>{d}</small>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Goals" optional htmlFor="goals" hint="One per line, e.g. “Own a home by 40”.">
            <textarea id="goals" className="textarea" rows={3} value={goalText} onChange={(e) => setGoalText(e.target.value)} />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="stack" style={{ gap: 'var(--s-6)' }}>
          <div>
            <h1 className="page-title">How far ahead do you plan?</h1>
            <p className="page-subtitle">New decisions use this horizon by default. Each scenario can override it.</p>
          </div>
          <div className="choice-grid">
            {[3, 5, 10, 15, 20, 30].map((y) => (
              <button key={y} type="button" className="choice" aria-pressed={p.planningHorizonYears === y} onClick={() => set('planningHorizonYears', y)}>
                {y} years
              </button>
            ))}
          </div>
          <hr />
          <div>
            <h2 style={{ fontSize: 'var(--text-md)' }}>Where would you like to begin?</h2>
            <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
              The example is a complete relocation decision with three scenarios. Its values are illustrative and clearly marked; you can remove it any time.
            </p>
          </div>
          <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <button type="button" className="choice" style={{ padding: 16 }} disabled={busy} onClick={() => void finish('example')}>
              <Sparkles size={16} aria-hidden />
              <strong>Explore the example</strong>
              <small>Germany vs. Canada vs. staying — fully modelled.</small>
            </button>
            <button type="button" className="choice" style={{ padding: 16 }} disabled={busy} onClick={() => void finish('new')}>
              <Split size={16} aria-hidden />
              <strong>Start my own decision</strong>
              <small>Describe it in a sentence or pick a template.</small>
            </button>
          </div>
        </div>
      )}

      <div className="row-between" style={{ marginTop: 'var(--s-10)', paddingTop: 'var(--s-5)', borderTop: '1px solid var(--border)' }}>
        <Button variant="ghost" icon={<ArrowLeft />} onClick={() => setStep((s) => s - 1)} disabled={step === 0 || busy}>
          Back
        </Button>
        <div className="row">
          {step < 3 ? (
            <>
              {step === 1 && (
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Skip for now
                </Button>
              )}
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await save(false);
                    setStep((s) => s + 1);
                  } catch (err) {
                    toast((err as Error).message, 'bad');
                  }
                }}
              >
                Continue <ArrowRight aria-hidden />
              </Button>
            </>
          ) : (
            <Button variant="secondary" loading={busy} onClick={() => void finish('overview')}>
              Go to overview
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
