import { describe, expect, it } from 'vitest';
import { MODELS } from '@constellate/shared';
import { checkHealth } from './deploy-check';

const healthy = {
  ok: true,
  interpreter: 'anthropic',
  sttFile: 'unavailable',
  embeddings: 'gemini',
  gemini: { today: { day: '2026-11-08', requests: { 'models.list': 1 } }, caps: { [MODELS.embed]: 500 } },
  keys: { gemini: true, anthropic: true, supabase: true },
};

describe('deploy check: /health', () => {
  it('passes a healthy production server', () => {
    expect(checkHealth(healthy).filter((c) => !c.ok)).toEqual([]);
  });

  it('flags each misconfiguration the first Render run could have', () => {
    const failed = (h: Record<string, unknown>) =>
      checkHealth(h)
        .filter((c) => !c.ok)
        .map((c) => c.label);
    expect(failed({ ...healthy, embeddings: 'local' })).toEqual(['real embeddings']);
    expect(checkHealth({ ...healthy, embeddings: 'local' }).find((c) => !c.ok)?.detail).toMatch(/NODE_ENV=production/);
    expect(failed({ ...healthy, interpreter: 'gemini' })).toEqual(['reasoning on Claude']);
    expect(failed({ ...healthy, sttFile: 'checking' })).toEqual(['file-transcription probe finished']);
    expect(failed({ ...healthy, gemini: null })).toEqual([
      'gemini.today reported (per Pacific day)',
      'embedding cap 500/day',
    ]);
    expect(failed({ ...healthy, keys: { gemini: true, anthropic: false, supabase: true } })).toEqual([
      'ANTHROPIC_API_KEY set',
    ]);
  });
});
