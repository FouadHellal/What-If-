/** Response shapes returned by the API. Kept in one place so server and web agree. */
import type { FlowInput, PriorityWeights, ScenarioScores, SimulationResult, VariableInput, VariableKey } from '@whatif/engine';
import type { DecisionCategory, DecisionStatus, Preferences, ProfileInput, ValueSourceT } from './schemas';

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export interface SessionDTO {
  user: UserDTO;
  profile: ProfileDTO;
  preferences: Preferences;
  csrfToken: string;
}

export type ProfileDTO = ProfileInput & { updatedAt: string | null };

export interface DecisionSummaryDTO {
  id: string;
  title: string;
  question: string | null;
  category: DecisionCategory;
  status: DecisionStatus;
  horizonYears: number;
  baseCurrency: string;
  isExample: boolean;
  scenarioCount: number;
  chosenScenarioId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Scenario names with their latest expected final net worth, in base currency where convertible. */
  preview: { id: string; name: string; colorIndex: number; isBaseline: boolean; finalNetWorth: number | null; currency: string }[];
}

export interface AssumptionDTO {
  id: string;
  scenarioId: string | null;
  text: string;
  category: 'assumption' | 'risk' | 'opportunity' | 'question';
  source: ValueSourceT;
  likelihood: 'low' | 'medium' | 'high' | null;
  impact: 'low' | 'medium' | 'high' | null;
  createdAt: string;
}

export interface ScenarioDTO {
  id: string;
  decisionId: string;
  name: string;
  description: string | null;
  isBaseline: boolean;
  status: 'active' | 'archived';
  colorIndex: number;
  position: number;
  version: number;
  startDate: string;
  horizonYears: number;
  currency: string;
  exchangeRateToBase: number | null;
  exchangeRateSource: ValueSourceT | null;
  variables: Partial<Record<VariableKey, VariableInput>>;
  flows: FlowInput[];
  scores: ScenarioScores;
  createdAt: string;
  updatedAt: string;
  latestRun: SimulationRunMeta | null;
}

export interface SimulationRunMeta {
  id: string;
  scenarioVersion: number;
  engineVersion: string;
  inputHash: string;
  seed: number;
  runs: number;
  createdAt: string;
  durationMs: number;
}

export interface SimulationRunDTO extends SimulationRunMeta {
  scenarioId: string;
  result: SimulationResult;
}

export interface MilestoneDTO {
  id: string;
  decisionId: string;
  scenarioId: string | null;
  title: string;
  description: string | null;
  date: string;
  status: 'planned' | 'achieved' | 'missed' | 'cancelled';
  achievedOn: string | null;
  createdAt: string;
}

export interface DecisionDTO extends Omit<DecisionSummaryDTO, 'preview' | 'scenarioCount'> {
  description: string | null;
  priorities: PriorityWeights | null;
  rationale: string | null;
  expectations: string | null;
  decidedAt: string | null;
  decidedRunId: string | null;
  origin: 'manual' | 'template' | 'parser' | 'ai';
  scenarios: ScenarioDTO[];
  assumptions: AssumptionDTO[];
  milestones: MilestoneDTO[];
}

export interface JournalEntryDTO {
  id: string;
  decisionId: string | null;
  decisionTitle: string | null;
  scenarioId: string | null;
  type: 'note' | 'reasoning' | 'expectation' | 'decision' | 'outcome' | 'checkin' | 'reflection';
  title: string;
  body: string;
  entryDate: string;
  actuals: {
    netWorth?: number | null;
    cash?: number | null;
    monthlyIncome?: number | null;
    monthlyExpenses?: number | null;
    satisfaction?: number | null;
  } | null;
  /** For check-ins: projected values of the chosen scenario at the entry month (from the pinned run). */
  projected: { netWorth: number | null; cash: number | null; monthlyIncome: number | null; monthlyExpenses: number | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiAnalysisDTO {
  id: string;
  decisionId: string;
  scenarioId: string | null;
  task: string;
  provider: string;
  model: string;
  status: 'completed' | 'failed';
  output: AiOutput | null;
  error: string | null;
  /** Numbers in the AI text that could not be matched to the simulation facts it was given. */
  unverifiedNumbers: string[];
  runIds: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export interface AiOutput {
  summary: string;
  points: { title: string; detail: string; kind?: 'risk' | 'opportunity' | 'cost' | 'assumption' | 'alternative' | 'insight' }[];
  suggestions?: AiSuggestion[];
}

export interface AiSuggestion {
  scenarioId: string;
  key: VariableKey;
  value: number;
  low?: number | null;
  high?: number | null;
  rationale: string;
}

export interface AiStatusDTO {
  enabled: boolean;
  configured: boolean;
  provider: 'openai' | 'anthropic' | 'ollama' | null;
  model: string | null;
  baseUrl: string | null;
  keyHint: string | null;
  /** Where the active configuration comes from. */
  origin: 'user' | 'instance' | 'none';
  shareProfile: boolean;
  dailyLimit: number;
  maxOutputTokens: number;
  usedToday: number;
  isLocal: boolean;
}

export interface ReportDTO {
  id: string;
  decisionId: string;
  title: string;
  createdAt: string;
  snapshot: ReportSnapshot;
}

export interface ReportSnapshot {
  generatedAt: string;
  decision: Pick<DecisionDTO, 'id' | 'title' | 'question' | 'description' | 'category' | 'status' | 'baseCurrency' | 'horizonYears' | 'rationale' | 'expectations' | 'decidedAt' | 'chosenScenarioId'>;
  baseline: ProfileInput | null;
  scenarios: {
    id: string;
    name: string;
    description: string | null;
    isBaseline: boolean;
    currency: string;
    exchangeRateToBase: number | null;
    version: number;
    runId: string;
    inputHash: string;
    variables: { key: string; label: string; value: number | null; low: number | null; high: number | null; unit: string; source: ValueSourceT; note: string | null }[];
    flows: FlowInput[];
    summary: SimulationResult['expected']['summary'];
    best: number;
    worst: number;
    uncertainty: SimulationResult['uncertainty'];
    sensitivity: SimulationResult['sensitivity'];
    insights: SimulationResult['insights'];
    milestones: SimulationResult['milestones'];
    yearly: { label: string; netWorth: number; cash: number; netIncome: number; totalExpenses: number }[];
    warnings: SimulationResult['warnings'];
    fit: number | null;
  }[];
  comparison: { key: string; label: string; unit: string; values: Record<string, number | null>; leader: string | null }[];
  assumptions: AssumptionDTO[];
  milestones: MilestoneDTO[];
  aiSummary: { provider: string; model: string; createdAt: string; output: AiOutput; unverifiedNumbers: string[] } | null;
  engineVersion: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface AuditEventDTO {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface OverviewDTO {
  activeDecisions: DecisionSummaryDTO[];
  upcomingMilestones: (MilestoneDTO & { decisionTitle: string; scenarioName: string | null; derived: boolean })[];
  recentScenarios: { id: string; name: string; decisionId: string; decisionTitle: string; updatedAt: string; colorIndex: number }[];
  recentJournal: JournalEntryDTO[];
  counts: { decisions: number; scenarios: number; journal: number; decided: number };
  hasExample: boolean;
}
