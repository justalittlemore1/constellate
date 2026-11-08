import type { Part } from '@google/genai';
import type { Ms } from '@constellate/shared';
import type { GeminiGateway } from '../ai/gemini';

/** One speaker turn from the post-recording transcript. */
export interface FileSegment {
  speaker: number | null;
  startMs: Ms;
  endMs: Ms;
  text: string;
}

export type FileTranscriber = (audio: Buffer, mimeType: string) => Promise<FileSegment[]>;

/** PLAN: diarization and word timestamps are limited to 30 minutes of audio. */
export const MAX_DIARIZED_MS = 30 * 60_000;

/** "1.240s" → 1240 */
export function parseOffset(v: string | undefined): Ms | null {
  if (!v) return null;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(v.trim());
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/**
 * Pure: `audioTranscription` parts → speaker turns. Speaker labels ("spk_1", …) become indices
 * 0, 1, … in order of first appearance; consecutive parts from the same speaker are merged.
 */
export function partsToSegments(parts: readonly Part[]): FileSegment[] {
  const speakers = new Map<string, number>();
  const out: FileSegment[] = [];
  for (const p of parts) {
    const t = p.audioTranscription;
    if (!t) continue;
    const words = (t.words ?? []).filter((w) => w.word?.trim());
    const text = (words.length ? words.map((w) => w.word!.trim()).join(' ') : (t.text ?? '')).trim();
    if (!text) continue;
    const start = parseOffset(words[0]?.startOffset) ?? parseOffset(t.startOffset);
    const end = parseOffset(words.at(-1)?.endOffset) ?? parseOffset(t.endOffset);
    if (start === null || end === null) continue;
    let speaker: number | null = null;
    if (t.speakerLabel) {
      if (!speakers.has(t.speakerLabel)) speakers.set(t.speakerLabel, speakers.size);
      speaker = speakers.get(t.speakerLabel)!;
    }
    const prev = out.at(-1);
    if (prev && prev.speaker === speaker) {
      prev.text = `${prev.text} ${text}`;
      prev.endMs = Math.max(prev.endMs, end);
    } else {
      out.push({ speaker, startMs: start, endMs: Math.max(start, end), text });
    }
  }
  return out;
}

/** `MODELS.sttFile` with diarization + word timestamps, through the shared counting client. */
export function geminiFileTranscriber(gateway: Pick<GeminiGateway, 'transcribeFile'>): FileTranscriber {
  return async (audio, mimeType) => {
    const segments = partsToSegments(await gateway.transcribeFile(audio, mimeType));
    if (!segments.length) throw new Error('transcription returned no segments');
    return segments;
  };
}

/** MODELS.sttFile is not available to the key (startup `models.list` probe), so it was never called. */
export class SttFileUnavailableError extends Error {
  constructor() {
    super('file transcription model is not available to this key');
    this.name = 'SttFileUnavailableError';
  }
}

/** Calls `inner` only once the startup probe has confirmed MODELS.sttFile exists. */
export function gatedTranscriber(available: Promise<boolean>, inner: FileTranscriber): FileTranscriber {
  return async (audio, mimeType) => {
    if (!(await available)) throw new SttFileUnavailableError();
    return inner(audio, mimeType);
  };
}
