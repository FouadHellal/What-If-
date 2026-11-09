/** Response shapes returned by the API. Kept in one place so server and web agree. */
import type { FlowInput, PriorityWeights, ScenarioModel, ScenarioScores, SimulationResult, TaxSchedule, VariableInput, VariableKey } from '@whatif/engine';
import type { DecisionCategory, DecisionSettings, DecisionStatus, Preferences, ProfileInput, ValueSourceT } from './schemas';

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
  /** What the current user may do: their own decision, or one shared with them. */
  access: DecisionAccess;
  /** The owner's name when the decision is shared with the current user; null for their own. */
  sharedBy: string | null;
  /** How many other people can open this decision. */
  memberCount: number;
}

export type DecisionAccess = 'owner' | 'editor' | 'viewer';

export interface PersonDTO {
  id: string;
  name: string;
  email: string;
}

export interface DecisionMemberDTO extends PersonDTO {
  role: 'editor' | 'viewer';
  addedAt: string;
}

export interface DecisionPeopleDTO {
  owner: PersonDTO;
  members: DecisionMemberDTO[];
}

export interface AdminUserDTO extends UserDTO {
  lastLoginAt: string | null;
  decisions: number;
  locked: boolean;
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
  tax: TaxSchedule | null;
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

export interface DecisionDTO extends Omit<DecisionSummaryDTO, 'preview' | 'scenarioCount' | 'memberCount'> {
  /** Owner and everyone the decision is shared with. */
  people: DecisionPeopleDTO;
  description: string | null;
  priorities: PriorityWeights | null;
  settings: DecisionSettings;
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

export interface ExperimentMetrics {
  finalNetWorth: number;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  shortfallProbability: number | null;
  lowestCash: number;
  monthlyNetCashFlowYear1: number;
}

export interface ExperimentDTO {
  id: string;
  decisionId: string;
  scenarioId: string;
  scenarioName: string | null;
  name: string;
  note: string | null;
  changes: Record<string, number>;
  baseVersion: number;
  /** Whether the scenario has changed since the experiment was run. */
  stale: boolean;
  original: ExperimentMetrics;
  variant: ExperimentMetrics;
  currency: string;
  engineVersion: string;
  /** Name of the person who ran it (decisions can be shared). */
  createdBy: string | null;
  createdAt: string;
}

export interface ExperimentDetailDTO extends ExperimentDTO {
  baseInputs: ScenarioModel;
  inputs: ScenarioModel;
}

export interface EvidenceDTO {
  id: string;
  decisionId: string;
  scenarioId: string | null;
  label: string;
  value: number | null;
  unit: string | null;
  sourceName: string;
  sourceUrl: string | null;
  retrievedOn: string;
  coverage: string | null;
  uncertainty: string | null;
  note: string | null;
  origin: string;
  /** Name of the person who added it. */
  createdBy: string | null;
  createdAt: string;
}

export type EvidenceBasis = 'app_data' | 'user_assumption' | 'external' | 'model' | 'interpretation';

export interface AiAnswerPart {
  text: string;
  basis: EvidenceBasis;
}

export interface AiMessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: AiAnswerPart[] | null;
  followUps: string[];
  suggestedFacts: string[];
  unverifiedNumbers: string[];
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface OverviewDTO {
  activeDecisions: DecisionSummaryDTO[];
  upcomingMilestones: (MilestoneDTO & { decisionTitle: string; scenarioName: string | null; derived: boolean })[];
  recentScenarios: { id: string; name: string; decisionId: string; decisionTitle: string; updatedAt: string; colorIndex: number }[];
  recentJournal: JournalEntryDTO[];
  counts: { decisions: number; scenarios: number; journal: number; decided: number };
  /** Decisions that need attention, with the reason. */
  attention: { decisionId: string; title: string; reason: 'missing_inputs' | 'checkin_due' | 'stale' | 'deciding'; detail: string }[];
  recentExperiments: { id: string; name: string; decisionId: string; decisionTitle: string; createdAt: string; delta: number; currency: string }[];
  recentReports: { id: string; title: string; decisionId: string; createdAt: string }[];
  profileCompleteness: number;
  hasExample: boolean;
}
