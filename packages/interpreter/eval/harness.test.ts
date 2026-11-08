import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODELS } from '@constellate/shared';
import { createReplayClient, createReplayEmbedder } from '../src/llm';
import { bagEmbed, dec, scriptedLlm, windowIdsOf } from '../src/test-utils';
import type { Decision } from '../src/decision';
import { loadFixtures, outline, renderReport, runFixture, score } from './harness';
import { RECORDINGS } from './recordings-path';

const embed = async (ts: string[]) => ts.map((t) => bagEmbed(t));
const topic = (label: string, starts: string, extra: Partial<NonNullable<Decision['new_topic']>> = {}): Decision =>
  dec({
    action: 'new_topic',
    new_topic: {
      label,
      summary: label,
      level: 1,
      relation: 'sibling_of_active',
      parent_node_id: null,
      starts_at_utterance: starts,
      explicit_shift: true,
      ...extra,
    },
  });

/** An "oracle" answering from a table keyed by utterance; the latest keyed utterance in the window wins. */
function oracle(table: Record<string, Decision>, fallback: Decision = dec({ action: 'continue' })) {
  return scriptedLlm((a) => {
    const ids = windowIdsOf(a.user);
    const key = [...ids].reverse().find((id) => table[id]);
    return key ? table[key] : fallback;
  });
}

describe('eval harness scoring', () => {
  const [f01, , f03, f04, , f06] = loadFixtures(['01', '02', '03', '04', '05', '06']);

  it('a correct decision sequence passes 01 (simple shift)', async () => {
    const run = await runFixture(
      f01!,
      oracle({
        u1: { ...topic('Canucks Game', 'u1'), macro_anchor: 'Catching up' },
        u6: topic('Friday Concert', 'u6'),
      }),
      embed,
      'test',
    );
    const s = score(run);
    expect(s.checks.filter((c) => !c.pass)).toEqual([]);
    expect(s.pass).toBe(true);
    expect(outline(run.state)).toContain('[L1] Friday Concert');
  });

  it('a late boundary fails 01', async () => {
    const run = await runFixture(
      f01!,
      oracle({ u1: topic('Canucks Game', 'u1'), u9: topic('Friday Concert', 'u9') }),
      embed,
      'test',
    );
    const s = score(run);
    expect(s.pass).toBe(false);
    expect(s.checks.find((c) => c.name === 'boundaries')!.pass).toBe(false);
  });

  it('revisit and same-thread checks pass for a correct 03 run', async () => {
    const run = await runFixture(
      f03!,
      oracle({
        u1: topic('Free Will', 'u1'),
        u8: topic('Job Offer', 'u8'),
        u16: dec({
          action: 'revisit',
          revisit: { node_id: 'n1', starts_at_utterance: 'u16', label: null, summary: 'free will again' },
        }),
      }),
      embed,
      'test',
    );
    const s = score(run);
    expect(s.checks.filter((c) => !c.pass)).toEqual([]);
    expect(s.revisitOk).toBe(true);
  });

  it('a pending thread that is never resolved passes 04; a missing one fails', async () => {
    const good = await runFixture(
      f04!,
      // the marker in u4 closes the first window (u1–u4), so the deferral arrives with the first topic
      oracle({
        u1: {
          ...topic('Camping Trip', 'u1'),
          intentions: [{ kind: 'deferred_topic', label: 'Soccer Story', quote_utterance: 'u4' }],
        },
      }),
      embed,
      'test',
    );
    expect(score(good).pass).toBe(true);
    const bad = await runFixture(f04!, oracle({ u1: topic('Camping Trip', 'u1') }), embed, 'test');
    expect(score(bad).pass).toBe(false);
  });

  it('a joke that the commit gate folds back passes 06', async () => {
    const run = await runFixture(
      f06!,
      oracle({
        u1: topic('Orgo Final Studying', 'u1'),
        u9: topic('Pigeon', 'u9', { explicit_shift: false, level: 2, relation: 'child_of_active' }),
        u12: dec({
          action: 'revisit',
          revisit: { node_id: 'n1', starts_at_utterance: 'u12', label: null, summary: 'back to studying' },
        }),
      }),
      embed,
      'test',
    );
    const s = score(run);
    expect(s.checks.filter((c) => !c.pass)).toEqual([]);
  });

  it('renders a report with the summary table and outlines', async () => {
    const run = await runFixture(
      f01!,
      oracle({ u1: topic('Canucks Game', 'u1'), u6: topic('Friday Concert', 'u6') }),
      embed,
      'test',
    );
    const md = renderReport({ provider: 'test', model: 'test', mode: 'scripted', runs: [run], scores: [score(run)] });
    expect(md).toContain('Scenarios passed: 1/1');
    expect(md).toContain('| 01-simple-shift | pass |');
    expect(md).toContain('```');
  });
});

// Deterministic replay of the committed recordings (no API keys). Runs in CI via `pnpm test`.
describe('eval replay', () => {
  const models = [MODELS.interpreter.gemini, MODELS.interpreter.anthropic].filter((m) =>
    existsSync(join(RECORDINGS, m.replace(/[^a-zA-Z0-9._-]/g, '_'))),
  );
  it.runIf(models.length === 0)('has no recordings yet (skipped)', () => {
    expect(existsSync(RECORDINGS) ? readdirSync(RECORDINGS).length >= 0 : true).toBe(true);
  });
  for (const model of models) {
    it(`replays every fixture for ${model} without a cache miss`, async () => {
      const llm = createReplayClient(null, RECORDINGS, 'replay');
      const emb = createReplayEmbedder(null, RECORDINGS, 'replay');
      for (const f of loadFixtures()) {
        const run = await runFixture(f, llm, emb, model);
        expect(run.error, f.id).toBeNull();
        expect(
          run.records.every((r) => !r.error?.includes('no recording')),
          f.id,
        ).toBe(true);
      }
    }, 120_000);
  }
});
