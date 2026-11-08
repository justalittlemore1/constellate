/**
 * The ONLY place model ids and tuning constants live. Never hard-code a model id elsewhere.
 * Model ids verified against provider docs on 2026-11-07.
 */
export const MODELS = {
  sttLive: 'gemini-3.5-transcribe-live',
  sttFile: 'gemini-3.5-transcribe',
  interpreter: {
    gemini: 'gemini-3.8-flash',
    anthropic: 'claude-haiku-5-5',
    /** latency fallback */
    fast: 'gemini-3.5-flash-lite',
  },
  refine: 'claude-sonnet-5-5',
  brain: 'claude-sonnet-5-5',
  embed: 'gemini-embedding-2',
  embedDims: 768,
  tts: 'gemini-3.8-flash-tts',
} as const;

export type InterpreterProvider = keyof Omit<typeof MODELS.interpreter, 'fast'>;

/** Interpreter tuning — the eval harness is the judge of any change. */
export const INTERPRETER = {
  /** call the LLM after this much new speech */
  windowSpeechMs: 20_000,
  /** …or after a pause this long, if at least `minSpeechForPauseMs` of new speech */
  pauseMs: 1_500,
  minSpeechForPauseMs: 8_000,
  callTimeoutMs: 8_000,
  /** target seconds of speech per committed node (granularity controller) */
  targetSecondsPerNode: 60,
  /** a level-1 node running longer than this with no children gets the "split" hint */
  longSubtopicMs: 3 * 60_000,
  /** this many nodes in `burstWindowMs` without explicit markers gets the "be conservative" hint */
  burstNodes: 3,
  burstWindowMs: 60_000,
  /** commit gate */
  commitAfterMs: 15_000,
  commitAfterUtterances: 2,
  /** similarity thresholds (cosine, unit-normalised embeddings) */
  revisitCandidateMin: 0.75,
  revisitCandidateK: 3,
  pendingAutoResolveMin: 0.82,
  /** context packing */
  recentUtterances: 10,
  rollingSummaryMaxChars: 600,
} as const;

/** Utterances matching this trigger an immediate interpreter call. */
export const DISCOURSE_MARKER =
  /\b(anyway|back to|going back|speaking of|that reminds me|remind me|later|we should talk about|changing the subject|on another note|before I forget)\b/i;

export const BRAIN = {
  conceptCandidateMin: 0.78,
  conceptCandidateK: 5,
  relatedMin: 0.6,
  relatedPerConcept: 4,
  weights: { semantic: 0.5, cooccurrence: 0.3, relation: 0.2 },
} as const;

export const LIVE = {
  /** Gemini Live sessions are capped at 10 minutes; rotate before that */
  rotateAfterMs: 8.5 * 60_000,
  rotateHardMs: 9.75 * 60_000,
  rotateGapMs: 700,
  /** buffer this much PCM if the upstream stalls, then drop oldest frames */
  maxBufferMs: 5_000,
} as const;

export const LABEL_MAX_WORDS = 4;
export const SUMMARY_MAX_CHARS = 140;
