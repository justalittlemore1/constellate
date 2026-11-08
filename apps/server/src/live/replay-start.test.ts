/**
 * Transcript replay never starts from a running wall clock (A2's #63: a slow attach at a high
 * REPLAY_SPEED silently skipped the opening utterances and hung the seed run).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeechRequest } from './session';
import { TranscriptReplayAdapter, loadTranscriptFixture } from '../speech/replay';
import { connect, makeHarness, until, type Harness } from '../test-utils';

let h: Harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await h?.app.close();
});

const FIXTURE = '01-simple-shift';
const replay = (over: Record<string, unknown> = {}) => ({
  t: 'hello',
  token: 'token-a',
  source: 'replay-transcript',
  fixture: FIXTURE,
  consent: true,
  ...over,
});

/** Harness whose replay adapter runs at `speed` and records every SpeechRequest. */
async function harness(speed: number) {
  const requests: SpeechRequest[] = [];
  h = await makeHarness({
    replaySpeed: speed,
    createSpeech: (req) => {
      requests.push(req);
      return new TranscriptReplayAdapter(req.fixture!, { speed, fromMs: req.fromMs });
    },
  });
  return requests;
}

const finals = (c: Awaited<ReturnType<typeof connect>>) =>
  c.messages.flatMap((m) => (m.t === 'caption' && m.final ? [m] : []));

describe('transcript replay start point', () => {
  it('a fresh replay starts at 0 even when time passes during attach (slow server)', async () => {
    const fixture = await loadTranscriptFixture(FIXTURE);
    const requests = await harness(200);
    // every Date.now() call jumps 100 ms: at 200× that is 20 s of "audio" between any two reads,
    // so reading the running clock during attach would skip the first utterances
    let offset = 0;
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + (offset += 100));
    const c = await connect(h.app);
    c.send(replay());
    await c.waitFor('ready');
    spy.mockRestore();

    await c.waitFor('caption', (m) => m.final && m.utteranceId === `u${fixture.utterances.length}`, 5_000);
    expect(requests[0]!.fromMs).toBe(0);
    expect(finals(c).map((m) => m.text)).toEqual(fixture.utterances.map((u) => u.text));
    expect(finals(c)[0]).toMatchObject({ utteranceId: 'u1', startMs: fixture.utterances[0]!.startMs });
  });

  it('a dropped replay resumed without resumeAtMs continues after the last delivered utterance', async () => {
    const fixture = await loadTranscriptFixture(FIXTURE);
    const requests = await harness(50);
    const c1 = await connect(h.app);
    c1.send(replay());
    const { conversationId } = await c1.waitFor('ready');
    await c1.waitFor('caption', (m) => m.final && m.utteranceId === 'u3', 5_000);
    c1.close();
    // while the socket is away the session's replay clock keeps running at 50× (300 ms → 15 s)
    await new Promise((r) => setTimeout(r, 300));

    const c2 = await connect(h.app);
    c2.send(replay({ conversationId }));
    await c2.waitFor('ready');
    const delivered = finals(c1).length;
    await c2.waitFor('caption', (m) => m.final && m.utteranceId === `u${fixture.utterances.length}`, 5_000);

    expect(requests[1]!.fromMs).toBe(fixture.utterances[delivered - 1]!.endMs);
    const all = [...finals(c1), ...finals(c2)];
    expect(all.map((m) => m.utteranceId)).toEqual(fixture.utterances.map((_, i) => `u${i + 1}`)); // none skipped or repeated
    expect(all.map((m) => m.text)).toEqual(fixture.utterances.map((u) => u.text));
  });

  it('a resume with resumeAtMs starts exactly there', async () => {
    const fixture = await loadTranscriptFixture(FIXTURE);
    const requests = await harness(200);
    const c1 = await connect(h.app);
    c1.send(replay());
    const { conversationId } = await c1.waitFor('ready');
    await c1.waitFor('caption', (m) => m.final && m.utteranceId === 'u2', 5_000);
    c1.close();
    await until(() => requests.length === 1);

    const resumeAtMs = fixture.utterances[5]!.endMs; // the client says it heard up to u6
    const c2 = await connect(h.app);
    c2.send(replay({ conversationId, resumeAtMs }));
    await c2.waitFor('ready');
    await c2.waitFor('caption', (m) => m.final, 5_000);
    expect(requests[1]!.fromMs).toBe(resumeAtMs);
    expect(finals(c2)[0]!.text).toBe(fixture.utterances[6]!.text);
  });
});
