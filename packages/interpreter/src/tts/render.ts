/**
 * Renders transcript fixtures to synthetic multi-speaker audio for A5's STT runner
 * (docs/PLAN.md → Speech pipeline → Quality checks): one `MODELS.tts` voice per speaker, one clip
 * per utterance, 0.3–1.2 s random gaps, optional background noise at -20 dB, 16 kHz mono WAV.
 * Alongside each WAV a `.json` sidecar keeps the script text and the rendered clip times, which is
 * what WER and caption-latency measurements compare against.
 */
import { GoogleGenAI } from '@google/genai';
import { MODELS, type TranscriptFixture } from '@constellate/shared';
import { countGemini } from '../llm/usage';
import { addNoise, concat, decodePcm16, rateFromMime, resample, rng, TARGET_RATE, wav, type Clip } from './audio';

/** The six scenarios rendered by default: short, two speakers, covering shifts, returns and threads. */
export const TTS_FIXTURES = [
  '01-simple-shift',
  '02-drill-down',
  '03-return',
  '05-deferred-resolved',
  '08-java',
  '09-promise',
];

/** Prebuilt Gemini TTS voices, alternating timbre so speakers are easy to tell apart. */
export const VOICES = ['Kore', 'Puck', 'Aoede', 'Charon'];

export type Synthesize = (text: string, voice: string) => Promise<{ pcm: Uint8Array; rate: number }>;

export function geminiSynthesizer(apiKey = process.env.GEMINI_API_KEY): Synthesize {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });
  return async (text, voice) => {
    countGemini(MODELS.tts, 1);
    const res = await ai.models.generateContent({
      model: MODELS.tts,
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const data = part?.inlineData?.data;
    if (!data) throw new Error(`no audio returned for "${text.slice(0, 40)}…"`);
    return { pcm: new Uint8Array(Buffer.from(data, 'base64')), rate: rateFromMime(part.inlineData?.mimeType) };
  };
}

/** Seeded 0.3–1.2 s gaps (the first clip starts after 0.5 s). */
export function gapsFor(fixture: TranscriptFixture, seed: number): number[] {
  const r = rng(seed);
  return fixture.utterances.map((_, i) => (i === 0 ? 500 : Math.round(300 + r() * 900)));
}

export function seedOf(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface Rendered {
  /** clean 16 kHz mono samples */
  samples: Float32Array;
  sidecar: {
    fixture: string;
    rate: number;
    utterances: { id: string; speaker: number; voice: string; text: string; startMs: number; endMs: number }[];
  };
}

export async function renderFixture(fixture: TranscriptFixture, synth: Synthesize): Promise<Rendered> {
  const seed = seedOf(fixture.id);
  const gaps = gapsFor(fixture, seed);
  const clips: Clip[] = [];
  for (const [i, u] of fixture.utterances.entries()) {
    const voice = VOICES[u.speaker % VOICES.length]!;
    const { pcm, rate } = await synth(u.text, voice);
    clips.push({ samples: resample(decodePcm16(pcm), rate, TARGET_RATE), gapMs: gaps[i]! });
  }
  const tail = { samples: new Float32Array(TARGET_RATE), gapMs: 0 }; // 1 s of trailing silence
  const { samples, spans } = concat([...clips, tail]);
  return {
    samples,
    sidecar: {
      fixture: fixture.id,
      rate: TARGET_RATE,
      utterances: fixture.utterances.map((u, i) => ({
        id: `u${i + 1}`,
        speaker: u.speaker,
        voice: VOICES[u.speaker % VOICES.length]!,
        text: u.text,
        startMs: spans[i]![0],
        endMs: spans[i]![1],
      })),
    },
  };
}

/** WAV bytes for a rendering, optionally with background noise `noiseDb` below the speech (e.g. -20). */
export function toWav(r: Rendered, noiseDb: number | null = null): Uint8Array {
  return wav(noiseDb === null ? r.samples : addNoise(r.samples, noiseDb, seedOf(r.sidecar.fixture)));
}
