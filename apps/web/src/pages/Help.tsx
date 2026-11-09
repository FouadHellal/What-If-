import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Input } from '../components/ui';

/** Plain-language guide: how to use What-If, and what each number means. */
const STEPS = [
  {
    title: 'Ask your question',
    body: 'Write it like you would say it: “What if I do my military service now?” or pick a template. What-If sets up two or more paths to compare — usually “keep things as they are” and the change you are thinking about.',
  },
  {
    title: 'Fill in the numbers that matter',
    body: 'Each path is a scenario with money in and out over time: salary, rent, costs, one-off expenses. Anything marked “Needs your input” is still a guess of zero — fill those first. Your baseline profile pre-fills the common ones.',
  },
  {
    title: 'Read the Summary',
    body: 'It tells you which path ends with more money, which one is safest when things go wrong, and which fits your priorities best. These are often not the same path — that is the point.',
  },
  {
    title: 'Test what you are unsure about',
    body: 'In the Lab, change one number (“what if rent is 20 % higher?”) and see what happens without touching your scenarios. “What would change my mind” shows how far a number must move before another path wins.',
  },
  {
    title: 'Decide together',
    body: 'Share a decision with your partner or family from the Share button. Editors change the same scenarios with you; viewers can only look. Your journal, reports and analyst chats stay private.',
  },
  {
    title: 'Record and check back',
    body: 'When you choose, write down why and what you expect. Later, journal check-ins compare what really happened with what you planned.',
  },
];

const TERMS: { term: string; plain: string }[] = [
  { term: 'Scenario', plain: 'One possible path, with its own numbers. A decision compares two or more.' },
  { term: 'Baseline', plain: 'The path you compare everything else against — usually “carry on as now”. Every decision has exactly one.' },
  { term: 'Horizon', plain: 'How many years ahead the comparison looks. Longer horizons make small yearly differences add up.' },
  { term: 'Net worth', plain: 'Everything you own (cash, investments, a home’s value) minus what you owe. The main money result.' },
  { term: 'Expected outcome', plain: 'What happens if every number turns out exactly as you entered it.' },
  { term: 'Range (P10 – P90)', plain: 'What-If replays your plan thousands of times with realistic ups and downs. P10 is a bad case (only 1 in 10 futures is worse), P50 the middle, P90 a good case (only 1 in 10 is better).' },
  { term: 'Simulations / runs', plain: 'How many random futures are tried. More runs give steadier numbers but take longer. 1,000 is plenty for most decisions.' },
  { term: 'Win probability', plain: 'In what share of those futures this path ends ahead of all the others.' },
  { term: 'Regret', plain: 'How much worse off you would be, compared with the best path in that same future. Low regret means “even if I am wrong, it does not hurt much”.' },
  { term: 'Robust', plain: 'A path that does well across many futures, not just the expected one.' },
  { term: 'Break-even', plain: 'The month a change has paid back its cost and moves ahead of the baseline.' },
  { term: 'What would change my mind', plain: 'The value a single number would have to reach for a different path to come out on top. If it is close to your estimate, your decision depends on that guess.' },
  { term: 'Sensitivity', plain: 'Which inputs move the result most. Spend your research time on those.' },
  { term: 'Life quality score', plain: 'How each path rates on what you care about — career, family, freedom, health and more — weighted by your priorities. It is separate from money on purpose.' },
  { term: 'Priorities', plain: 'How much each life dimension matters to you, from 0 to 5. Changing them can change which path fits you best.' },
  { term: 'Goal probability', plain: 'The chance of reaching a target you set, such as “€20,000 saved by 2030” or “never below €2,000 in cash”.' },
  { term: 'Assumption (system)', plain: 'A default What-If filled in, such as inflation. Always shown and labelled — replace it if you know better.' },
  { term: 'Evidence', plain: 'A sourced number you saved, like an official exchange rate or inflation figure, with where and when it came from.' },
  { term: 'Hidden costs', plain: 'Costs people often forget for this kind of decision. What-If checks whether your scenarios include them.' },
  { term: 'Income gap', plain: 'Months without a salary — job search, studies, military service, a break.' },
  { term: 'Exchange rate to base', plain: 'How many units of the comparison currency one unit of a scenario’s currency is worth, so paths in DZD and EUR can be compared fairly.' },
];

export default function Help() {
  const [q, setQ] = useState('');
  useEffect(() => {
    document.title = 'How it works · What-If';
  }, []);
  const terms = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? TERMS.filter((x) => `${x.term} ${x.plain}`.toLowerCase().includes(t)) : TERMS;
  }, [q]);
  return (
    <div className="page help-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">How it works</h1>
          <p className="page-subtitle">What-If compares the paths in front of you — with money, time and what matters to you — so you can choose with your eyes open. It does not predict the future or tell you what to do.</p>
        </div>
      </header>

      <section className="section">
        <h2 className="section-title">Six steps</h2>
        <ol className="help-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-n" aria-hidden>
                {i + 1}
              </span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p>
          <Link to="/decisions/new">Start a decision →</Link>
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">What the words mean</h2>
        </div>
        <div className="search template-search">
          <Search aria-hidden />
          <Input type="search" placeholder="Find a term" aria-label="Find a term" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <dl className="glossary">
          {terms.map((t) => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.plain}</dd>
            </div>
          ))}
        </dl>
        {terms.length === 0 && <p className="muted">No term matches “{q}”.</p>}
      </section>

      <section className="section">
        <h2 className="section-title">Good to know</h2>
        <ul className="help-notes">
          <li>Results are only as good as the numbers you enter. Treat them as a structured way to think, not a forecast.</li>
          <li>Rules for taxes, visas or military service differ by country and change. Templates flag these as questions — check the current official rules.</li>
          <li>Everything stays on this server. Nothing is sent anywhere unless you turn on the AI analyst or look up an exchange rate or inflation figure.</li>
        </ul>
      </section>
    </div>
  );
}
