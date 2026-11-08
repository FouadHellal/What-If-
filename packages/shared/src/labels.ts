import type { DecisionStatus, ValueSourceT } from './schemas';

export const SOURCE_LABELS: Record<ValueSourceT, { label: string; description: string }> = {
  user: { label: 'You', description: 'Provided by you.' },
  ai: { label: 'AI estimate', description: 'Suggested by the AI analyst. Review before relying on it.' },
  external: { label: 'External data', description: 'Taken from an external data source.' },
  system: { label: 'Assumption', description: 'A default or illustrative assumption. Replace it with your own value.' },
};

export const STATUS_LABELS: Record<DecisionStatus, string> = {
  exploring: 'Exploring',
  deciding: 'Deciding',
  decided: 'Decided',
  archived: 'Archived',
};

export const JOURNAL_TYPE_LABELS: Record<string, { label: string; description: string }> = {
  note: { label: 'Note', description: 'Anything worth remembering.' },
  reasoning: { label: 'Reasoning', description: 'Why you are considering this decision.' },
  expectation: { label: 'Expectation', description: 'What you expect to happen.' },
  decision: { label: 'Decision', description: 'What you decided and why.' },
  outcome: { label: 'Outcome', description: 'What actually happened.' },
  checkin: { label: 'Check-in', description: 'Real numbers to compare with the projection.' },
  reflection: { label: 'Reflection', description: 'Looking back on the decision.' },
};

export const AI_TASK_LABELS: Record<string, { label: string; description: string }> = {
  review: { label: 'Review assumptions', description: 'Challenge unrealistic values, find overlooked costs and missing assumptions.' },
  explain: { label: 'Explain the results', description: 'A plain-language walkthrough of what drives each projection.' },
  risks: { label: 'Identify risks', description: 'Risks and opportunities the numbers alone may not show.' },
  alternatives: { label: 'Suggest alternatives', description: 'Other paths worth modelling.' },
  summary: { label: 'Executive summary', description: 'A concise summary of the trade-offs, for your report.' },
};
