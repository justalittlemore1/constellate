import { z } from 'zod';

/**
 * Server configuration. Keys are optional so `/health` and the test suite run without secrets;
 * the live pipeline must check for the keys it needs and fail with a clear `error` message.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('*'),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  STT_PROVIDER: z.enum(['gemini-live', 'deepgram']).default('gemini-live'),
  /**
   * All reasoning runs on Claude (AGENTS.md → API budget: the Gemini key is free-tier and has no
   * room for text models). 'gemini' is still accepted from old .env files but resolves to
   * 'anthropic'; `requestedInterpreterProvider` keeps what was asked for so startup can warn.
   */
  INTERPRETER_PROVIDER: z
    .enum(['gemini', 'anthropic'])
    .default('anthropic')
    .transform(() => 'anthropic' as const),
  /**
   * Post-recording diarized re-transcription with MODELS.sttFile. `auto` (default) checks
   * `models.list` once at startup and uses it only if the key has it — ours does not, so
   * finalisation keeps the live transcript (speakers stay empty) and the Claude refine still runs.
   */
  STT_FILE: z.enum(['auto', 'on', 'off']).default('auto'),
  /** embeddings disk cache (JSON lines); "off" keeps it in memory only */
  EMBED_CACHE_FILE: z.string().optional(),
  /** transcript replay speed; 1 = original timing */
  REPLAY_SPEED: z.coerce.number().positive().default(1),
  /** a live session whose socket dropped without `stop` is stopped after this long */
  ABANDON_AFTER_MS: z.coerce.number().int().positive().default(120_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof EnvSchema> & { requestedInterpreterProvider: string | undefined };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings from .env files as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  return { ...EnvSchema.parse(cleaned), requestedInterpreterProvider: cleaned.INTERPRETER_PROVIDER };
}

/**
 * The interpreter package reads INTERPRETER_PROVIDER from process.env (and falls back to Gemini
 * when it is unset), so the server pins it to Claude before any interpreter is created.
 */
export function forceClaudeReasoning(env: Env, warn: (msg: string) => void = () => {}): void {
  if (env.requestedInterpreterProvider && env.requestedInterpreterProvider !== 'anthropic') {
    warn(
      `INTERPRETER_PROVIDER=${env.requestedInterpreterProvider} ignored: all reasoning runs on Claude (the Gemini key is free-tier)`,
    );
  }
  process.env.INTERPRETER_PROVIDER = 'anthropic';
}
