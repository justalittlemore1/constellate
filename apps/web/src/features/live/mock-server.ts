/**
 * In-browser stand-in for the live gateway (VITE_USE_MOCKS=1). It speaks the real protocol:
 * client frames are validated with ClientMsgSchema, server frames are serialised to JSON and
 * parsed back through `parseServerFrame`, and its own state is built with `applyOps`.
 *
 * It replays the recorded op stream (`loadDemoOps()`) on the gaps between their `at` times
 * (optionally faster), emits captions derived from each new node's summary, and handles
 * flag / park / stop like the server does. Fixture data only — never used outside mock mode.
 */
import {
  ClientMsgSchema,
  applyOps,
  emptyGraph,
  placeNode,
  topicAt,
  type ClientMsg,
  type Conversation,
  type GraphOp,
  type GraphState,
  type OpBatch,
  type OpSource,
  type ServerMsg,
  type TopicNode,
} from '@constellate/shared';
import { parseServerFrame, type LiveTransport, type TransportFactory, type TransportHandlers } from './transport';

export interface MockServerOptions {
  ops: OpBatch[];
  /** the graph the op stream ends in (its conversation supplies the starting metadata) */
  finalGraph: GraphState;
  /** replay speed: 1 = real time, 4 = four times faster */
  speed?: number;
  newId?: () => string;
}

/** Conversation fields patched by the op stream are reset to how a fresh live conversation looks. */
export function startingConversation(finalGraph: GraphState, ops: readonly OpBatch[]): Conversation {
  const fresh: Partial<Conversation> = {
    title: 'Untitled conversation',
    summary: null,
    macroAnchor: null,
    status: 'live',
    endedAt: null,
    durationMs: null,
    audioPath: null,
  };
  const conv: Conversation = { ...finalGraph.conversation };
  for (const b of ops) {
    for (const op of b.ops) {
      if (op.op !== 'conversation.update') continue;
      for (const key of Object.keys(op.patch) as (keyof Conversation)[]) {
        if (key in fresh) (conv as unknown as Record<string, unknown>)[key] = fresh[key];
      }
    }
  }
  return conv;
}

const CAPTION_LEAD_MS = 2400;
const CAPTION_WORD_MS = 160;
const FINALIZE_DELAY_MS = 1500;

export class MockLiveServer {
  state: GraphState;
  /** binary frames received (tests) */
  audioFrames = 0;
  /** every valid client message received (tests) */
  readonly received: ClientMsg[] = [];

  private readonly speed: number;
  private readonly t0: number;
  private readonly newId: () => string;
  private sink: TransportHandlers | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private started = false;
  private stopped = false;
  private startWall = 0;
  private seq = 0;

  constructor(private readonly opts: MockServerOptions) {
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.state = emptyGraph(startingConversation(opts.finalGraph, opts.ops));
    this.t0 = Date.parse(this.state.conversation.startedAt);
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  get conversationId(): string {
    return this.state.conversation.id;
  }

  /** current server-side state, as GET /conversations/:id would return it */
  fetchGraph = async (id: string): Promise<GraphState> => {
    if (id !== this.conversationId) throw new Error('conversation not found');
    return structuredClone(this.state);
  };

  transport: TransportFactory = (h) => {
    const conn: LiveTransport = {
      send: (msg) => {
        if (this.sink === h) this.receive(JSON.stringify(msg), h);
      },
      sendAudio: () => {
        if (this.sink === h) this.audioFrames++;
      },
      close: () => {
        if (this.sink === h) this.sink = null;
      },
    };
    this.sink = h;
    setTimeout(() => {
      if (this.sink === h) h.onOpen();
    }, 0);
    return conn;
  };

  /** simulate the network dropping (tests): the client sees an abnormal close */
  drop(): void {
    const h = this.sink;
    this.sink = null;
    h?.onClose({ code: 1006, reason: 'network' });
  }

  /** re-send a batch the client already has, as a flaky network might (tests) */
  resend(batch: OpBatch): void {
    this.post({ t: 'ops', batch });
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.sink = null;
  }

  // ── protocol ─────────────────────────────────────────────────────────────

  private post(msg: ServerMsg): void {
    const h = this.sink;
    const wire = JSON.stringify(msg);
    setTimeout(() => {
      if (this.sink !== h || !h) return;
      const parsed = parseServerFrame(wire);
      if (parsed) h.onMessage(parsed);
    }, 0);
  }

  private closeSink(code: number, reason: string): void {
    const h = this.sink;
    setTimeout(() => {
      if (this.sink !== h || !h) return;
      this.sink = null;
      h.onClose({ code, reason });
    }, 0);
  }

  private receive(raw: string, h: TransportHandlers): void {
    const parsed = ClientMsgSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.post({ t: 'error', code: 'protocol', message: 'invalid message', fatal: true });
      this.closeSink(1008, 'invalid message');
      return;
    }
    const msg = parsed.data;
    this.received.push(msg);
    switch (msg.t) {
      case 'hello':
        if (msg.conversationId && msg.conversationId !== this.conversationId) {
          this.post({ t: 'error', code: 'auth', message: 'conversation not found', fatal: true });
          this.closeSink(1008, 'conversation not found');
          return;
        }
        this.sink = h;
        this.post({ t: 'ready', conversationId: this.conversationId });
        this.post({ t: 'status', stage: this.stopped ? 'finalizing' : 'listening' });
        if (!this.started) this.start();
        return;
      case 'ping':
        this.post({ t: 'pong' });
        return;
      case 'flag': {
        const atMs = Math.max(0, Math.min(msg.atMs, this.nowMs()));
        this.emit([
          {
            op: 'flag.add',
            flag: {
              id: this.newId(),
              conversationId: this.conversationId,
              atMs,
              nodeId: topicAt(this.state, atMs)?.id ?? null,
              note: msg.note ?? null,
              source: msg.source,
            },
          },
        ]);
        return;
      }
      case 'park':
        this.emit(this.parkOps(msg.text, msg.atMs));
        return;
      case 'stop':
        this.finish(true);
        return;
    }
  }

  private nowMs(): number {
    return this.started ? (Date.now() - this.startWall) * this.speed : 0;
  }

  private emit(ops: GraphOp[], source: OpSource = 'live'): void {
    const batch: OpBatch = {
      conversationId: this.conversationId,
      seq: ++this.seq,
      at: new Date(this.t0 + this.nowMs()).toISOString(),
      source,
      ops,
    };
    this.state = applyOps(this.state, batch);
    this.post({ t: 'ops', batch });
  }

  private parkOps(text: string, atMs: number): GraphOp[] {
    const id = this.newId();
    const seq = Object.values(this.state.nodes).reduce((m, n) => Math.max(m, n.seq), 0) + 1;
    const base: TopicNode = {
      id,
      conversationId: this.conversationId,
      kind: 'parked',
      status: 'unexplored',
      level: 1,
      label: text.length > 32 ? `${text.slice(0, 31)}…` : text,
      summary: `Parked by you: ${text}`,
      details: null,
      parentId: null,
      threadId: this.newId(),
      seq,
      startMs: atMs,
      endMs: null,
      mentionedAtMs: atMs,
      utteranceIds: [],
      speakers: [],
      highlighted: false,
      createdBy: 'user',
      x: 0,
      y: 0,
    };
    const node = { ...base, ...placeNode(this.state, base) };
    const ops: GraphOp[] = [{ op: 'node.add', node }];
    const anchor = this.state.activeNodeId;
    if (anchor) {
      ops.push({
        op: 'edge.add',
        edge: { id: this.newId(), conversationId: this.conversationId, sourceId: anchor, targetId: id, kind: 'tether' },
      });
    }
    return ops;
  }

  // ── replay ───────────────────────────────────────────────────────────────

  private at(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, Math.max(0, ms / this.speed)));
  }

  private start(): void {
    this.started = true;
    this.startWall = Date.now();
    const live = this.opts.ops.filter((b) => b.source === 'live');
    const rest = this.opts.ops.filter((b) => b.source !== 'live');
    for (const b of live) {
      const offset = Date.parse(b.at) - this.t0;
      this.scheduleCaptions(b, offset);
      this.at(offset, () => this.emit(b.ops, b.source));
    }
    const last = live.at(-1);
    const end = last ? Date.parse(last.at) - this.t0 : 0;
    // the recorded conversation ends here: finalise like the server would after `stop`
    this.at(end + 1, () => this.finish(false, rest));
  }

  private scheduleCaptions(b: OpBatch, offset: number): void {
    for (const op of b.ops) {
      if (op.op !== 'node.add' || op.node.kind === 'parked' || !op.node.summary) continue;
      const words = op.node.summary.split(/\s+/);
      const begin = Math.max(0, offset - CAPTION_LEAD_MS);
      const step = Math.min(CAPTION_WORD_MS, (offset - begin) / Math.max(1, words.length));
      words.forEach((_, i) => {
        if (i === words.length - 1) return;
        this.at(begin + i * step, () =>
          this.post({ t: 'caption', text: words.slice(0, i + 1).join(' '), final: false, startMs: begin }),
        );
      });
      this.at(offset - 1, () =>
        this.post({
          t: 'caption',
          text: op.node.summary,
          final: true,
          startMs: begin,
          utteranceId: op.node.utteranceIds[0],
        }),
      );
    }
  }

  /** stop: either asked by the client, or the recorded stream reached its end */
  private finish(byClient: boolean, rest: OpBatch[] = []): void {
    if (this.stopped) return;
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.post({ t: 'status', stage: 'finalizing' });
    if (byClient && this.state.conversation.status === 'live') {
      const durationMs = Math.round(this.nowMs());
      this.emit([
        {
          op: 'conversation.update',
          patch: { status: 'processing', endedAt: new Date(this.t0 + durationMs).toISOString(), durationMs },
        },
      ]);
    }
    const after = byClient ? [] : rest;
    this.timers.push(
      setTimeout(() => {
        for (const b of after) this.emit(b.ops, b.source);
        this.post({ t: 'stopped', conversationId: this.conversationId });
        this.closeSink(1000, 'stopped');
      }, FINALIZE_DELAY_MS / this.speed),
    );
  }
}
