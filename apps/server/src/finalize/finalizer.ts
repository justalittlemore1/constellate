import { OpError, recordingPath, type FinalizeConversation, type GraphOp, type Utterance } from '@constellate/shared';
import type { GraphCell, GraphHub } from '../graph/hub';
import type { Log } from '../live/session';
import type { Store } from '../store/types';
import { remapEvidence } from './remap';
import { MAX_DIARIZED_MS, type FileTranscriber } from './transcribe';

export interface FinalizerDeps {
  store: Store;
  hub: GraphHub;
  finalizeConversation: FinalizeConversation;
  /** null when no Gemini key: the live transcript is kept */
  transcribeFile: FileTranscriber | null;
  newId(): string;
  log: Log;
  /** after `stop`, how long to wait for the client's recording upload before going on without it */
  waitForRecordingMs?: number;
  pollMs?: number;
}

export interface FinalizeOutcome {
  status: 'ready' | 'failed' | 'skipped';
  transcript: 'diarized' | 'live';
  reason?: string;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Post-recording pass (PLAN → Finalisation): diarized transcript → evidence remap →
 * `finalizeConversation` → one `source: 'finalize'` batch → recall cards → `ready`.
 * A failed transcription keeps the live transcript; a failed refinement keeps the live graph and
 * marks the conversation `failed`. One run per conversation at a time.
 */
export class Finalizer {
  private running = new Map<string, Promise<FinalizeOutcome>>();

  constructor(private readonly deps: FinalizerDeps) {}

  run(conversationId: string, opts: { waitForRecording?: boolean; force?: boolean } = {}): Promise<FinalizeOutcome> {
    let p = this.running.get(conversationId);
    if (!p) {
      p = this.doRun(conversationId, opts)
        .catch((err): FinalizeOutcome => {
          this.deps.log('finalize.crashed', { conversationId, message: errText(err) });
          return { status: 'failed', transcript: 'live', reason: errText(err) };
        })
        .finally(() => this.running.delete(conversationId));
      this.running.set(conversationId, p);
    }
    return p;
  }

  private async doRun(
    conversationId: string,
    opts: { waitForRecording?: boolean; force?: boolean },
  ): Promise<FinalizeOutcome> {
    const { deps } = this;
    const cell = await deps.hub.acquire(conversationId);
    if (!cell) return { status: 'skipped', transcript: 'live', reason: 'not found' };
    try {
      const conv = cell.state.conversation;
      if (conv.status === 'live') return { status: 'skipped', transcript: 'live', reason: 'still live' };
      if (conv.status === 'ready' && !opts.force) {
        return { status: 'skipped', transcript: 'live', reason: 'already ready' };
      }
      if (conv.status !== 'processing')
        this.commit(cell, [{ op: 'conversation.update', patch: { status: 'processing' } }]);

      const transcript = await this.transcript(cell, opts.waitForRecording ?? false);

      let result;
      try {
        result = await deps.finalizeConversation({
          state: cell.state,
          utterances: transcript.utterances,
          newId: deps.newId,
        });
      } catch (err) {
        return await this.fail(cell, transcript.kind, `refinement failed: ${errText(err)}`);
      }
      try {
        cell.commit([...result.ops, { op: 'conversation.update', patch: { status: 'ready' } }], 'finalize');
      } catch (err) {
        if (!(err instanceof OpError)) throw err;
        return await this.fail(cell, transcript.kind, `refinement produced invalid ops: ${err.message}`);
      }
      const cards = result.recallPrompts.filter((c) => cell.state.nodes[c.nodeId]).slice(0, 3);
      if (cards.length) {
        await cell
          .enqueue('recall cards', () => deps.store.insertRecallCards(cell.userId, conversationId, cards))
          .catch(() => {});
      }
      await cell.flush();
      deps.log('finalize.done', { conversationId, transcript: transcript.kind, ops: result.ops.length });
      return { status: 'ready', transcript: transcript.kind };
    } finally {
      deps.hub.release(cell);
    }
  }

  /** Diarized transcript when the recording exists and fits; otherwise the live one. */
  private async transcript(
    cell: GraphCell,
    wait: boolean,
  ): Promise<{ kind: 'diarized' | 'live'; utterances: Utterance[] }> {
    const { deps } = this;
    const cid = cell.conversationId;
    await cell.flush();
    const live = await deps.store.listUtterances(cid);
    const conv = cell.state.conversation;
    const path = conv.audioPath ?? recordingPath(cell.userId, cid);

    const download = () => deps.store.downloadRecording(path).catch(() => null);
    let audio = await download();
    const deadline = Date.now() + (wait ? (deps.waitForRecordingMs ?? 45_000) : 0);
    while (!audio && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, deps.pollMs ?? 3_000));
      audio = await download();
    }
    if (!audio) return { kind: 'live', utterances: live };
    if (conv.audioPath !== path) this.commit(cell, [{ op: 'conversation.update', patch: { audioPath: path } }]);

    if (!deps.transcribeFile) return { kind: 'live', utterances: live };
    if ((conv.durationMs ?? 0) > MAX_DIARIZED_MS) {
      deps.log('finalize.too_long_for_diarization', { conversationId: cid, durationMs: conv.durationMs });
      return { kind: 'live', utterances: live };
    }
    try {
      const segments = await deps.transcribeFile(audio, 'audio/webm');
      const fresh: Utterance[] = segments.map((s, i) => ({
        id: `u${i + 1}`,
        conversationId: cid,
        speaker: s.speaker,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      }));
      const ops = remapEvidence(cell.state, live, fresh);
      if (ops.length) this.commit(cell, ops);
      await cell.enqueue('utterances', () => deps.store.replaceUtterances(cell.userId, cid, fresh));
      return { kind: 'diarized', utterances: fresh };
    } catch (err) {
      deps.log('finalize.transcription_failed', { conversationId: cid, message: errText(err) });
      return { kind: 'live', utterances: live };
    }
  }

  private commit(cell: GraphCell, ops: GraphOp[]): void {
    void cell.commit(ops, 'finalize').persisted.catch(() => {});
  }

  private async fail(cell: GraphCell, kind: 'diarized' | 'live', reason: string): Promise<FinalizeOutcome> {
    this.deps.log('finalize.failed', { conversationId: cell.conversationId, reason });
    this.commit(cell, [{ op: 'conversation.update', patch: { status: 'failed' } }]);
    await cell.flush();
    return { status: 'failed', transcript: kind, reason };
  }
}
