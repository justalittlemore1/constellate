import { describe, expect, it, vi } from 'vitest';
import { parseServerFrame, wsTransport } from './transport';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  closedWith: [number, string] | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close(code: number, reason: string) {
    this.closedWith = [code, reason];
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  // server side
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
}

const make = () => {
  const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
  const t = wsTransport('ws://x/live', FakeWebSocket as unknown as new (url: string) => WebSocket)(handlers);
  return { t, handlers, ws: FakeWebSocket.instances.at(-1)! };
};

describe('parseServerFrame', () => {
  it('accepts valid frames', () => {
    expect(parseServerFrame('{"t":"pong"}')).toEqual({ t: 'pong' });
  });

  it.each([
    ['not JSON', 'nope'],
    ['unknown type', '{"t":"hack"}'],
    ['bad field', '{"t":"caption","text":"hi","final":"yes","startMs":0}'],
    ['bad batch', '{"t":"ops","batch":{"seq":1}}'],
  ])('drops %s', (_, raw) => {
    const warn = vi.fn();
    expect(parseServerFrame(raw, warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ignores binary frames', () => {
    expect(parseServerFrame(new ArrayBuffer(4))).toBeNull();
  });
});

describe('wsTransport', () => {
  it('sends JSON text frames and binary audio only once open', () => {
    const { t, handlers, ws } = make();
    expect(ws.url).toBe('ws://x/live');
    expect(ws.binaryType).toBe('arraybuffer');
    t.send({ t: 'ping' });
    expect(ws.sent).toEqual([]);
    ws.accept();
    expect(handlers.onOpen).toHaveBeenCalledOnce();
    t.send({ t: 'ping' });
    const frame = new ArrayBuffer(3200);
    t.sendAudio(frame);
    expect(ws.sent).toEqual(['{"t":"ping"}', frame]);
  });

  it('delivers only validated messages', () => {
    const { handlers, ws } = make();
    ws.accept();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ws.onmessage?.({ data: '{"t":"status","stage":"thinking"}' });
    ws.onmessage?.({ data: '{"t":"status","stage":"dancing"}' });
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith({ t: 'status', stage: 'thinking' });
    warn.mockRestore();
  });

  it('reports server-side closes but not our own', () => {
    const a = make();
    a.ws.accept();
    a.ws.onclose?.({ code: 1006, reason: '' });
    expect(a.handlers.onClose).toHaveBeenCalledWith({ code: 1006, reason: '' });

    const b = make();
    b.ws.accept();
    b.t.close();
    expect(b.ws.closedWith).toEqual([1000, 'client closed']);
    expect(b.handlers.onClose).not.toHaveBeenCalled();
  });
});
