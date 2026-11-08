import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReplayClient,
  createReplayEmbedder,
  dequantise,
  embeddingsFile,
  llmFile,
  newReplayStore,
  pruneUnused,
  quantise,
} from './replay';
import { bagEmbed, scriptedLlm } from '../test-utils';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'replay-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const args = (user = 'u') => ({ system: 's', user, schema: {}, model: 'claude-test', timeoutMs: 1 });
const lines = (f: string) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);

describe('replay recordings', () => {
  it('records an LLM answer once, then replays it with no inner call', async () => {
    const dir = tmp();
    const inner = scriptedLlm(() => ({ ok: 1 }));
    const rec = newReplayStore();
    await createReplayClient(inner, dir, 'auto', rec).json(args());
    await createReplayClient(inner, dir, 'auto', rec).json(args());
    expect(inner.calls).toHaveLength(1);
    expect(rec.calls).toBe(1);
    const rs = newReplayStore();
    const r = await createReplayClient(null, dir, 'replay', rs).json<{ ok: number }>(args());
    expect(r.data.ok).toBe(1);
    expect(rs.misses).toBe(0);
    expect(lines(llmFile(dir, 'claude-test'))).toHaveLength(1);
  });

  it('counts misses in replay mode for LLM calls and embeddings', async () => {
    const dir = tmp();
    const rs = newReplayStore();
    await expect(createReplayClient(null, dir, 'replay', rs).json(args())).rejects.toThrow(/no recording/);
    await expect(createReplayEmbedder(null, dir, 'replay', rs)(['a', 'b', 'a'])).rejects.toThrow(
      /no embedding recording/,
    );
    expect(rs.misses).toBe(3);
  });

  it('batches embedding misses into one request and returns the same quantised vectors on replay', async () => {
    const dir = tmp();
    const batches: string[][] = [];
    const rec = newReplayStore();
    const embed = createReplayEmbedder(
      async (ts) => (batches.push(ts), ts.map((t) => bagEmbed(t, 768))),
      dir,
      'auto',
      rec,
    );
    const first = await embed(['alpha beta', 'gamma', 'alpha beta']);
    expect(batches).toEqual([['alpha beta', 'gamma']]);
    const again = await embed(['gamma', 'delta']);
    expect(batches[1]).toEqual(['delta']);
    const replayed = await createReplayEmbedder(null, dir, 'replay', newReplayStore())(['alpha beta', 'gamma']);
    expect(replayed).toEqual([first[0], again[0]]);
    expect(lines(embeddingsFile(dir))).toHaveLength(3);
  });

  it('quantisation keeps cosine similarity within 0.002', () => {
    const a = bagEmbed('the quick brown fox jumps', 768);
    const b = bagEmbed('a quick brown dog sleeps', 768);
    const exact = a.reduce((s, x, i) => s + x * b[i]!, 0);
    const qa = dequantise(quantise(a));
    const qb = dequantise(quantise(b));
    const approx = qa.reduce((s, x, i) => s + x * qb[i]!, 0);
    expect(Math.abs(exact - approx)).toBeLessThan(0.002);
  });

  it('pruneUnused drops entries a run did not use', async () => {
    const dir = tmp();
    const inner = scriptedLlm(() => ({}));
    await createReplayClient(inner, dir, 'auto').json(args('old'));
    const rs = newReplayStore();
    await createReplayClient(inner, dir, 'auto', rs).json(args('new'));
    expect(lines(llmFile(dir, 'claude-test'))).toHaveLength(2);
    pruneUnused(rs);
    expect(lines(llmFile(dir, 'claude-test'))).toHaveLength(1);
  });

  it('pruneUnused keeps embeddings unless asked', async () => {
    const dir = tmp();
    await createReplayEmbedder(async (ts) => ts.map(() => [1, 0]), dir, 'auto')(['old']);
    const rs = newReplayStore();
    await createReplayEmbedder(async (ts) => ts.map(() => [0, 1]), dir, 'auto', rs)(['new']);
    pruneUnused(rs);
    expect(lines(embeddingsFile(dir))).toHaveLength(2);
    pruneUnused(rs, { embeddings: true });
    expect(lines(embeddingsFile(dir))).toHaveLength(1);
  });

  it('request settings are part of the key', async () => {
    const dir = tmp();
    const inner = scriptedLlm(() => ({}));
    await createReplayClient(inner, dir, 'auto', newReplayStore(), () => ({ thinking: 'off' })).json(args());
    await createReplayClient(inner, dir, 'auto', newReplayStore(), () => ({ thinking: 'adaptive' })).json(args());
    expect(inner.calls).toHaveLength(2);
  });
});
