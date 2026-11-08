/**
 * Request counter for the free-tier Gemini key (AGENTS.md › API budget): every Gemini call in this
 * package goes through `countGemini`, which keeps per-model totals and logs the running numbers.
 */
export interface ModelUsage {
  requests: number;
  /** inputs sent (texts for embeddings, prompts/utterances otherwise) */
  items: number;
  /** 429/503 responses seen */
  throttled: number;
}

const usage = new Map<string, ModelUsage>();
let logger: ((event: string, data: Record<string, unknown>) => void) | null = null;

export function setGeminiUsageLogger(fn: ((event: string, data: Record<string, unknown>) => void) | null): void {
  logger = fn;
}

export function countGemini(model: string, items: number): void {
  const u = usage.get(model) ?? { requests: 0, items: 0, throttled: 0 };
  u.requests++;
  u.items += items;
  usage.set(model, u);
  logger?.('gemini.usage', { model, ...u });
}

export function countGeminiThrottle(model: string): void {
  const u = usage.get(model) ?? { requests: 0, items: 0, throttled: 0 };
  u.throttled++;
  usage.set(model, u);
  logger?.('gemini.throttled', { model, ...u });
}

export function geminiUsage(): Record<string, ModelUsage> {
  return Object.fromEntries([...usage].map(([m, u]) => [m, { ...u }]));
}

export function resetGeminiUsage(): void {
  usage.clear();
}

/** True for HTTP 429 / 503 style errors from @google/genai. */
export function isThrottle(e: unknown): boolean {
  const s = e instanceof Error ? `${e.message} ${(e as { status?: unknown }).status ?? ''}` : String(e);
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(s);
}
