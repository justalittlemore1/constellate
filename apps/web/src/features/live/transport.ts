/**
 * One live connection to the server (or to the in-browser mock server). Thin on purpose:
 * reconnection, ping and buffering live in the controller so mock and real behave the same.
 */
import { ServerMsgSchema, type ClientMsg, type ServerMsg } from '@constellate/shared';

export interface TransportHandlers {
  /** the connection is open: send `hello` now */
  onOpen(): void;
  /** a server frame that passed `ServerMsgSchema` */
  onMessage(msg: ServerMsg): void;
  /** the connection closed (never called after `close()` from our side) */
  onClose(info: { code: number; reason: string }): void;
}

export interface LiveTransport {
  send(msg: ClientMsg): void;
  /** one PCM frame (exactly AUDIO_FRAME_BYTES) */
  sendAudio(frame: ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type TransportFactory = (handlers: TransportHandlers) => LiveTransport;

/** Parse and validate one text frame; invalid frames are reported and dropped, never applied. */
export function parseServerFrame(data: unknown, warn: (msg: string) => void = console.warn): ServerMsg | null {
  if (typeof data !== 'string') return null; // the server never sends binary
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    warn('live: dropped a server frame that is not JSON');
    return null;
  }
  const parsed = ServerMsgSchema.safeParse(json);
  if (!parsed.success) {
    warn(`live: dropped an invalid server frame: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return null;
  }
  return parsed.data;
}

type WebSocketCtor = new (url: string) => WebSocket;

/** Real transport: a browser WebSocket to `url` (VITE_SERVER_WS_URL). */
export function wsTransport(url: string, WS: WebSocketCtor = WebSocket): TransportFactory {
  return (h) => {
    const ws = new WS(url);
    ws.binaryType = 'arraybuffer';
    let closedByUs = false;
    ws.onopen = () => h.onOpen();
    ws.onmessage = (ev: MessageEvent) => {
      const msg = parseServerFrame(ev.data);
      if (msg) h.onMessage(msg);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (!closedByUs) h.onClose({ code: ev.code, reason: ev.reason });
    };
    return {
      send: (msg) => {
        if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(msg));
      },
      sendAudio: (frame) => {
        if (ws.readyState === WS_OPEN) ws.send(frame);
      },
      close: (code = 1000, reason = 'client closed') => {
        closedByUs = true;
        if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) ws.close(code, reason);
      },
    };
  };
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;
