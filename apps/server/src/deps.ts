import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { loadMergeSystemPrompt } from '@constellate/brain';
import { createLiveInterpreter, finalizeConversation } from '@constellate/interpreter';
import { MODELS, type CreateLiveInterpreter, type FinalizeConversation } from '@constellate/shared';
import { cachedEmbedder, EmbeddingCache, embedCacheFile, noEmbedder, type Embedder } from './ai/embed';
import { assertRealApisAllowed, createGeminiGateway, GeminiGateway } from './ai/gemini';
import { anthropicMergeDecider, type MergeDecider } from './brain/merge-llm';
import { forceClaudeReasoning, type Env } from './env';
import { gatedTranscriber, geminiFileTranscriber, type FileTranscriber } from './finalize/transcribe';
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
  /** the one shared Gemini client (null without a key); usage is on GET /health */
  gemini: GeminiGateway | null;
  /** whether MODELS.sttFile can be used (startup `models.list` probe) */
  sttFile: SttFileProbe;
}

export interface SttFileProbe {
  state: 'checking' | 'available' | 'unavailable' | 'off';
  available: Promise<boolean>;
}

/** One `models.list` at startup (STT_FILE=auto); `on` trusts the config, `off` never transcribes files. */
export function probeSttFile(gemini: GeminiGateway | null, env: Env, log: Log): SttFileProbe {
  if (!gemini || env.STT_FILE === 'off') return { state: 'off', available: Promise.resolve(false) };
  if (env.STT_FILE === 'on') return { state: 'available', available: Promise.resolve(true) };
  const probe: SttFileProbe = { state: 'checking', available: Promise.resolve(false) };
  probe.available = gemini
    .listModels()
    .then((names) => names.includes(MODELS.sttFile))
    .catch((err) => {
      log('gemini.models_list_failed', { message: String(err) });
      return false;
    })
    .then((ok) => {
      probe.state = ok ? 'available' : 'unavailable';
      log('config.stt_file', { model: MODELS.sttFile, available: ok });
      return ok;
    });
  return probe;
}

export function createDefaultDeps(env: Env, log: Log, overrides: Partial<ServerDeps> = {}): ServerDeps {
  const db = overrides.store && overrides.auth ? null : createServiceClient(env);
  if (!db && !overrides.store)
    log('config.no_supabase', { note: 'using the in-memory store; every token is rejected' });
  const store: Store = overrides.store ?? (db ? new SupabaseStore(db) : new MemoryStore());
  const auth: Auth = overrides.auth ?? (db ? supabaseAuth(db) : rejectAllAuth);
  const gemini = overrides.gemini !== undefined ? overrides.gemini : realGemini(env, log);
  const embed: Embedder = gemini
    ? cachedEmbedder({
        fetch: (texts) => gemini.embed(texts),
        cache: new EmbeddingCache(embedCacheFile(env.EMBED_CACHE_FILE)),
        log,
      })
    : noEmbedder;
  const replaySpeed = env.REPLAY_SPEED;
  const sttFile = probeSttFile(gemini, env, log);
  // pin reasoning to Claude for the interpreter package (it reads process.env), whoever builds deps
  forceClaudeReasoning(env, (msg) => log('config.interpreter_provider_overridden', { message: msg }));

  const createSpeech = (req: SpeechRequest): SpeechAdapter => {
    if (req.source === 'replay-transcript') {
      if (!req.fixture) throw new SpeechUnavailableError('replay-transcript needs a fixture');
      return new TranscriptReplayAdapter(req.fixture, { speed: replaySpeed, fromMs: req.fromMs });
    }
    if (env.STT_PROVIDER !== 'gemini-live') throw new SpeechUnavailableError(`${env.STT_PROVIDER} is not implemented`);
    if (!gemini) throw new SpeechUnavailableError('GEMINI_API_KEY is not set on the server');
    return new RotatingSpeechAdapter({
      factory: () => new GeminiLiveUpstream({ gateway: gemini, nowMs: req.nowMs, log: req.events.log }),
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
    transcribeFile:
      gemini && sttFile.state !== 'off' ? gatedTranscriber(sttFile.available, geminiFileTranscriber(gemini)) : null,
    sttFile,
    waitForRecordingMs: 45_000,
    decideMerge:
      overrides.decideMerge !== undefined || !env.ANTHROPIC_API_KEY
        ? null
        : lazyMergeDecider(realAnthropic(env.ANTHROPIC_API_KEY)),
    gemini,
    ...overrides,
  };
}

function realGemini(env: Env, log: Log): GeminiGateway | null {
  if (!env.GEMINI_API_KEY) return null;
  assertRealApisAllowed('GeminiGateway');
  return createGeminiGateway(
    env.GEMINI_API_KEY,
    log,
    GoogleGenAI as unknown as Parameters<typeof createGeminiGateway>[2],
  );
}

function realAnthropic(apiKey: string): Anthropic {
  assertRealApisAllowed('Anthropic client');
  return new Anthropic({ apiKey });
}

/** The merge prompt file (A2's) is read on first use. */
function lazyMergeDecider(client: Anthropic): MergeDecider {
  let decider: Promise<MergeDecider> | null = null;
  return async (req) => {
    decider ??= loadMergeSystemPrompt().then((system) => anthropicMergeDecider(client, system));
    return (await decider)(req);
  };
}
