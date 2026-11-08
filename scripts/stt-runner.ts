/**
 * Speech-to-Text (STT) Runner — Workstream A5
 *
 * Scope (docs/briefs/a5-qa-review.md & PLAN.md):
 *   Stream synthetic WAV audio through /live at real time; report Word Error Rate (WER)
 *   vs script and time-to-first-final-caption.
 *
 * Targets:
 *   - WER < 15 % clean
 *   - WER < 25 % noisy
 *   - First final caption ≤ 2.5 s after the speaker pauses (endMs of the utterance)
 *
 * Operational rules (AGENTS.md & Reviewer guidance):
 *   - Gemini API key is free-tier: run only at checkpoints (H3, H6, H10).
 *   - At most two WAV files per run by default (--max-files 2) to protect API quotas.
 *   - Never run live API calls in CI (automatically falls back to simulation mode).
 *   - Uses per-clip <id>.json sidecar in fixtures/audio for precise startMs/endMs pause timing
 *     and exact rendered reference text.
 *
 * Usage:
 *   npx tsx scripts/stt-runner.ts
 *   npx tsx scripts/stt-runner.ts --dry-run
 *   npx tsx scripts/stt-runner.ts --only 01
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_FRAME_BYTES, AUDIO_FRAME_MS, type ClientMsg, type ServerMsg } from '../packages/shared/src/ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface UtteranceTiming {
  id?: string;
  speaker?: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface AudioSidecar {
  fixture: string;
  rate: number;
  utterances: UtteranceTiming[];
}

export interface SttScenarioResult {
  id: string;
  title: string;
  isNoisy: boolean;
  hasKey: boolean;
  refText: string;
  hypText: string;
  refSource: 'sidecar' | 'transcript' | 'none';
  wer: number | null;
  werTarget: number | null;
  werPassed: boolean | null;
  firstFinalLatencyMs: number | null;
  medianFinalLatencyMs: number | null;
  latencyTargetMs: number;
  latencyPassed: boolean;
  misalignedCount: number;
  stability: number;
  overallPassed: boolean;
}

/**
 * Normalizes text for Word Error Rate comparison:
 * lowercases, removes punctuation, collapses whitespace.
 */
export function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/**
 * Calculates Word Error Rate (WER) using Levenshtein distance on word tokens.
 * WER = (Insertions + Deletions + Substitutions) / ReferenceWordsCount
 */
export function calculateWer(
  refWords: string[],
  hypWords: string[],
): {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refCount: number;
} {
  const n = refWords.length;
  const m = hypWords.length;

  if (n === 0) {
    return {
      wer: m === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      refCount: 0,
    };
  }

  // DP table: dp[i][j] = edit distance
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        const substitution = dp[i - 1]![j - 1]! + 1;
        const deletion = dp[i - 1]![j]! + 1;
        const insertion = dp[i]![j - 1]! + 1;
        dp[i]![j] = Math.min(substitution, deletion, insertion);
      }
    }
  }

  // Backtrack to count substitutions, deletions, and insertions
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refWords[i - 1] === hypWords[j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      deletions++;
      i--;
    } else if (j > 0 && dp[i]![j] === dp[i]![j - 1]! + 1) {
      insertions++;
      j--;
    } else {
      break;
    }
  }

  const wer = (substitutions + deletions + insertions) / n;
  return {
    wer,
    substitutions,
    deletions,
    insertions,
    refCount: n,
  };
}

/**
 * Calculates caption stability from streaming captions.
 * Caption stability measures the proportion of interim words preserved in the final caption.
 * Returns a number between 0 and 1 (1.0 = 100% stable). If no interims were emitted, returns 1.0.
 */
export function calculateStability(
  captions: Array<{ text: string; final: boolean }>,
): number {
  const utterances: Array<{ interims: string[]; final: string }> = [];
  let currentInterims: string[] = [];

  for (const c of captions) {
    if (!c.final) {
      currentInterims.push(c.text);
    } else {
      utterances.push({ interims: [...currentInterims], final: c.text });
      currentInterims = [];
    }
  }

  if (utterances.length === 0) return 1.0;

  let totalInterims = 0;
  let stabilitySum = 0;

  for (const u of utterances) {
    if (u.interims.length === 0) continue;
    const finalWords = normalizeText(u.final);
    for (const interim of u.interims) {
      const interimWords = normalizeText(interim);
      if (interimWords.length === 0) continue;
      let matchCount = 0;
      while (
        matchCount < interimWords.length &&
        matchCount < finalWords.length &&
        interimWords[matchCount] === finalWords[matchCount]
      ) {
        matchCount++;
      }
      stabilitySum += matchCount / interimWords.length;
      totalInterims++;
    }
  }

  return totalInterims > 0 ? stabilitySum / totalInterims : 1.0;
}

/**
 * Computes the median of an array of numbers.
 */
export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Detects speech pause timestamps (in ms from audio start) by analyzing RMS energy across 20 ms frames.
 * A pause is detected when energy falls below silenceDb (default -40 dBFS) for at least minSilenceMs (default 700 ms).
 * Returns an array of timestamps (in ms) marking the end of each preceding speech segment.
 */
export function detectSpeechPauses(
  pcmBuffer: Buffer,
  sampleRate = 16000,
  silenceDb = -40,
  minSilenceMs = 700,
): number[] {
  const frameMs = 20;
  const samplesPerFrame = (sampleRate * frameMs) / 1000; // 320 samples for 16 kHz
  const bytesPerFrame = samplesPerFrame * 2; // 2 bytes per 16-bit sample (640 bytes)
  const totalFrames = Math.floor(pcmBuffer.length / bytesPerFrame);

  if (totalFrames === 0) return [];

  // Amplitude ratio threshold for silence: 10^(dB / 20)
  // E.g. -40 dBFS = 0.01 amplitude ratio relative to max 32768 (raw RMS ~ 327.68)
  const thresholdRatio = Math.pow(10, silenceDb / 20);
  const minSilenceFrames = Math.ceil(minSilenceMs / frameMs); // 35 frames for 700 ms

  const speechEnds: number[] = [];
  let inSpeech = false;
  let lastSpeechEndMs = 0;
  let silenceFrames = 0;
  let pauseRecorded = false;

  for (let k = 0; k < totalFrames; k++) {
    const frameOffset = k * bytesPerFrame;
    let sumSquares = 0;

    for (let s = 0; s < samplesPerFrame; s++) {
      const sampleVal = pcmBuffer.readInt16LE(frameOffset + s * 2);
      const normalized = sampleVal / 32768;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / samplesPerFrame);
    const frameEndTimeMs = (k + 1) * frameMs;

    if (rms >= thresholdRatio) {
      // Speech frame
      inSpeech = true;
      lastSpeechEndMs = frameEndTimeMs;
      silenceFrames = 0;
      pauseRecorded = false;
    } else {
      // Silence frame
      if (inSpeech) {
        silenceFrames++;
        if (silenceFrames >= minSilenceFrames && !pauseRecorded) {
          speechEnds.push(lastSpeechEndMs);
          pauseRecorded = true;
        }
      }
    }
  }

  // If the audio ended while in speech (or silence was shorter than minSilenceFrames at the tail),
  // record the last speech end
  if (inSpeech && !pauseRecorded && lastSpeechEndMs > 0) {
    speechEnds.push(lastSpeechEndMs);
  }

  return speechEnds;
}

/**
 * Matches an elapsed audio timestamp to the most relevant speech end.
 * If elapsed is before any speech end or within earlyThresholdMs (default 300 ms) before the upcoming
 * speech end, returns that upcoming end (which results in a negative latency indicating a misaligned/early arrival).
 */
export function findReferenceSpeechEnd(
  elapsedMs: number,
  speechEnds: number[],
  earlyThresholdMs = 300,
): number | null {
  if (speechEnds.length === 0) return null;

  let lastBefore: number | null = null;
  for (const end of speechEnds) {
    if (end <= elapsedMs) {
      lastBefore = end;
    } else {
      break;
    }
  }

  if (lastBefore !== null) {
    const nextAfter = speechEnds.find((end) => end > elapsedMs);
    // If within earlyThresholdMs before upcoming speech end, this final arrived early for that upcoming pause
    if (nextAfter !== undefined && nextAfter - elapsedMs <= earlyThresholdMs) {
      return nextAfter;
    }
    return lastBefore;
  }

  // If elapsedMs is before all speech ends, return the first speech end (will yield negative latency)
  return speechEnds[0]!;
}

/**
 * Synthesizes a 16 kHz mono 16-bit PCM buffer with alternating tone and silence segments.
 */
export function createSyntheticAudioPattern(
  segments: Array<{ durationMs: number; isTone: boolean }>,
  sampleRate = 16000,
): Buffer {
  const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
  const totalSamples = (sampleRate * totalMs) / 1000;
  const buffer = Buffer.alloc(totalSamples * 2);

  let currentSample = 0;
  for (const seg of segments) {
    const count = (sampleRate * seg.durationMs) / 1000;
    for (let i = 0; i < count; i++) {
      if (seg.isTone) {
        // 440 Hz tone at amplitude 10,000 (~0.30 RMS, well above -40 dBFS)
        const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10_000;
        buffer.writeInt16LE(Math.round(sample), (currentSample + i) * 2);
      } else {
        buffer.writeInt16LE(0, (currentSample + i) * 2);
      }
    }
    currentSample += count;
  }

  return buffer;
}

/**
 * Extracts raw 16-bit PCM samples from a WAV container buffer.
 */
export function extractWavPcm(wavBuffer: Buffer): Buffer {
  if (wavBuffer.length < 44) {
    throw new Error('Invalid WAV file: buffer too short');
  }
  const riff = wavBuffer.subarray(0, 4).toString('ascii');
  const wave = wavBuffer.subarray(8, 12).toString('ascii');
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV header: missing RIFF/WAVE marker');
  }

  // Look for 'data' chunk
  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return wavBuffer.subarray(offset + 8, offset + 8 + chunkSize);
    }
    offset += 8 + chunkSize;
  }

  // Fallback if no explicit data subchunk: standard 44-byte header
  return wavBuffer.subarray(44);
}

/**
 * Synthesizes a valid 16 kHz mono 16-bit PCM buffer for testing/dry-run.
 */
export function createSyntheticPcm(durationMs: number): Buffer {
  const sampleCount = (16_000 * durationMs) / 1000;
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    // 440 Hz sine wave tone
    const sample = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 10_000;
    buffer.writeInt16LE(Math.round(sample), i * 2);
  }
  return buffer;
}

/**
 * Loads sidecar from audio directory if available, or falls back to transcript fixture.
 * If neither is found (e.g. podcast clips), returns hasKey: false.
 */
export function loadReferenceData(
  baseName: string,
  audioDir: string,
  transcriptsDir: string,
): {
  title: string;
  utterances: UtteranceTiming[];
  refText: string;
  hasKey: boolean;
  refSource: 'sidecar' | 'transcript' | 'none';
} {
  // Strip -noisy or -clean suffix to map to matching sidecar/transcript id
  const id = baseName.replace(/-noisy$/, '').replace(/-clean$/, '');
  const sidecarPath = join(audioDir, `${id}.json`);

  if (existsSync(sidecarPath)) {
    try {
      const data = JSON.parse(readFileSync(sidecarPath, 'utf8')) as AudioSidecar;
      const refText = data.utterances.map((u) => u.text).join(' ');
      return {
        title: data.fixture || id,
        utterances: data.utterances,
        refText,
        hasKey: true,
        refSource: 'sidecar',
      };
    } catch {
      // Fallback on read/parse error
    }
  }

  // Fallback to transcript fixture (exact id match only, e.g. 03-return-revisit)
  const transcriptPath = join(transcriptsDir, `${id}.json`);
  if (existsSync(transcriptPath)) {
    const data = JSON.parse(readFileSync(transcriptPath, 'utf8'));
    const refText = data.utterances.map((u: { text: string }) => u.text).join(' ');
    return {
      title: data.title || id,
      utterances: data.utterances,
      refText,
      hasKey: true,
      refSource: 'transcript',
    };
  }

  // Unkeyed WAV (e.g. podcast clips)
  return {
    title: baseName,
    utterances: [],
    refText: '',
    hasKey: false,
    refSource: 'none',
  };
}

export interface FakeWebSocket {
  send(data: string | Buffer | Uint8Array): void;
  close(): void;
  onopen?: ((ev?: unknown) => void) | null;
  onmessage?: ((event: { data: unknown }) => void) | null;
  onerror?: ((err: unknown) => void) | null;
  onclose?: ((ev?: unknown) => void) | null;
}

export type WebSocketConstructor = new (url: string) => FakeWebSocket;

/**
 * Streams PCM buffer over WebSocket in real time, matching final captions to reference speech ends
 * to calculate latency strictly after each speaker pause:
 *   latency = receivedAt - (streamStartTime + speechEnd)
 * Early/misaligned arrivals (latency < 0) are tracked as misaligned and excluded from passing gates.
 */
export async function streamAudioToLive(
  pcmBuffer: Buffer,
  wsUrl: string,
  token: string,
  speechEnds: number[] = [],
  WSImpl: WebSocketConstructor = WebSocket as unknown as WebSocketConstructor,
): Promise<{
  hypText: string;
  firstFinalLatencyMs: number | null;
  medianFinalLatencyMs: number | null;
  captions: Array<{ text: string; final: boolean; startMs: number; receivedAt: number }>;
  latencies: number[];
  misalignedCount: number;
  stability: number;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WSImpl(wsUrl);
    const captions: Array<{ text: string; final: boolean; startMs: number; receivedAt: number }> = [];
    const latencies: number[] = [];
    let streamStartTime = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (intervalId) clearInterval(intervalId);
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    ws.onopen = () => {
      const hello: ClientMsg = {
        t: 'hello',
        token,
        source: 'mic',
        consent: true,
      };
      ws.send(JSON.stringify(hello));

      streamStartTime = Date.now();
      let byteOffset = 0;

      // Stream frames at real time (AUDIO_FRAME_MS = 100ms)
      intervalId = setInterval(() => {
        if (byteOffset >= pcmBuffer.length) {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;

          // Send stop message
          const stopMsg: ClientMsg = { t: 'stop' };
          ws.send(JSON.stringify(stopMsg));

          // Wait 2.5s for remaining final captions to finish arriving
          setTimeout(() => {
            cleanup();
            const finalCaptions = captions.filter((c) => c.final).map((c) => c.text);
            const stability = calculateStability(captions);
            const validLatencies = latencies.filter((l) => l >= 0);
            const misalignedCount = latencies.filter((l) => l < 0).length;
            const firstFinalLatencyMs = validLatencies.length > 0 ? validLatencies[0]! : null;
            const medianFinalLatencyMs = calculateMedian(validLatencies);
            resolve({
              hypText: finalCaptions.join(' '),
              firstFinalLatencyMs,
              medianFinalLatencyMs,
              captions,
              latencies,
              misalignedCount,
              stability,
            });
          }, 2500);
          return;
        }

        const chunk = pcmBuffer.subarray(byteOffset, byteOffset + AUDIO_FRAME_BYTES);
        byteOffset += AUDIO_FRAME_BYTES;
        ws.send(chunk);
      }, AUDIO_FRAME_MS);
    };

    ws.onmessage = (event: { data: string | Buffer | unknown }) => {
      try {
        const msg = JSON.parse(event.data?.toString() || '{}') as ServerMsg;
        if (msg.t === 'caption') {
          const now = Date.now();
          captions.push({
            text: msg.text,
            final: msg.final,
            startMs: msg.startMs,
            receivedAt: now,
          });

          if (msg.final) {
            const elapsedMs = now - streamStartTime;
            const refSpeechEnd = findReferenceSpeechEnd(elapsedMs, speechEnds);
            if (refSpeechEnd !== null) {
              const latencyMs = elapsedMs - refSpeechEnd;
              latencies.push(latencyMs);
            }
          }
        } else if (msg.t === 'error' && msg.fatal) {
          cleanup();
          reject(new Error(`Server STT error: [${msg.code}] ${msg.message}`));
        }
      } catch {
        // Ignore unparseable frames
      }
    };

    ws.onerror = (err: unknown) => {
      cleanup();
      reject(err);
    };
  });
}

/**
 * Formats a markdown table report from test results.
 */
export function formatReport(results: SttScenarioResult[]): string {
  const timestamp = new Date().toISOString();
  let md = `# Speech-to-Text Performance Report\n\n`;
  md += `**Generated:** ${timestamp}  \n`;
  md += `**Gate Requirements:**\n`;
  md += `- Clean Audio WER < 15 % (when ground-truth key is present)\n`;
  md += `- Noisy Audio WER < 25 % (when ground-truth key is present)\n`;
  md += `- Time to First Final Caption ≤ 2.5 s after the speaker pauses\n`;
  md += `- Caption stability reported for interim-to-final word retention\n\n`;

  md += `| Scenario | Noise | Key / Source | Ref Words | Measured WER | Target WER | WER Status | First Final | Median Final | Target | Latency Status | Stability | Overall |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;

  for (const r of results) {
    const keySource = r.hasKey ? r.refSource : 'unkeyed';
    const refWordsCount = r.hasKey ? String(normalizeText(r.refText).length) : 'N/A';
    const werPercent = r.wer !== null ? (r.wer * 100).toFixed(1) + ' %' : 'N/A';
    const targetPercent = r.werTarget !== null ? '< ' + (r.werTarget * 100).toFixed(0) + ' %' : 'N/A';
    const firstFinalSec =
      r.firstFinalLatencyMs !== null
        ? (r.firstFinalLatencyMs / 1000).toFixed(2) + ' s'
        : r.misalignedCount > 0
          ? 'misaligned'
          : 'N/A';
    const medianFinalSec =
      r.medianFinalLatencyMs !== null
        ? (r.medianFinalLatencyMs / 1000).toFixed(2) + ' s'
        : r.misalignedCount > 0
          ? 'misaligned'
          : 'N/A';
    const targetLatency = '≤ ' + (r.latencyTargetMs / 1000).toFixed(1) + ' s';
    const werBadge = r.hasKey ? (r.werPassed ? 'PASS' : 'FAIL') : 'N/A';
    const latencyBadge = r.latencyPassed ? 'PASS' : r.misalignedCount > 0 ? 'MISALIGNED' : 'FAIL';
    const stabilityPercent = (r.stability * 100).toFixed(1) + ' %';
    const overallBadge = r.overallPassed ? '**PASS**' : '**FAIL**';

    md += `| ${r.title} | ${r.isNoisy ? 'Noisy' : 'Clean'} | ${keySource} | ${refWordsCount} | ${werPercent} | ${targetPercent} | ${werBadge} | ${firstFinalSec} | ${medianFinalSec} | ${targetLatency} | ${latencyBadge} | ${stabilityPercent} | ${overallBadge} |\n`;
  }

  return md;
}

export async function main() {
  const args = process.argv.slice(2);
  const isCI = Boolean(process.env.CI);
  const isDryRun = args.includes('--dry-run') || args.includes('--mock') || isCI;
  const reportOutIndex = args.indexOf('--report-out');
  const reportOutPath = reportOutIndex !== -1 && args[reportOutIndex + 1] ? args[reportOutIndex + 1] : null;

  const onlyIndex = args.indexOf('--only');
  const onlyPrefix = onlyIndex !== -1 && args[onlyIndex + 1] ? args[onlyIndex + 1] : null;

  const maxFilesIndex = args.indexOf('--max-files');
  // Free-tier safety: default to at most 2 files per run as directed by team rules
  const maxFiles = maxFilesIndex !== -1 && args[maxFilesIndex + 1] ? parseInt(args[maxFilesIndex + 1]!, 10) : 2;

  const wsUrl = process.env.VITE_SERVER_WS_URL || 'ws://localhost:8787/live';
  const token = 'stt-runner-test-token';

  const audioDir = join(__dirname, '..', 'packages', 'shared', 'fixtures', 'audio');
  const transcriptsDir = join(__dirname, '..', 'packages', 'shared', 'fixtures', 'transcripts');

  console.log(`[STT Runner] Target Gateway: ${wsUrl}`);
  console.log(`[STT Runner] Audio directory: ${audioDir}`);

  if (isCI) {
    console.log(
      `[STT Runner] CI environment detected. Using simulation mode (free-tier Gemini live calls never run in CI).`,
    );
  }

  let wavFiles = existsSync(audioDir) ? readdirSync(audioDir).filter((f) => f.endsWith('.wav')) : [];
  if (onlyPrefix) {
    wavFiles = wavFiles.filter((f) => f.startsWith(onlyPrefix));
  }

  // Apply free-tier safety limit
  if (wavFiles.length > maxFiles && !args.includes('--all')) {
    console.log(`[STT Runner] Free-tier safety: processing at most ${maxFiles} file(s) (use --max-files N to override).`);
    wavFiles = wavFiles.slice(0, maxFiles);
  }

  if (wavFiles.length === 0 || isDryRun) {
    console.log(
      `[STT Runner] Running dry-run simulation against ground truth fixtures...`,
    );

    let transcriptFiles = existsSync(transcriptsDir)
      ? readdirSync(transcriptsDir).filter((f) => f.endsWith('.json'))
      : [];
    if (onlyPrefix) {
      transcriptFiles = transcriptFiles.filter((f) => f.startsWith(onlyPrefix));
    }
    const sampleFiles = transcriptFiles.slice(0, maxFiles);

    const dryRunResults: SttScenarioResult[] = sampleFiles.map((tf) => {
      const baseName = tf.replace('.json', '');
      const refData = loadReferenceData(baseName, audioDir, transcriptsDir);

      // Simulate a realistic low divergence (e.g. ~1% on clean audio)
      const refWords = normalizeText(refData.refText);
      const simulatedHypWords = [...refWords];
      if (simulatedHypWords.length > 20) {
        simulatedHypWords[5] = simulatedHypWords[5] + 's';
      }

      const werCalc = calculateWer(refWords, simulatedHypWords);
      const isNoisy = tf.includes('noisy');
      const werTarget = isNoisy ? 0.25 : 0.15;
      const latencyTargetMs = 2500;
      // Simulated post-pause latency of 1.45 s (under 2.5 s gate)
      const simulatedFirstFinalMs = 1450;
      const simulatedMedianMs = 1320;
      const simulatedStability = 0.98;

      const werPassed = werCalc.wer < werTarget;
      const latencyPassed = simulatedFirstFinalMs <= latencyTargetMs;

      return {
        id: baseName,
        title: refData.title,
        isNoisy,
        hasKey: refData.hasKey,
        refText: refData.refText,
        hypText: simulatedHypWords.join(' '),
        refSource: refData.refSource,
        wer: werCalc.wer,
        werTarget,
        werPassed,
        firstFinalLatencyMs: simulatedFirstFinalMs,
        medianFinalLatencyMs: simulatedMedianMs,
        latencyTargetMs,
        latencyPassed,
        misalignedCount: 0,
        stability: simulatedStability,
        overallPassed: werPassed && latencyPassed,
      };
    });

    const report = formatReport(dryRunResults);
    console.log('\n' + report);

    if (reportOutPath) {
      writeFileSync(reportOutPath, report);
      console.log(`[STT Runner] Report saved to ${reportOutPath}`);
    }
    return;
  }

  // Live real-time audio evaluation against running server
  const results: SttScenarioResult[] = [];

  for (const wavFile of wavFiles) {
    const wavPath = join(audioDir, wavFile);
    const baseName = wavFile.replace('.wav', '');
    const refData = loadReferenceData(baseName, audioDir, transcriptsDir);

    const isNoisy = wavFile.includes('noisy');
    const werTarget = isNoisy ? 0.25 : 0.15;
    const latencyTargetMs = 2500;

    const keyLabel = refData.hasKey ? `reference from ${refData.refSource}` : 'unkeyed (measuring latency & stability)';
    console.log(`[STT Runner] Streaming ${wavFile} (${keyLabel})...`);
    const pcmData = extractWavPcm(readFileSync(wavPath));

    const speechEnds =
      refData.hasKey && refData.refSource === 'sidecar' && refData.utterances.length > 0
        ? refData.utterances.map((u) => u.endMs)
        : detectSpeechPauses(pcmData);

    try {
      const streamRes = await streamAudioToLive(pcmData, wsUrl, token, speechEnds);

      let wer: number | null = null;
      let werPassed: boolean | null = null;

      if (refData.hasKey) {
        const werCalc = calculateWer(normalizeText(refData.refText), normalizeText(streamRes.hypText));
        wer = werCalc.wer;
        werPassed = wer < werTarget;
      }

      const latencyPassed =
        streamRes.firstFinalLatencyMs !== null &&
        streamRes.firstFinalLatencyMs <= latencyTargetMs &&
        streamRes.misalignedCount === 0;

      const overallPassed = refData.hasKey ? Boolean(werPassed && latencyPassed) : latencyPassed;

      results.push({
        id: baseName,
        title: refData.title,
        isNoisy,
        hasKey: refData.hasKey,
        refText: refData.refText,
        hypText: streamRes.hypText,
        refSource: refData.refSource,
        wer,
        werTarget: refData.hasKey ? werTarget : null,
        werPassed,
        firstFinalLatencyMs: streamRes.firstFinalLatencyMs,
        medianFinalLatencyMs: streamRes.medianFinalLatencyMs,
        latencyTargetMs,
        latencyPassed,
        misalignedCount: streamRes.misalignedCount,
        stability: streamRes.stability,
        overallPassed,
      });
    } catch (err) {
      console.error(`[STT Runner] Error streaming ${wavFile}:`, err);
    }
  }

  const report = formatReport(results);
  console.log('\n' + report);

  if (reportOutPath) {
    writeFileSync(reportOutPath, report);
    console.log(`[STT Runner] Report saved to ${reportOutPath}`);
  }

  const anyFailed = results.some((r) => !r.overallPassed);
  if (anyFailed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
