/**
 * Provider abstraction for the optional AI analyst. Implementations use plain
 * `fetch` — no SDKs — so adding a provider is a small, auditable change.
 */
export type AiProviderName = 'openai' | 'anthropic' | 'ollama';

export interface AiProviderConfig {
  provider: AiProviderName;
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
}

export interface AiCompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface AiCompletion {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  complete(req: AiCompletionRequest): Promise<AiCompletion>;
}

export type AiProviderFactory = (cfg: AiProviderConfig) => AiProvider;

export type AiErrorCode = 'unavailable' | 'auth' | 'rate_limited' | 'bad_response' | 'timeout' | 'not_configured' | 'quota';

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export const DEFAULT_BASE_URLS: Record<AiProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434',
};

/** Suggested defaults shown in settings. Only Anthropic has a built-in default; others must be chosen. */
export const DEFAULT_MODELS: Partial<Record<AiProviderName, string>> = {
  anthropic: 'claude-sonnet-5-5',
};

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new AiProviderError('timeout', 'The AI provider did not respond in time.');
    throw new AiProviderError('unavailable', `Could not reach the AI provider (${(err as Error).message}).`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
    } catch {
      detail = text.slice(0, 200);
    }
    if (res.status === 401 || res.status === 403) throw new AiProviderError('auth', `The AI provider rejected the credentials${detail ? `: ${detail}` : '.'}`);
    if (res.status === 429) throw new AiProviderError('rate_limited', 'The AI provider is rate limiting requests. Try again shortly.');
    if (res.status === 404) throw new AiProviderError('bad_response', `The AI provider could not find that endpoint or model${detail ? `: ${detail}` : '.'}`);
    throw new AiProviderError('unavailable', `The AI provider returned an error (${res.status})${detail ? `: ${detail}` : '.'}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError('bad_response', 'The AI provider returned a response that is not JSON.');
  }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai' as const;
  constructor(private readonly cfg: AiProviderConfig) {}
  get model() {
    return this.cfg.model;
  }
  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    const base = trimSlash(this.cfg.baseUrl ?? DEFAULT_BASE_URLS.openai);
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const data = (await postJson(
      `${base}/chat/completions`,
      headers,
      {
        model: this.cfg.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.2,
      },
      this.cfg.timeoutMs,
    )) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new AiProviderError('bad_response', 'The AI provider returned no message.');
    return { text, model: data.model ?? this.cfg.model, inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null };
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  constructor(private readonly cfg: AiProviderConfig) {}
  get model() {
    return this.cfg.model;
  }
  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    if (!this.cfg.apiKey) throw new AiProviderError('not_configured', 'An Anthropic API key is required.');
    const base = trimSlash(this.cfg.baseUrl ?? DEFAULT_BASE_URLS.anthropic);
    const data = (await postJson(
      `${base}/v1/messages`,
      { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.cfg.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.2,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      },
      this.cfg.timeoutMs,
    )) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    if (!text) throw new AiProviderError('bad_response', 'The AI provider returned no text.');
    return { text, model: data.model ?? this.cfg.model, inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
  }
}

export class OllamaProvider implements AiProvider {
  readonly name = 'ollama' as const;
  constructor(private readonly cfg: AiProviderConfig) {}
  get model() {
    return this.cfg.model;
  }
  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    const base = trimSlash(this.cfg.baseUrl ?? DEFAULT_BASE_URLS.ollama);
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const data = (await postJson(
      `${base}/api/chat`,
      headers,
      {
        model: this.cfg.model,
        stream: false,
        format: 'json',
        options: { num_predict: req.maxTokens, temperature: req.temperature ?? 0.2 },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      },
      this.cfg.timeoutMs,
    )) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; model?: string };
    const text = data.message?.content;
    if (typeof text !== 'string') throw new AiProviderError('bad_response', 'Ollama returned no message.');
    return { text, model: data.model ?? this.cfg.model, inputTokens: data.prompt_eval_count ?? null, outputTokens: data.eval_count ?? null };
  }
}

export const defaultAiFactory: AiProviderFactory = (cfg) => {
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicProvider(cfg);
    case 'ollama':
      return new OllamaProvider(cfg);
    default:
      return new OpenAiCompatibleProvider(cfg);
  }
};

/** Extracts the first JSON object from model output (tolerates code fences and preambles). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AiProviderError('bad_response', 'The AI response did not contain JSON.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiProviderError('bad_response', 'The AI response contained malformed JSON.');
  }
}

export function isLocalUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h) || h === 'host.docker.internal' || h === 'ollama';
  } catch {
    return false;
  }
}
