import {
  OpError,
  topicAt,
  type ClientMsg,
  type CreateLiveInterpreter,
  type LiveInterpreter,
  type LiveSource,
  type LiveStage,
  type Ms,
  type ServerMsg,
  type TranscriptFixture,
  type Utterance,
} from '@constellate/shared';
import type { Embedder } from '../ai/embed';
import type { GraphCell, GraphHub } from '../graph/hub';
import type { Auth } from '../supabase';
import type { SpeechAdapter, SpeechEvents, SpeechSegment } from '../speech/types';
import type { Store } from '../store/types';
import { AudioClock } from './clock';
import { parseClientFrame } from './protocol';

export type Log = (event: string, data?: Record<string, unknown>) => void;

/** What a live session writes to: one WebSocket. */
export interface LiveSink {
  send(msg: ServerMsg): void;
  close(code?: number, reason?: string): void;
}

export interface SpeechRequest {
  source: LiveSource;
  fixture?: TranscriptFixture;
  nowMs(): Ms;
  /** resume point on the audio clock: replay skips utterances that ended before it */
  fromMs: Ms;
  events: SpeechEvents;
}

export class SpeechUnavailableError extends Error {}

export interface LiveDeps {
  store: Store;
  auth: Auth;
  hub: GraphHub;
  registry: LiveRegistry;
  createInterpreter: CreateLiveInterpreter;
  embed: Embedder;
  /** throws SpeechUnavailableError if the source cannot be served (e.g. no provider key) */
  createSpeech(req: SpeechRequest): SpeechAdapter;
  loadFixture(id: string): Promise<TranscriptFixture>;
  newId(): string;
  /** transcript replay speed (1 = real time; tests go faster) */
  replaySpeed: number;
  /** a detached session (socket dropped without `stop`) is stopped after this long */
  abandonAfterMs: number;
  /** called once a conversation has stopped and its last batch is persisted */
  onStopped?(conversationId: string, userId: string): void;
  log: Log;
}

/** Live sessions by conversation id, so a reconnecting client re-attaches to its session. */
export class LiveRegistry {
  readonly sessions = new Map<string, LiveSession>();
}

const errorMsg = (code: Extract<ServerMsg, { t: 'error' }>['code'], message: string, fatal: boolean): ServerMsg => ({
  t: 'error',
  code,
  message,
  fatal,
});

/**
 * One WebSocket. Validates frames, handles `hello` (auth, consent, create/resume) and then
 * forwards everything to the conversation's LiveSession. Frames are processed strictly in order.
 */
export class LiveConnection {
  private chain: Promise<void> = Promise.resolve();
  private session: LiveSession | null = null;
  private greeted = false;
  private closed = false;

  constructor(
    private readonly sink: LiveSink,
    private readonly deps: LiveDeps,
  ) {}

  onText(raw: string): void {
    this.enqueue(() => this.handleText(raw));
  }

  onBinary(pcm: Buffer): void {
    this.enqueue(async () => {
      if (!this.session) return this.fatal(errorMsg('protocol', 'send hello before audio', true));
      this.session.pushAudio(pcm);
    });
  }

  onClose(): void {
    this.closed = true;
    this.enqueue(async () => this.session?.detach(this.sink));
  }

  /** resolves once every frame received so far has been handled (tests) */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<void> | void): void {
    this.chain = this.chain
      .then(fn)
      .catch((err) =>
        this.deps.log('live.connection_error', { message: err instanceof Error ? err.message : String(err) }),
      );
  }

  private fatal(msg: ServerMsg): void {
    this.sink.send(msg);
    this.sink.close(1008, msg.t === 'error' ? msg.message : 'closing');
    this.closed = true;
  }

  private async handleText(raw: string): Promise<void> {
    if (this.closed) return;
    const parsed = parseClientFrame(raw);
    if (!parsed.ok) {
      if (parsed.error.t === 'error' && parsed.error.fatal) return this.fatal(parsed.error);
      this.sink.send(parsed.error);
      return;
    }
    const msg = parsed.msg;
    if (msg.t === 'ping') return this.sink.send({ t: 'pong' });
    if (!this.greeted) {
      if (msg.t !== 'hello') return this.fatal(errorMsg('protocol', 'first message must be hello', true));
      this.greeted = true;
      return this.hello(msg);
    }
    if (msg.t === 'hello') return this.sink.send(errorMsg('protocol', 'already greeted', false));
    if (!this.session) return;
    await this.session.handle(msg, this.sink);
  }

  private async hello(msg: Extract<ClientMsg, { t: 'hello' }>): Promise<void> {
    const { deps } = this;
    const userId = await deps.auth.verifyToken(msg.token).catch(() => null);
    if (!userId) return this.fatal(errorMsg('auth', 'invalid or expired token', true));

    if (msg.conversationId) {
      const existing = deps.registry.sessions.get(msg.conversationId);
      if (existing && existing.userId === userId) {
        this.session = existing;
        await existing.attach(this.sink, msg.resumeAtMs, true);
        return;
      }
    }

    let fixture: TranscriptFixture | undefined;
    if (msg.source === 'replay-transcript') {
      if (!msg.fixture) return this.fatal(errorMsg('protocol', 'replay-transcript needs a fixture id', true));
      try {
        fixture = await deps.loadFixture(msg.fixture);
      } catch (err) {
        return this.fatal(errorMsg('protocol', err instanceof Error ? err.message : 'unknown fixture', true));
      }
    }

    try {
      this.session = await LiveSession.open(deps, userId, msg, fixture, this.sink);
    } catch (err) {
      if (err instanceof HelloRejected) return this.fatal(err.msg);
      throw err;
    }
    if (this.closed) this.session.detach(this.sink);
  }
}

class HelloRejected extends Error {
  constructor(public readonly msg: ServerMsg) {
    super(msg.t === 'error' ? msg.message : 'rejected');
  }
}

/**
 * One live conversation: audio clock, speech adapter, interpreter and batch commits. Survives a
 * dropped socket for `abandonAfterMs` so the client can resume with `conversationId` + `resumeAtMs`.
 */
export class LiveSession {
  private sink: LiveSink | null = null;
  private speech: SpeechAdapter | null = null;
  private interpreter!: LiveInterpreter;
  private uttCount = 0;
  private stage: LiveStage = 'listening';
  private stopping: Promise<void> | null = null;
  private abandonTimer: NodeJS.Timeout | null = null;
  private unsubscribe: () => void = () => {};
  /** set by abort(): late interpreter output and embeddings are dropped */
  aborted = false;

  private constructor(
    private readonly deps: LiveDeps,
    readonly userId: string,
    private readonly cell: GraphCell,
    private readonly clock: AudioClock,
    private readonly source: LiveSource,
    private readonly fixture: TranscriptFixture | undefined,
  ) {}

  get conversationId(): string {
    return this.cell.conversationId;
  }

  static async open(
    deps: LiveDeps,
    userId: string,
    hello: Extract<ClientMsg, { t: 'hello' }>,
    fixture: TranscriptFixture | undefined,
    sink: LiveSink,
  ): Promise<LiveSession> {
    const resuming = Boolean(hello.conversationId);
    const clock =
      hello.source === 'replay-transcript'
        ? new AudioClock('wall', hello.resumeAtMs ?? 0, deps.replaySpeed)
        : new AudioClock('audio', hello.resumeAtMs ?? 0);

    let conversationId: string;
    if (resuming) {
      const conv = await deps.store.getConversation(hello.conversationId!);
      // same answer for "missing" and "not yours": never reveal another user's conversation
      if (!conv || conv.conversation.userId !== userId) {
        throw new HelloRejected(errorMsg('auth', 'conversation not found', true));
      }
      if (conv.conversation.status !== 'live') {
        throw new HelloRejected(errorMsg('protocol', `conversation is ${conv.conversation.status}, not live`, true));
      }
      conversationId = conv.conversation.id;
    } else {
      conversationId = (await deps.store.createConversation(userId)).id;
    }

    const cell = await deps.hub.acquire(conversationId);
    if (!cell) throw new HelloRejected(errorMsg('db', 'conversation could not be loaded', true));
    const s = new LiveSession(deps, userId, cell, clock, hello.source, fixture);
    if (resuming) {
      const existing = await deps.store.listUtterances(conversationId);
      s.uttCount = existing.reduce((m, u) => Math.max(m, Number(u.id.slice(1)) || 0), 0);
    }
    s.interpreter = deps.createInterpreter({
      conversationId,
      getState: () => cell.state,
      emit: (ops) => {
        if (s.aborted) return;
        try {
          cell.commit(ops, 'live');
        } catch (err) {
          if (!(err instanceof OpError)) throw err;
          deps.log('interpreter.ops_rejected', { conversationId, code: err.code, message: err.message });
        }
      },
      newId: deps.newId,
      embed: deps.embed,
      matchNodes: async (embedding, k, excludeId) => {
        await cell.flush();
        return deps.store.matchNodes(conversationId, embedding, k, excludeId);
      },
      saveEmbedding: async (nodeId, embedding) => {
        if (s.aborted) return;
        await cell.enqueue(`embedding ${nodeId}`, () => deps.store.saveEmbedding(nodeId, embedding));
      },
      nowMs: () => clock.nowMs(),
      setStage: (stage) => s.setStage(stage),
      log: (event, data) => deps.log(event, { conversationId, ...data }),
    });
    s.unsubscribe = cell.subscribe({
      onBatch: (batch) => s.send({ t: 'ops', batch }),
      onPersistError: (message) => s.send(errorMsg('db', `could not save: ${message}`, false)),
    });
    deps.registry.sessions.set(conversationId, s);
    // a fresh conversation's clock starts at 0 when speech starts, not when the session was built
    // (in replay mode setup time would otherwise count as audio and skip the first utterances)
    await s.attach(sink, hello.resumeAtMs ?? (resuming ? undefined : 0), resuming);
    return s;
  }

  /**
   * (Re)attach a socket: start a fresh speech adapter from the resume point and greet.
   * `resuming` = the conversation already has content; a speech failure then must not end it.
   */
  async attach(sink: LiveSink, resumeAtMs?: Ms, resuming = false): Promise<void> {
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.abandonTimer = null;
    if (this.sink && this.sink !== sink) {
      this.sink.send(errorMsg('protocol', 'replaced by a newer connection', true));
      this.sink.close(1000, 'replaced');
    }
    await this.stopSpeech();
    this.sink = sink;
    if (resumeAtMs !== undefined) this.clock.rebase(resumeAtMs);
    else this.clock.rebase(this.clock.nowMs());

    let speech: SpeechAdapter;
    try {
      speech = this.deps.createSpeech({
        source: this.source,
        fixture: this.fixture,
        nowMs: () => this.clock.nowMs(),
        fromMs: this.clock.nowMs(),
        events: {
          onReconnecting: () => this.send({ t: 'status', stage: 'reconnecting-stt' }),
          onRecovered: () => this.send({ t: 'status', stage: this.stage }),
          onError: (message, fatal) => this.send(errorMsg('stt', message, fatal)),
          log: (event, data) => this.deps.log(event, { conversationId: this.conversationId, ...data }),
        },
      });
    } catch (err) {
      const message = err instanceof SpeechUnavailableError ? err.message : 'speech provider unavailable';
      await this.speechFailed(sink, message, resuming);
      return;
    }
    this.speech = speech;
    this.send({ t: 'ready', conversationId: this.conversationId });
    this.send({ t: 'status', stage: this.stage });
    try {
      await speech.start((seg) => this.onSegment(seg));
    } catch (err) {
      this.speech = null;
      const message = `speech provider failed to start: ${err instanceof Error ? err.message : String(err)}`;
      await this.speechFailed(sink, message, resuming);
    }
  }

  /**
   * Speech could not start. On a fresh hello the empty conversation is marked `failed`. On a
   * resume (e.g. a transient provider error after a Wi-Fi drop) the recorded graph must survive:
   * the error is non-fatal, the socket closes with 1013 (try again) and the session stays
   * resumable until the abandon timer fires.
   */
  private async speechFailed(sink: LiveSink, message: string, resuming: boolean): Promise<void> {
    if (resuming) {
      sink.send(errorMsg('stt', `${message}; reconnect to resume`, false));
      this.detach(sink);
      sink.close(1013, 'stt unavailable, retry');
      return;
    }
    sink.send(errorMsg('stt', message, true));
    sink.close(1011, 'stt');
    this.sink = null;
    await this.end('failed');
  }

  /** The socket went away without `stop`: keep the session for a while so the client can resume. */
  detach(sink: LiveSink): void {
    if (this.sink !== sink) return;
    this.sink = null;
    void this.stopSpeech();
    if (this.stopping) return;
    this.abandonTimer = setTimeout(() => {
      this.deps.log('live.abandoned', { conversationId: this.conversationId });
      void this.stop();
    }, this.deps.abandonAfterMs);
  }

  pushAudio(pcm: Buffer): void {
    if (this.stopping || this.source !== 'mic') return;
    this.clock.addBytes(pcm.length);
    this.speech?.push(pcm);
  }

  async handle(msg: ClientMsg, from: LiveSink): Promise<void> {
    if (from !== this.sink) return;
    switch (msg.t) {
      case 'flag': {
        // never trust the client clock: a flag can't be in the future or before the start
        const atMs = Math.round(Math.min(Math.max(0, msg.atMs), this.clock.nowMs()));
        const node = topicAt(this.cell.state, atMs);
        this.commit([
          {
            op: 'flag.add',
            flag: {
              id: this.deps.newId(),
              conversationId: this.conversationId,
              atMs,
              nodeId: node?.id ?? null,
              note: null,
              source: msg.source,
            },
          },
        ]);
        return;
      }
      case 'park':
        this.interpreter.park(msg.text, msg.atMs);
        return;
      case 'stop':
        await this.stop();
        return;
      default:
        return;
    }
  }

  /**
   * The conversation is being deleted: stop listening, ignore anything the interpreter still
   * emits, write nothing more and never finalise.
   */
  abort(reason: string): Promise<void> {
    this.aborted = true;
    if (!this.stopping) {
      this.stopping = (async () => {
        if (this.abandonTimer) clearTimeout(this.abandonTimer);
        await this.stopSpeech();
        this.unsubscribe();
        this.send(errorMsg('protocol', reason, true));
        this.sink?.close(1000, 'deleted');
        this.sink = null;
        if (this.deps.registry.sessions.get(this.conversationId) === this) {
          this.deps.registry.sessions.delete(this.conversationId);
          this.deps.hub.release(this.cell);
        }
      })();
    }
    return this.stopping;
  }

  /** flush speech → interpreter → mark processing → persist → `stopped` → finalisation */
  stop(): Promise<void> {
    if (!this.stopping) this.stopping = this.doStop();
    return this.stopping;
  }

  private async doStop(): Promise<void> {
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.send({ t: 'status', stage: 'finalizing' });
    await this.stopSpeech();
    try {
      await this.interpreter.stop();
    } catch (err) {
      this.deps.log('interpreter.stop_failed', { conversationId: this.conversationId, message: String(err) });
    }
    await this.end('processing');
    this.send({ t: 'stopped', conversationId: this.conversationId });
    this.sink?.close(1000, 'stopped');
    this.sink = null;
    this.deps.onStopped?.(this.conversationId, this.userId);
  }

  private async end(status: 'processing' | 'failed'): Promise<void> {
    this.commit([
      {
        op: 'conversation.update',
        patch: { status, endedAt: new Date().toISOString(), durationMs: Math.round(this.clock.nowMs()) },
      },
    ]);
    await this.cell.flush();
    this.unsubscribe();
    if (this.deps.registry.sessions.get(this.conversationId) === this) {
      this.deps.registry.sessions.delete(this.conversationId);
      this.deps.hub.release(this.cell);
    }
  }

  private async stopSpeech(): Promise<void> {
    const s = this.speech;
    this.speech = null;
    if (!s) return;
    try {
      await s.stop();
    } catch (err) {
      this.deps.log('speech.stop_failed', { conversationId: this.conversationId, message: String(err) });
    }
  }

  private onSegment(seg: SpeechSegment): void {
    if (!seg.final) {
      this.send({ t: 'caption', text: seg.text, final: false, startMs: Math.round(seg.startMs) });
      return;
    }
    const u: Utterance = {
      id: `u${++this.uttCount}`,
      conversationId: this.conversationId,
      speaker: seg.speaker,
      startMs: Math.round(seg.startMs),
      endMs: Math.round(Math.max(seg.endMs, seg.startMs)),
      text: seg.text,
    };
    void this.cell.enqueue(`utterance ${u.id}`, () => this.deps.store.insertUtterance(this.userId, u)).catch(() => {});
    this.send({ t: 'caption', text: u.text, final: true, utteranceId: u.id, startMs: u.startMs });
    try {
      this.interpreter.pushUtterance(u);
    } catch (err) {
      this.deps.log('interpreter.push_failed', { conversationId: this.conversationId, message: String(err) });
    }
  }

  private commit(ops: Parameters<GraphCell['commit']>[0]): void {
    try {
      void this.cell.commit(ops, 'live').persisted.catch(() => {});
    } catch (err) {
      this.deps.log('live.commit_rejected', { conversationId: this.conversationId, message: String(err) });
    }
  }

  private setStage(stage: 'listening' | 'thinking'): void {
    this.stage = stage;
    this.send({ t: 'status', stage });
  }

  private send(msg: ServerMsg): void {
    try {
      this.sink?.send(msg);
    } catch (err) {
      this.deps.log('live.send_failed', { message: String(err) });
    }
  }
}
