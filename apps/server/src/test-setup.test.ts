import { describe, expect, it } from 'vitest';
import { STRIPPED_ENV_KEYS } from './test-setup';

describe('test environment', () => {
  it('strips every provider credential (incl. the RLS-bypassing service key) but keeps SUPABASE_URL for rls.test.ts', () => {
    for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      expect(STRIPPED_ENV_KEYS).toContain(key);
      expect(process.env[key]).toBeUndefined();
    }
    expect(STRIPPED_ENV_KEYS).not.toContain('SUPABASE_URL');
  });
});
