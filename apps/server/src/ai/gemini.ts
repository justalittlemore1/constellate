/**
 * The ONE place the server talks to Gemini (AGENTS.md → API budget: the key is free-tier).
 *
 * Every call goes through `GeminiGateway`, which
 *  - counts requests per model and logs the running totals (`gemini.request`), so humans can
 *    watch usage; totals are also on GET /health;
 *  - on HTTP 429 puts that model into a cool-down with exponential back-off and throws
 *    `GeminiRateLimitedError` immediately for calls made during it (no request is sent), so
 *    callers degrade instead of hammering the quota.
 *
 * Gemini is used only for live transcription, file transcription and embeddings. All reasoning
 * runs on Claude.
 */
import {
  createPartFromUri,
  type GoogleGenAI,
  type LiveConnectParameters,
  type Part,
  type Session,
} from '@google/genai';
import { MODELS } from '@constellate/shared';

type Log = (event: string, data?: Record<string, unknown>) => void;

export class GeminiRateLimitedError extends Error {
  constructor(
    readonly model: string,
    /** how long the caller should wait before trying again */
    readonly retryAfterMs: number,
  ) {
    super(`Gemini rate limit for ${model}; retry in ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = 'GeminiRateLimitedError';
  }
}

/** True for HTTP 429 / RESOURCE_EXHAUSTED in any of the shapes the SDK and Live socket produce. */
export function isRateLimit(err: unknown): boolean {
  if (err instanceof GeminiRateLimitedError) return true;
  const e = err as { status?: unknown; code?: unknown; message?: unknown; reason?: unknown } | null;
  if (!e || typeof e !== 'object') return typeof err === 'string' && /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(err);
  if (e.status === 429 || e.code === 429) return true;
  const text = `${String(e.message ?? '')} ${String(e.reason ?? '')}`;
  return /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(text);
}

/** A server-suggested delay in the error ("retryDelay": "17s" / "retry in 17.2s"), if any. */
export function suggestedRetryMs(err: unknown): number | null {
  const text = err instanceof Error ? err.message : String((err as { reason?: unknown })?.reason ?? err ?? '');
  const m = /retry(?:Delay"?\s*:\s*"|\s+in\s+)(\d+(?:\.\d+)?)s/i.exec(text);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export interface GeminiUsage {
  /** requests sent, by model (`files.upload` / `files.delete` counted separately) */
  requests: Record<string, number>;
  /** 429 responses, by model */
  rateLimited: Record<string, number>;
  /** models currently cooling down → ms left */
  coolingDown: Record<string, number>;
}

export interface GatewayOptions {
  log?: Log;
  now?: () => number;
  /** first back-off after a 429; doubles per consecutive 429, capped at `maxBackoffMs` */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/** The subset of `GoogleGenAI` the gateway uses (a fake implements it in tests). */
export type GenAiLike = {
  models: Pick<GoogleGenAI['models'], 'embedContent' | 'generateContent' | 'list'>;
  live: Pick<GoogleGenAI['live'], 'connect'>;
  files: Pick<GoogleGenAI['files'], 'upload' | 'delete'>;
};

export class GeminiGateway {
  private readonly requests = new Map<string, number>();
  private readonly limited = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly strikes = new Map<string, number>();
  private readonly log: Log;
  private readonly now: () => number;
  private readonly base: number;
  private readonly max: number;

  constructor(
    private readonly ai: GenAiLike,
    opts: GatewayOptions = {},
  ) {
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.base = opts.baseBackoffMs ?? 5_000;
    this.max = opts.maxBackoffMs ?? 5 * 60_000;
  }

  usage(): GeminiUsage {
    const now = this.now();
    const cooling: Record<string, number> = {};
    for (const [model, until] of this.cooldownUntil) if (until > now) cooling[model] = until - now;
    return {
      requests: Object.fromEntries(this.requests),
      rateLimited: Object.fromEntries(this.limited),
      coolingDown: cooling,
    };
  }

  /** `MODELS.embed` at `MODELS.embedDims`, many texts per request. Raw (not normalised) vectors. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.call(MODELS.embed, () =>
      this.ai.models.embedContent({
        model: MODELS.embed,
        // one Content per text: a bare string array is ONE input with several parts → one vector
        contents: texts.map((text) => ({ role: 'user', parts: [{ text }] })),
        config: { outputDimensionality: MODELS.embedDims },
      }),
    );
    return (res.embeddings ?? []).map((e) => e.values ?? []);
  }

  /** Model ids available to the key (one `models.list` request, counted). */
  async listModels(): Promise<string[]> {
    return this.call('models.list', async () => {
      const names: string[] = [];
      const pager = await this.ai.models.list({ config: { pageSize: 200 } });
      for await (const m of pager) if (m.name) names.push(m.name.replace(/^models\//, ''));
      return names;
    });
  }

  /** One `MODELS.sttLive` session (counted as one request). */
  liveConnect(params: Omit<LiveConnectParameters, 'model'>): Promise<Session> {
    return this.call(MODELS.sttLive, () => this.ai.live.connect({ ...params, model: MODELS.sttLive }));
  }

  /**
   * Upload → `MODELS.sttFile` with diarization + word timestamps (VERBATIM) → delete the upload.
   * Returns the response parts.
   */
  async transcribeFile(audio: Buffer, mimeType: string): Promise<Part[]> {
    const file = await this.call('files.upload', () =>
      this.ai.files.upload({ file: new Blob([new Uint8Array(audio)], { type: mimeType }), config: { mimeType } }),
    );
    if (!file.uri) throw new Error('file upload returned no uri');
    try {
      const res = await this.call(MODELS.sttFile, () =>
        this.ai.models.generateContent({
          model: MODELS.sttFile,
          contents: [createPartFromUri(file.uri!, file.mimeType ?? mimeType)],
          config: { audioTranscriptionConfig: { diarization: true, wordTimestamp: true, mode: 'VERBATIM' as never } },
        }),
      );
      return res.candidates?.[0]?.content?.parts ?? [];
    } finally {
      if (file.name) await this.call('files.delete', () => this.ai.files.delete({ name: file.name! })).catch(() => {});
    }
  }

  /**
   * Report a 429 that arrived outside a request/response (e.g. the Live socket closing with
   * RESOURCE_EXHAUSTED). Starts the cool-down and returns the error to surface.
   */
  noteRateLimited(model: string, err?: unknown): GeminiRateLimitedError {
    const strikes = (this.strikes.get(model) ?? 0) + 1;
    this.strikes.set(model, strikes);
    const backoff = Math.min(this.max, this.base * 2 ** (strikes - 1));
    const wait = Math.max(backoff, suggestedRetryMs(err) ?? 0);
    this.cooldownUntil.set(model, this.now() + wait);
    this.limited.set(model, (this.limited.get(model) ?? 0) + 1);
    this.log('gemini.rate_limited', { model, retryAfterMs: wait, strikes, usage: this.usage() });
    return new GeminiRateLimitedError(model, wait);
  }

  private async call<T>(model: string, fn: () => Promise<T>): Promise<T> {
    const until = this.cooldownUntil.get(model) ?? 0;
    const left = until - this.now();
    if (left > 0) throw new GeminiRateLimitedError(model, left);
    const n = (this.requests.get(model) ?? 0) + 1;
    this.requests.set(model, n);
    this.log('gemini.request', { model, count: n, totals: Object.fromEntries(this.requests) });
    try {
      const out = await fn();
      this.strikes.delete(model);
      return out;
    } catch (err) {
      if (isRateLimit(err)) throw this.noteRateLimited(model, err);
      throw err;
    }
  }
}

/**
 * Unit tests must never reach a real API (AGENTS.md). Real clients are refused under Vitest
 * unless a deliberate live test sets ALLOW_REAL_APIS=1.
 */
export function assertRealApisAllowed(what: string): void {
  if (process.env.VITEST && process.env.ALLOW_REAL_APIS !== '1') {
    throw new Error(`${what}: unit tests must not call real APIs — inject a fake`);
  }
}
