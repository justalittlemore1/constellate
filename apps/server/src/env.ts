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
  INTERPRETER_PROVIDER: z.enum(['gemini', 'anthropic']).default('gemini'),
  /** transcript replay speed; 1 = original timing */
  REPLAY_SPEED: z.coerce.number().positive().default(1),
  /** a live session whose socket dropped without `stop` is stopped after this long */
  ABANDON_AFTER_MS: z.coerce.number().int().positive().default(120_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings from .env files as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  return EnvSchema.parse(cleaned);
}
