/**
 * Runs before every server test file. Provider credentials are removed from the environment so
 * that a code path which forgot to use a fake fails fast instead of spending real quota.
 *
 * SUPABASE_URL is a public address, not a credential, and stays: rls.test.ts needs it (with the
 * anon key and two test users) to check Row Level Security in CI. The service-role key, which
 * bypasses RLS, is always removed.
 */
export const STRIPPED_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DEEPGRAM_API_KEY',
] as const;

for (const key of STRIPPED_ENV_KEYS) delete process.env[key];
