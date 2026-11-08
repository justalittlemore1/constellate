import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyBatches } from './ops';
import { emptyGraph } from './domain';
import {
  ClientMsgSchema,
  GraphOpSchema,
  GraphStateSchema,
  OpBatchSchema,
  ServerMsgSchema,
  TranscriptFixtureSchema,
} from './schemas';
import { camelKeys, snakeKeys, toCamel, toSnake } from './db';

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url));
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(fixtures, p), 'utf8'));
const readJsonl = (p: string): unknown[] =>
  readFileSync(join(fixtures, p), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as unknown);

describe('fixtures match the contracts', () => {
  it('graphs/religion-demo.json is a valid GraphState', () => {
    const g = GraphStateSchema.parse(readJson('graphs/religion-demo.json'));
    const kinds = new Set(Object.values(g.nodes).map((n) => n.kind));
    const statuses = new Set(Object.values(g.nodes).map((n) => n.status));
    const edgeKinds = new Set(Object.values(g.edges).map((e) => e.kind));
    expect(kinds).toEqual(new Set(['topic', 'pending', 'parked']));
    expect(statuses).toEqual(new Set(['closed', 'unexplored', 'resolved']));
    expect(edgeKinds).toEqual(new Set(['flow', 'revisit', 'tether']));
  });

  it('ops/religion-demo.jsonl parses and replays exactly into the graph fixture', () => {
    const batches = readJsonl('ops/religion-demo.jsonl').map((b) => OpBatchSchema.parse(b));
    const graph = GraphStateSchema.parse(readJson('graphs/religion-demo.json'));
    // The op log starts from a fresh live conversation; fields the log never changes are taken from the final graph.
    const start = emptyGraph({ ...graph.conversation, title: 'Untitled conversation', summary: null, macroAnchor: null, status: 'live', endedAt: null, durationMs: null, audioPath: null });
    const replayed = applyBatches(start, batches);
    expect(replayed).toEqual(graph);
  });

  it('op batches are in time order with consecutive seq (the mock live player relies on it)', () => {
    const batches = readJsonl('ops/religion-demo.jsonl').map((b) => OpBatchSchema.parse(b));
    batches.forEach((b, i) => {
      expect(b.seq).toBe(i + 1);
      if (i > 0) expect(Date.parse(b.at)).toBeGreaterThanOrEqual(Date.parse(batches[i - 1]!.at));
    });
  });

  it('every transcript fixture is valid and time-ordered', () => {
    const dir = join(fixtures, 'transcripts');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const t = TranscriptFixtureSchema.parse(readJson(join('transcripts', f)));
      for (let i = 1; i < t.utterances.length; i++) {
        expect(t.utterances[i]!.startMs).toBeGreaterThanOrEqual(t.utterances[i - 1]!.startMs);
      }
      for (const u of t.utterances) expect(u.speaker).toBeLessThan(t.speakers.length);
    }
  });
});

describe('commitment.update schema', () => {
  it('accepts text and/or done, nothing else', () => {
    const ok = (patch: unknown) => GraphOpSchema.safeParse({ op: 'commitment.update', id: 'k1', patch }).success;
    expect(ok({ done: true })).toBe(true);
    expect(ok({ text: 'Send the paper' })).toBe(true);
    expect(ok({ text: 'Send the paper', done: false })).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ text: '' })).toBe(false);
    expect(ok({ nodeId: 'n1' })).toBe(false); // only the user-editable fields
    expect(ok({ done: 'yes' })).toBe(false);
    expect(GraphOpSchema.safeParse({ op: 'commitment.update', patch: { done: true } }).success).toBe(false);
  });
});

describe('ws message schemas', () => {
  it('accepts a valid hello and rejects one without consent', () => {
    expect(ClientMsgSchema.safeParse({ t: 'hello', token: 'x', source: 'mic', consent: true }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ t: 'hello', token: 'x', source: 'mic' }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ t: 'hello', token: 'x', source: 'mic', consent: false }).success).toBe(false);
  });

  it('rejects unknown message types and over-long parked thoughts', () => {
    expect(ClientMsgSchema.safeParse({ t: 'nope' }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ t: 'park', text: 'x'.repeat(81), atMs: 1 }).success).toBe(false);
  });

  it('round-trips server messages', () => {
    const msgs = [
      { t: 'ready', conversationId: 'c1' },
      { t: 'caption', text: 'hi', final: false, startMs: 0 },
      { t: 'status', stage: 'thinking' },
      { t: 'error', code: 'stt', message: 'x', fatal: false },
      { t: 'stopped', conversationId: 'c1' },
      { t: 'pong' },
    ];
    for (const m of msgs) expect(ServerMsgSchema.parse(m)).toEqual(m);
  });
});

describe('db key mapping', () => {
  it('converts both ways', () => {
    expect(toSnake('utteranceIds')).toBe('utterance_ids');
    expect(toCamel('mentioned_at_ms')).toBe('mentionedAtMs');
    expect(camelKeys(snakeKeys({ startMs: 1, isFavorite: true }))).toEqual({ startMs: 1, isFavorite: true });
  });
});
