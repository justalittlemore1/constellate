import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { loadMergeSystemPrompt } from '@constellate/brain';
import { createLiveInterpreter, finalizeConversation } from '@constellate/interpreter';
import type { CreateLiveInterpreter, FinalizeConversation } from '@constellate/shared';
import { geminiEmbedder, noEmbedder, type Embedder } from './ai/embed';
import { anthropicMergeDecider, type MergeDecider } from './brain/merge-llm';
import type { Env } from './env';
import { geminiFileTranscriber, type FileTranscriber } from './finalize/transcribe';
import { GraphHub } from './graph/hub';
import { LiveRegistry, SpeechUnavailableError, type LiveDeps, type Log, type SpeechRequest } from './live/session';
import { GeminiLiveUpstream } from './speech/gemini-live';
import { loadTranscriptFixture, TranscriptReplayAdapter } from './speech/replay';
import { RotatingSpeechAdapter } from './speech/rotating';
import type { SpeechAdapter } from './speech/types';
import { MemoryStore } from './store/memory';
import { SupabaseStore } from './store/supabase';
import type { Store } from './store/types';
import { createServiceClient, rejectAllAuth, supabaseAuth, type Auth } from './supabase';

/** Everything the routes and live sessions depend on; tests replace any of it. */
export interface ServerDeps extends Omit<LiveDeps, 'log'> {
  finalizeConversation: FinalizeConversation;
  /** post-recording diarized transcription; null keeps the live transcript */
  transcribeFile: FileTranscriber | null;
  /** after `stop`, how long finalisation waits for the recording upload */
  waitForRecordingMs: number;
  /** Brain concept merge (`MODELS.brain`); null → conservative heuristic */
  decideMerge: MergeDecider | null;
  ai: GoogleGenAI | null;
}

export function createDefaultDeps(env: Env, log: Log, overrides: Partial<ServerDeps> = {}): ServerDeps {
  const db = overrides.store && overrides.auth ? null : createServiceClient(env);
  if (!db && !overrides.store)
    log('config.no_supabase', { note: 'using the in-memory store; every token is rejected' });
  const store: Store = overrides.store ?? (db ? new SupabaseStore(db) : new MemoryStore());
  const auth: Auth = overrides.auth ?? (db ? supabaseAuth(db) : rejectAllAuth);
  const ai = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
  const embed: Embedder = ai ? geminiEmbedder(ai) : noEmbedder;
  const replaySpeed = env.REPLAY_SPEED;

  const createSpeech = (req: SpeechRequest): SpeechAdapter => {
    if (req.source === 'replay-transcript') {
      if (!req.fixture) throw new SpeechUnavailableError('replay-transcript needs a fixture');
      return new TranscriptReplayAdapter(req.fixture, { speed: replaySpeed, fromMs: req.fromMs });
    }
    if (env.STT_PROVIDER !== 'gemini-live') throw new SpeechUnavailableError(`${env.STT_PROVIDER} is not implemented`);
    if (!ai) throw new SpeechUnavailableError('GEMINI_API_KEY is not set on the server');
    return new RotatingSpeechAdapter({
      factory: () => new GeminiLiveUpstream({ ai, nowMs: req.nowMs, log: req.events.log }),
      nowMs: req.nowMs,
      ...req.events,
    });
  };

  return {
    store,
    auth,
    hub: new GraphHub(store, log),
    registry: new LiveRegistry(),
    createInterpreter: createLiveInterpreter as CreateLiveInterpreter,
    finalizeConversation,
    embed,
    createSpeech,
    loadFixture: (id) => loadTranscriptFixture(id),
    newId: randomUUID,
    replaySpeed,
    abandonAfterMs: env.ABANDON_AFTER_MS,
    transcribeFile: ai ? geminiFileTranscriber(ai) : null,
    waitForRecordingMs: 45_000,
    decideMerge: env.ANTHROPIC_API_KEY ? lazyMergeDecider(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })) : null,
    ai,
    ...overrides,
  };
}

/** The merge prompt file (A2's) is read on first use. */
function lazyMergeDecider(client: Anthropic): MergeDecider {
  let decider: Promise<MergeDecider> | null = null;
  return async (req) => {
    decider ??= loadMergeSystemPrompt().then((system) => anthropicMergeDecider(client, system));
    return (await decider)(req);
  };
}
