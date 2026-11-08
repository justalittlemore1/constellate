import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReplayClient, createReplayEmbedder, newReplayStore } from './replay';
import { scriptedLlm } from '../test-utils';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'replay-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const args = { system: 's', user: 'u', schema: {}, model: 'm', timeoutMs: 1 };

describe('replay', () => {
  it('records then replays an LLM answer without calling the inner client', async () => {
    const dir = tmp();
    const inner = scriptedLlm(() => ({ ok: 1 }));
    await createReplayClient(inner, dir, 'record').json(args);
    const store = newReplayStore();
    const r = await createReplayClient(null, dir, 'replay', store).json<{ ok: number }>(args);
    expect(r.data.ok).toBe(1);
    expect(inner.calls).toHaveLength(1);
    expect(store.misses).toBe(0);
    expect(store.used.size).toBe(1);
  });

  it('counts LLM and embedding misses in replay mode', async () => {
    const dir = tmp();
    const store = newReplayStore();
    await expect(createReplayClient(null, dir, 'replay', store).json(args)).rejects.toThrow(/no recording/);
    await expect(createReplayEmbedder(null, dir, 'replay', store)(['a', 'b'])).rejects.toThrow(
      /no embedding recording/,
    );
    expect(store.misses).toBe(3);
  });

  it('records and replays embeddings per text', async () => {
    const dir = tmp();
    await createReplayEmbedder(async (ts) => ts.map(() => [0.5, 0.5]), dir, 'record')(['x']);
    const store = newReplayStore();
    expect(await createReplayEmbedder(null, dir, 'replay', store)(['x'])).toEqual([[0.5, 0.5]]);
    expect(store.misses).toBe(0);
  });
});
