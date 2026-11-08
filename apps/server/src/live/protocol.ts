import { ClientMsgSchema, type ClientMsg, type ServerMsg } from '@constellate/shared';

export type ParseResult = { ok: true; msg: ClientMsg } | { ok: false; error: ServerMsg };

/** Parse one JSON text frame from the client. Binary frames (audio) never reach this function. */
export function parseClientFrame(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: { t: 'error', code: 'protocol', message: 'frame is not JSON', fatal: false } };
  }
  const parsed = ClientMsgSchema.safeParse(json);
  if (!parsed.success) {
    const consentMissing =
      typeof json === 'object' && json !== null && (json as { t?: unknown }).t === 'hello' && (json as { consent?: unknown }).consent !== true;
    return {
      ok: false,
      error: {
        t: 'error',
        code: 'protocol',
        message: consentMissing ? 'recording requires consent: true' : `invalid message: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        fatal: consentMissing,
      },
    };
  }
  return { ok: true, msg: parsed.data };
}

export function send(socket: { send(data: string): void }, msg: ServerMsg): void {
  socket.send(JSON.stringify(msg));
}
