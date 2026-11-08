/**
 * Runs before every server test file. Provider credentials are removed from the environment so
 * that a code path which forgot to use a fake fails fast instead of spending real quota.
 */
for (const key of [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DEEPGRAM_API_KEY',
]) {
  delete process.env[key];
}
