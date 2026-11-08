/**
 * LiveController: the live session state machine, independent of React.
 *
 *   idle → consenting → connecting → live → stopping → stopped
 *                           ↘──────────↘──────────↘→ error
 *
 * Holds the GraphState (built only with the shared `applyOps` reducer), captions and stage.
 * The same code drives the real server, the in-browser mock server, the microphone, WAV replay
 * and transcript replay — only the injected transport / capture differ.
 */
import {
  AUDIO_FRAME_MS,
  OpError,
  applyOps,
  emptyGraph,
  type ClientMsg,
  type FlagSource,
  type GraphState,
  type LiveStage,
  type OpBatch,
  type ServerMsg,
} from '@constellate/shared';
import type { Capture, CaptureSource } from './audio';
import type { LiveTransport, TransportFactory } from './transport';

export type LivePhase = 'idle' | 'consenting' | 'connecting' | 'live' | 'stopping' | 'stopped' | 'error';

export type LiveSourceSpec =
  | { kind: 'mic' }
  /** a WAV (or any decodable audio) streamed through the worklet in real time */
  | { kind: 'wav'; data: ArrayBuffer; name?: string }
  /** the server replays a transcript fixture on its original timing (no audio) */
  | { kind: 'transcript'; fixture: string };

export interface Caption {
  text: string;
  startMs: number;
  utteranceId?: string;
}

export type LiveErrorCode = 'mic-denied' | 'mic-unavailable' | 'auth' | 'network' | 'server' | 'no-consent';

export interface LiveSnapshot {
  phase: LivePhase;
  source: LiveSourceSpec;
  conversationId: string | null;
  graph: GraphState | null;
  /** last few final captions, oldest first */
  captions: Caption[];
  /** current interim hypothesis (shown dimmed), cleared by the next final */
  interim: string | null;
  stage: LiveStage | null;
  /** live, but the socket dropped and we are reconnecting */
  reconnecting: boolean;
  error: { code: LiveErrorCode; message: string } | null;
  /** a non-fatal message for a toast */
  notice: { id: number; message: string } | null;
  upload: 'none' | 'uploading' | 'done' | 'failed';
}

export interface Auth {
  token: string;
  userId: string;
}

export interface LiveDeps {
  transport: TransportFactory;
  getAuth(): Promise<Auth | null>;
  /** GET /conversations/:id */
  fetchGraph(conversationId: string, auth: Auth): Promise<GraphState>;
  /** start audio capture; rejects with a DOMException named NotAllowedError when the mic is denied */
  startCapture(source: CaptureSource, onFrame: (frame: ArrayBuffer) => void): Promise<Capture>;
  /** upload the recording to recordings/{userId}/{conversationId}.webm */
  upload(blob: Blob, auth: Auth, conversationId: string): Promise<void>;
  now(): number;
  /** wall-clock multiplier for sources without audio (mock mode runs faster than real time) */
  clockRate?: number;
  log?(event: string, data?: Record<string, unknown>): void;
}

export const PING_INTERVAL_MS = 15_000;
export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const MAX_RECONNECTS = 10;
/** audio kept while disconnected (5 s); older frames are dropped and the clock skips ahead */
export const MAX_BUFFERED_FRAMES = 50;
export const STOP_TIMEOUT_MS = 20_000;
export const MAX_CAPTIONS = 20;
export const PARK_MAX_CHARS = 80;

/** WebSocket close codes after which reconnecting is pointless */
const FATAL_CLOSE_CODES = new Set([1008, 1011]);

type Listener = () => void;

export class LiveController {
  private snap: LiveSnapshot;
  private listeners = new Set<Listener>();

  private auth: Auth | null = null;
  private transport: LiveTransport | null = null;
  private capture: Capture | null = null;
  private open = false;
  private ready = false;
  private everReady = false;
  private disposed = false;

  /** audio frames captured so far (the audio clock is framesCaptured × 100 ms) */
  private framesCaptured = 0;
  /** frames waiting for a ready connection: [index, frame] */
  private audioBuffer: { index: number; frame: ArrayBuffer }[] = [];
  /** control messages queued while disconnected */
  private outbox: ClientMsg[] = [];

  /** wall-clock origin for sources without audio */
  private wallStart: number | null = null;
  private wallOffsetMs = 0;

  private fetching: Promise<void> | null = null;
  private queuedBatches: OpBatch[] = [];

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnects = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: (() => void) | null = null;
  private noticeSeq = 0;
  private serverStopped = false;

  constructor(
    source: LiveSourceSpec,
    private readonly deps: LiveDeps,
  ) {
    this.snap = {
      phase: 'idle',
      source,
      conversationId: null,
      graph: null,
      captions: [],
      interim: null,
      stage: null,
      reconnecting: false,
      error: null,
      notice: null,
      upload: 'none',
    };
  }

  // ── store (useSyncExternalStore) ─────────────────────────────────────────

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): LiveSnapshot => this.snap;

  private set(patch: Partial<LiveSnapshot>): void {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  private notify(message: string): void {
    this.set({ notice: { id: ++this.noticeSeq, message } });
  }

  private log(event: string, data?: Record<string, unknown>): void {
    this.deps.log?.(event, data);
  }

  // ── clock ────────────────────────────────────────────────────────────────

  private get hasAudio(): boolean {
    return this.snap.source.kind !== 'transcript' && this.capture !== null;
  }

  /** ms on the conversation clock: audio frames for mic / WAV, scaled wall time otherwise */
  clockMs(): number {
    if (this.hasAudio) return this.framesCaptured * AUDIO_FRAME_MS;
    if (this.wallStart === null) return this.wallOffsetMs;
    return this.wallOffsetMs + (this.deps.now() - this.wallStart) * (this.deps.clockRate ?? 1);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** show the consent sheet */
  requestConsent(): void {
    if (this.snap.phase === 'idle') this.set({ phase: 'consenting' });
  }

  /**
   * The user confirmed that everyone agrees to be recorded. Only now is audio captured or a
   * connection opened; `hello` always carries `consent: true`.
   */
  async consent(): Promise<void> {
    if (this.snap.phase !== 'consenting' && this.snap.phase !== 'idle') return;
    this.set({ phase: 'connecting', error: null });

    const auth = await this.deps.getAuth().catch(() => null);
    if (this.disposed) return;
    if (!auth) return this.fail('auth', 'Please sign in again to record.');
    this.auth = auth;

    if (this.snap.source.kind !== 'transcript') {
      try {
        const src: CaptureSource =
          this.snap.source.kind === 'mic' ? { kind: 'mic' } : { kind: 'wav', data: this.snap.source.data };
        this.capture = await this.deps.startCapture(src, (frame) => this.onFrame(frame));
        this.capture.onEnded = () => void this.stop();
      } catch (err) {
        if (this.disposed) return;
        // DOMException is not always an Error subclass, so look at the shape
        const { name, message } = (err ?? {}) as { name?: string; message?: string };
        return name === 'NotAllowedError' || name === 'SecurityError'
          ? this.fail('mic-denied', 'Microphone access was blocked.')
          : this.fail('mic-unavailable', message || 'Could not start audio.');
      }
      if (this.disposed) {
        void this.capture.stop();
        return;
      }
    }
    this.connect();
  }

  private connect(): void {
    this.open = false;
    this.ready = false;
    this.transport = this.deps.transport({
      onOpen: () => this.onOpen(),
      onMessage: (m) => this.onMessage(m),
      onClose: (info) => this.onClose(info),
    });
  }

  private onOpen(): void {
    if (!this.auth) return;
    this.open = true;
    const src = this.snap.source;
    const resuming = this.everReady && this.snap.conversationId !== null;
    const hello: Extract<ClientMsg, { t: 'hello' }> = {
      t: 'hello',
      token: this.auth.token,
      source: src.kind === 'transcript' ? 'replay-transcript' : 'mic',
      consent: true,
      ...(src.kind === 'transcript' ? { fixture: src.fixture } : {}),
      ...(resuming ? { conversationId: this.snap.conversationId!, resumeAtMs: this.resumeAtMs() } : {}),
    };
    this.transport?.send(hello);
  }

  /** where the server's clock should continue: the first audio frame we still hold */
  private resumeAtMs(): number {
    if (this.hasAudio) {
      const first = this.audioBuffer[0];
      return (first ? first.index : this.framesCaptured) * AUDIO_FRAME_MS;
    }
    return Math.round(this.clockMs());
  }

  private onMessage(msg: ServerMsg): void {
    if (this.disposed) return;
    switch (msg.t) {
      case 'ready':
        return this.onReady(msg.conversationId);
      case 'ops':
        return this.onBatch(msg.batch);
      case 'caption':
        if (msg.final) {
          const captions = [...this.snap.captions, { text: msg.text, startMs: msg.startMs, utteranceId: msg.utteranceId }];
          this.set({ captions: captions.slice(-MAX_CAPTIONS), interim: null });
        } else {
          this.set({ interim: msg.text });
        }
        return;
      case 'status':
        return this.set({ stage: msg.stage });
      case 'error':
        this.log('live.server_error', { code: msg.code, message: msg.message, fatal: msg.fatal });
        if (msg.fatal && this.snap.phase !== 'stopping') {
          return this.fail(msg.code === 'auth' ? 'auth' : 'server', msg.message);
        }
        if (!msg.fatal) this.notify(msg.message);
        return;
      case 'stopped':
        if (this.snap.phase === 'live' || this.snap.phase === 'connecting') {
          // the server ended the conversation (e.g. a replay reached its end)
          this.serverStopped = true;
          void this.stop();
          return;
        }
        return this.finishStop();
      case 'pong':
        return;
    }
  }

  private onReady(conversationId: string): void {
    const resumed = this.everReady && this.snap.conversationId === conversationId;
    this.ready = true;
    this.everReady = true;
    this.reconnects = 0;
    if (this.wallStart === null && !this.hasAudio) this.wallStart = this.deps.now();
    this.set({
      conversationId,
      phase: this.snap.phase === 'stopping' ? 'stopping' : 'live',
      reconnecting: false,
      stage: this.snap.stage ?? 'listening',
    });
    this.startPing();
    // after a gap (fresh start or reconnect) the server state is the truth: fetch it, then
    // apply whatever arrives on top. Batches we already have are ignored by seq.
    if (!this.snap.graph || resumed) void this.refetch();
    for (const m of this.outbox.splice(0)) this.transport?.send(m);
    this.flushAudio();
  }

  private onBatch(batch: OpBatch): void {
    if (this.fetching || !this.snap.graph) {
      this.queuedBatches.push(batch);
      return;
    }
    const graph = this.snap.graph;
    if (batch.seq <= graph.lastSeq) return; // duplicate (e.g. resent after a reconnect)
    if (batch.seq > graph.lastSeq + 1) {
      // missed batches: the reducer cannot fill the hole, the server can
      this.queuedBatches.push(batch);
      void this.refetch();
      return;
    }
    try {
      this.set({ graph: applyOps(graph, batch) });
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      this.log('live.op_error', { code: err.code, message: err.message, seq: batch.seq });
      this.queuedBatches.push(batch);
      void this.refetch();
    }
  }

  /** replace the graph with GET /conversations/:id, then re-apply queued batches */
  private refetch(): Promise<void> {
    if (this.fetching) return this.fetching;
    const id = this.snap.conversationId;
    const auth = this.auth;
    if (!id || !auth) return Promise.resolve();
    this.fetching = this.deps
      .fetchGraph(id, auth)
      .then((fresh) => {
        const current = this.snap.graph;
        if (!current || fresh.lastSeq >= current.lastSeq) this.set({ graph: fresh });
      })
      .catch((err: unknown) => {
        this.log('live.refetch_failed', { message: err instanceof Error ? err.message : String(err) });
        if (!this.snap.graph) this.set({ graph: this.blankGraph(id, auth.userId) });
      })
      .finally(() => {
        this.fetching = null;
        const queued = this.queuedBatches.splice(0).sort((a, b) => a.seq - b.seq);
        const graph = this.snap.graph;
        if (!graph) return;
        let g = graph;
        let failed = false;
        for (const b of queued) {
          if (b.seq <= g.lastSeq) continue;
          try {
            g = applyOps(g, b);
          } catch (err) {
            if (!(err instanceof OpError)) throw err;
            this.log('live.op_error_after_refetch', { code: err.code, seq: b.seq });
            failed = true;
            break;
          }
        }
        if (g !== graph) this.set({ graph: g });
        if (failed) this.notify('The map fell out of sync; it will catch up with the next update.');
      });
    return this.fetching;
  }

  /** used only if the server cannot be reached for the initial state */
  private blankGraph(conversationId: string, userId: string): GraphState {
    return emptyGraph({
      id: conversationId,
      userId,
      folderId: null,
      title: 'Untitled conversation',
      summary: null,
      macroAnchor: null,
      status: 'live',
      isSolo: false,
      isFavorite: false,
      location: null,
      reflection: null,
      startedAt: new Date(this.deps.now()).toISOString(),
      endedAt: null,
      durationMs: null,
      audioPath: null,
    });
  }

  private onClose({ code, reason }: { code: number; reason: string }): void {
    this.open = false;
    this.ready = false;
    this.transport = null;
    this.stopPing();
    if (this.disposed) return;
    const { phase } = this.snap;
    if (phase === 'stopped' || phase === 'error') return;
    if (phase === 'stopping') {
      // the server finishes a stopped conversation on its own
      this.finishStop();
      return;
    }
    if (FATAL_CLOSE_CODES.has(code)) return this.fail('server', reason || 'The server closed the conversation.');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnects >= MAX_RECONNECTS) {
      return this.fail('network', 'Lost the connection to the server.');
    }
    const delay = BACKOFF_MS[Math.min(this.reconnects, BACKOFF_MS.length - 1)]!;
    this.reconnects++;
    this.set({ reconnecting: true });
    this.log('live.reconnect_scheduled', { attempt: this.reconnects, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.transport?.send({ t: 'ping' }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ── audio ────────────────────────────────────────────────────────────────

  private onFrame(frame: ArrayBuffer): void {
    if (this.disposed || this.snap.phase === 'stopping' || this.snap.phase === 'stopped') return;
    const index = this.framesCaptured++;
    if (this.ready && this.audioBuffer.length === 0) {
      this.transport?.sendAudio(frame);
      return;
    }
    this.audioBuffer.push({ index, frame });
    if (this.audioBuffer.length > MAX_BUFFERED_FRAMES) this.audioBuffer.shift();
  }

  private flushAudio(): void {
    for (const { frame } of this.audioBuffer.splice(0)) this.transport?.sendAudio(frame);
  }

  // ── user actions ─────────────────────────────────────────────────────────

  private sendOrQueue(msg: ClientMsg): void {
    if (this.ready && this.open) this.transport?.send(msg);
    else this.outbox.push(msg);
  }

  /** returns false when there is nothing live to flag */
  flag(source: FlagSource): boolean {
    if (this.snap.phase !== 'live') return false;
    this.sendOrQueue({ t: 'flag', atMs: Math.round(this.clockMs()), source });
    return true;
  }

  /** park a thought for later; text is trimmed and capped at 80 characters */
  park(text: string): boolean {
    const clean = text.trim().slice(0, PARK_MAX_CHARS);
    if (!clean || this.snap.phase !== 'live') return false;
    this.sendOrQueue({ t: 'park', text: clean, atMs: Math.round(this.clockMs()) });
    return true;
  }

  /**
   * Stop: audio stops immediately (privacy first), `stop` goes to the server, then the
   * recording is uploaded once the server confirms (or after a timeout).
   */
  async stop(): Promise<void> {
    const { phase } = this.snap;
    if (phase === 'consenting' || phase === 'idle') {
      this.set({ phase: 'stopped' });
      return;
    }
    if (phase !== 'live' && phase !== 'connecting') return;
    this.set({ phase: 'stopping', interim: null });
    if (this.wallStart !== null) {
      // freeze the timer for sources without audio
      this.wallOffsetMs = this.clockMs();
      this.wallStart = null;
    }
    if (this.reconnectTimer) {
      // no connection to tell; the server stops an abandoned session itself
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const blob = this.capture ? this.capture.stop().catch(() => null) : Promise.resolve(null);
    this.audioBuffer = [];

    const confirmed = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
      this.stopTimer = setTimeout(resolve, STOP_TIMEOUT_MS);
    });
    if (this.open && !this.serverStopped) this.transport?.send({ t: 'stop' });
    else this.finishStop();
    await confirmed;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;

    const recording = await blob;
    const id = this.snap.conversationId;
    if (recording && recording.size > 0 && id && this.auth) {
      this.set({ upload: 'uploading' });
      try {
        await this.deps.upload(recording, this.auth, id);
        this.set({ upload: 'done' });
      } catch (err) {
        this.log('live.upload_failed', { message: err instanceof Error ? err.message : String(err) });
        this.set({ upload: 'failed' });
        this.notify('The recording could not be uploaded. The map is saved.');
      }
    }
    this.teardownConnection();
    this.set({ phase: 'stopped' });
  }

  private finishStop(): void {
    const resolve = this.stopResolve;
    this.stopResolve = null;
    resolve?.();
  }

  private fail(code: LiveErrorCode, message: string): void {
    this.log('live.failed', { code, message });
    this.teardownConnection();
    if (this.capture) void this.capture.stop().catch(() => null);
    this.capture = null;
    this.set({ phase: 'error', error: { code, message }, reconnecting: false });
  }

  private teardownConnection(): void {
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const t = this.transport;
    this.transport = null;
    this.open = false;
    this.ready = false;
    t?.close(1000, 'client done');
  }

  /** unmount: release the mic and the socket without changing anything server-side */
  dispose(): void {
    if (this.disposed) return;
    this.teardownConnection();
    if (this.capture) void this.capture.stop().catch(() => null);
    this.capture = null;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.finishStop();
    this.disposed = true;
    this.listeners.clear();
  }
}
