/**
 * Test harness shared by the server's test files: an in-memory app with fake auth, a stub
 * interpreter and controllable speech adapters. Not used in production code.
 */
import type { FastifyInstance } from 'fastify';
import {
  AUDIO_BYTES_PER_MS,
  placeNode,
  ServerMsgSchema,
  type CreateLiveInterpreter,
  type GraphOp,
  type ServerMsg,
  type TopicNode,
} from '@constellate/shared';
import { buildApp } from './app';
import type { ServerDeps } from './deps';
import { loadEnv } from './env';
import { FakeAdapter } from './speech/fake';
import { TranscriptReplayAdapter } from './speech/replay';
import { MemoryStore } from './store/memory';
import type { Auth } from './supabase';

export const USER_A = 'a0000000-0000-4000-8000-00000000000a';
export const USER_B = 'b0000000-0000-4000-8000-00000000000b';
export const TOKENS: Record<string, string> = { 'token-a': USER_A, 'token-b': USER_B };
export const fakeAuth: Auth = { verifyToken: async (t) => TOKENS[t] ?? null };

/**
 * Stub interpreter with the real contract: one topic node per utterance that contains "NEW",
 * otherwise evidence is appended to the active node; park → pending node; stop → close + unexplored.
 */
export const stubInterpreter: CreateLiveInterpreter = (deps) => {
  let seq = 0;
  const add = (node: Omit<TopicNode, 'x' | 'y' | 'seq'>, extra: GraphOp[] = []) => {
    const state = deps.getState();
    seq = Math.max(seq, ...Object.values(state.nodes).map((n) => n.seq)) + 1;
    const pos = placeNode(state, node);
    deps.emit([{ op: 'node.add', node: { ...node, seq, ...pos } }, ...extra]);
  };
  return {
    pushUtterance(u) {
      const state = deps.getState();
      const active = state.activeNodeId ? state.nodes[state.activeNodeId] : undefined;
      if (!active || u.text.includes('NEW')) {
        const id = deps.newId();
        const ops: GraphOp[] = [{ op: 'active.set', nodeId: id }];
        if (active) {
          deps.emit([{ op: 'node.update', id: active.id, patch: { status: 'closed', endMs: u.startMs } }]);
          ops.push({
            op: 'edge.add',
            edge: {
              id: deps.newId(),
              conversationId: deps.conversationId,
              sourceId: active.id,
              targetId: id,
              kind: 'flow',
            },
          });
        }
        add(
          {
            id,
            conversationId: deps.conversationId,
            kind: 'topic',
            status: 'active',
            level: 1,
            label: `Topic ${u.id}`,
            summary: u.text.slice(0, 140),
            details: null,
            parentId: null,
            threadId: deps.newId(),
            startMs: u.startMs,
            endMs: null,
            mentionedAtMs: null,
            utteranceIds: [u.id],
            speakers: [],
            highlighted: false,
            createdBy: 'ai',
          },
          ops,
        );
        void deps
          .embed([u.text])
          .then(([e]) => e && deps.saveEmbedding(id, e))
          .catch(() => {});
      } else {
        deps.emit([{ op: 'node.update', id: active.id, patch: { utteranceIds: [...active.utteranceIds, u.id] } }]);
      }
    },
    park(text, atMs) {
      add({
        id: deps.newId(),
        conversationId: deps.conversationId,
        kind: 'parked',
        status: 'unexplored',
        level: 1,
        label: text.split(/\s+/).slice(0, 4).join(' '),
        summary: text,
        details: null,
        parentId: null,
        threadId: deps.newId(),
        startMs: atMs,
        endMs: null,
        mentionedAtMs: atMs,
        utteranceIds: [],
        speakers: [],
        highlighted: false,
        createdBy: 'user',
      });
    },
    async stop() {
      const s = deps.getState();
      if (s.activeNodeId) {
        deps.emit([
          { op: 'node.update', id: s.activeNodeId, patch: { status: 'closed', endMs: deps.nowMs() } },
          { op: 'active.set', nodeId: null },
        ]);
      }
    },
  };
};

export interface Harness {
  app: FastifyInstance;
  store: MemoryStore;
  adapters: FakeAdapter[];
  deps: Partial<ServerDeps>;
}

export async function makeHarness(over: Partial<ServerDeps> = {}): Promise<Harness> {
  const store = new MemoryStore();
  const adapters: FakeAdapter[] = [];
  const deps: Partial<ServerDeps> = {
    store,
    auth: fakeAuth,
    createInterpreter: stubInterpreter,
    embed: async (texts) => texts.map((t) => unitVector(t)),
    createSpeech: (req) => {
      if (req.source === 'replay-transcript')
        return new TranscriptReplayAdapter(req.fixture!, { speed: 200, fromMs: req.fromMs });
      const a = new FakeAdapter();
      adapters.push(a);
      return a;
    },
    replaySpeed: 200,
    abandonAfterMs: 60_000,
    // finalisation runs only when a test asks for it (POST /finalize or its own onStopped)
    onStopped: () => {},
    transcribeFile: null,
    waitForRecordingMs: 0,
    ...over,
  };
  const app = await buildApp(loadEnv({ LOG_LEVEL: 'silent' }), deps);
  await app.ready();
  return { app, store, adapters, deps };
}

/** deterministic 768-d unit vector from text (bag of character codes) */
export function unitVector(text: string, dims = 768): number[] {
  const v = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % dims]! += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export interface TestClient {
  messages: ServerMsg[];
  send(msg: unknown): void;
  sendAudio(bytes: number): void;
  waitFor<T extends ServerMsg['t']>(
    t: T,
    pred?: (m: Extract<ServerMsg, { t: T }>) => boolean,
    timeoutMs?: number,
  ): Promise<Extract<ServerMsg, { t: T }>>;
  closed: Promise<number>;
  close(): void;
}

export async function connect(app: FastifyInstance): Promise<TestClient> {
  const ws = await app.injectWS('/live');
  const messages: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (data: Buffer) => {
    messages.push(ServerMsgSchema.parse(JSON.parse(data.toString('utf8'))));
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code: number) => resolve(code)));
  return {
    messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendAudio: (bytes) => ws.send(Buffer.alloc(bytes)),
    closed,
    close: () => ws.terminate(),
    waitFor(t, pred = () => true, timeoutMs = 3_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${t}; got ${JSON.stringify(messages.map((m) => m.t))}`)),
          timeoutMs,
        );
        const check = () => {
          const found = messages.find((m) => m.t === t && pred(m as never));
          if (found) {
            clearTimeout(timer);
            resolve(found as never);
          } else waiters.push(check);
        };
        check();
      });
    },
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await tick(5);
  }
}

/**
 * Records a short conversation through the real live path: three utterances on two topics,
 * then stop. Returns its id and the live utterances.
 */
export async function recordConversation(h: Harness, token = 'token-a'): Promise<string> {
  const c = await connect(h.app);
  c.send({ t: 'hello', token, source: 'mic', consent: true });
  const { conversationId } = await c.waitFor('ready');
  const fake = h.adapters.at(-1)!;
  c.sendAudio(AUDIO_BYTES_PER_MS * 9_000);
  fake.emit({ text: 'Did you see the hockey game', startMs: 0, endMs: 3_000 });
  fake.emit({ text: 'The goalie was amazing', startMs: 3_000, endMs: 5_000 });
  fake.emit({ text: 'NEW are you going to the concert', startMs: 5_500, endMs: 9_000 });
  await c.waitFor('caption', (m) => m.final && m.utteranceId === 'u3');
  c.send({ t: 'stop' });
  await c.waitFor('stopped');
  return conversationId;
}
