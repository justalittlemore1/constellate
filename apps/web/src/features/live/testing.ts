/** Test doubles for the live client (imported by *.test.ts only). */
import {
  AUDIO_FRAME_BYTES,
  type ClientMsg,
  type GraphState,
  type ServerMsg,
} from '@constellate/shared';
import { vi } from 'vitest';
import type { Capture, CaptureSource } from './audio';
import type { LiveDeps } from './controller';
import type { LiveTransport, TransportFactory, TransportHandlers } from './transport';

export class FakeConn implements LiveTransport {
  readonly sent: ClientMsg[] = [];
  readonly audio: ArrayBuffer[] = [];
  closed = false;
  constructor(readonly h: TransportHandlers) {}
  send(msg: ClientMsg) {
    if (!this.closed) this.sent.push(msg);
  }
  sendAudio(frame: ArrayBuffer) {
    if (!this.closed) this.audio.push(frame);
  }
  close() {
    this.closed = true;
  }
  // server side
  open() {
    this.h.onOpen();
  }
  push(msg: ServerMsg) {
    this.h.onMessage(msg);
  }
  drop(code = 1006, reason = '') {
    this.closed = true;
    this.h.onClose({ code, reason });
  }
}

export class FakeNet {
  readonly conns: FakeConn[] = [];
  factory: TransportFactory = (h) => {
    const c = new FakeConn(h);
    this.conns.push(c);
    return c;
  };
  get last(): FakeConn {
    const c = this.conns.at(-1);
    if (!c) throw new Error('no connection yet');
    return c;
  }
}

export class FakeCapture implements Capture {
  onEnded?: () => void;
  stopped = false;
  constructor(
    private readonly onFrame: (f: ArrayBuffer) => void,
    private readonly blob: Blob | null = new Blob(['webm'], { type: 'audio/webm' }),
  ) {}
  /** produce n frames, each tagged with its index in the first byte */
  emit(n: number, start = 0) {
    for (let i = 0; i < n; i++) {
      const f = new ArrayBuffer(AUDIO_FRAME_BYTES);
      new Uint8Array(f)[0] = (start + i) % 256;
      this.onFrame(f);
    }
  }
  async stop() {
    this.stopped = true;
    return this.blob;
  }
}

export function fakeDeps(over: Partial<LiveDeps> & { graph?: (id: string) => GraphState } = {}) {
  const net = new FakeNet();
  let capture: FakeCapture | null = null;
  const deps: LiveDeps = {
    transport: net.factory,
    getAuth: vi.fn(async () => ({ token: 'tok', userId: 'u1' })),
    fetchGraph: vi.fn(async (id: string) => {
      if (!over.graph) throw new Error('no graph');
      return over.graph(id);
    }),
    startCapture: vi.fn(async (_src: CaptureSource, onFrame: (f: ArrayBuffer) => void) => {
      capture = new FakeCapture(onFrame);
      return capture;
    }),
    upload: vi.fn(async () => undefined),
    now: () => Date.now(),
    ...over,
  };
  return {
    deps,
    net,
    get capture(): FakeCapture {
      if (!capture) throw new Error('capture not started');
      return capture;
    },
  };
}

/** let pending promise callbacks run */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
