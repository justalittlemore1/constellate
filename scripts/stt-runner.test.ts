import { describe, expect, test } from 'vitest';
import {
  calculateMedian,
  calculateStability,
  calculateWer,
  createSyntheticAudioPattern,
  createSyntheticPcm,
  detectSpeechPauses,
  extractWavPcm,
  FakeWebSocket,
  findReferenceSpeechEnd,
  formatReport,
  loadReferenceData,
  normalizeText,
  streamAudioToLive,
  type SttScenarioResult,
} from './stt-runner';

describe('STT Runner Utilities', () => {
  describe('normalizeText', () => {
    test('lowercases and strips punctuation', () => {
      const input = 'Hello, world! Are you ready?';
      const output = normalizeText(input);
      expect(output).toEqual(['hello', 'world', 'are', 'you', 'ready']);
    });

    test('collapses extraneous whitespace and trims', () => {
      const input = '   Did   you see   that?\n\t';
      const output = normalizeText(input);
      expect(output).toEqual(['did', 'you', 'see', 'that']);
    });
  });

  describe('calculateWer (Word Error Rate)', () => {
    test('returns 0 WER for identical transcripts', () => {
      const ref = ['the', 'quick', 'brown', 'fox'];
      const hyp = ['the', 'quick', 'brown', 'fox'];
      const res = calculateWer(ref, hyp);
      expect(res.wer).toBe(0);
      expect(res.substitutions).toBe(0);
      expect(res.deletions).toBe(0);
      expect(res.insertions).toBe(0);
    });

    test('calculates substitutions correctly', () => {
      const ref = ['the', 'quick', 'brown', 'fox'];
      const hyp = ['the', 'fast', 'brown', 'fox'];
      const res = calculateWer(ref, hyp);
      expect(res.wer).toBe(0.25);
      expect(res.substitutions).toBe(1);
    });

    test('calculates deletions correctly', () => {
      const ref = ['the', 'quick', 'brown', 'fox'];
      const hyp = ['the', 'fox'];
      const res = calculateWer(ref, hyp);
      expect(res.wer).toBe(0.5);
      expect(res.deletions).toBe(2);
    });

    test('calculates insertions correctly', () => {
      const ref = ['the', 'fox'];
      const hyp = ['the', 'quick', 'brown', 'fox'];
      const res = calculateWer(ref, hyp);
      expect(res.wer).toBe(1); // 2 insertions / 2 ref words
      expect(res.insertions).toBe(2);
    });

    test('handles empty reference and hypothesis', () => {
      expect(calculateWer([], []).wer).toBe(0);
      expect(calculateWer([], ['word']).wer).toBe(1);
    });
  });

  describe('calculateStability', () => {
    test('returns 1.0 when no interims were emitted or interims match final prefix', () => {
      expect(calculateStability([])).toBe(1.0);
      expect(
        calculateStability([
          { text: 'did you', final: false },
          { text: 'did you catch the game', final: true },
        ]),
      ).toBe(1.0);
    });

    test('penalizes words that are retracted or changed before finalization', () => {
      const stability = calculateStability([
        { text: 'did you see', final: false }, // "see" is not matching "catch"
        { text: 'did you catch the game', final: true },
      ]);
      // "did you see" has 3 words, 2 matched prefix ("did you"), so 2/3 = ~0.67
      expect(stability).toBeCloseTo(2 / 3, 2);
    });
  });

  describe('detectSpeechPauses', () => {
    test('detects pause timestamps from synthetic PCM with tone, silence, and tone', () => {
      // 1000 ms tone, 800 ms silence, 1200 ms tone, 900 ms silence
      const pcm = createSyntheticAudioPattern([
        { durationMs: 1000, isTone: true },
        { durationMs: 800, isTone: false },
        { durationMs: 1200, isTone: true },
        { durationMs: 900, isTone: false },
      ]);

      const pauses = detectSpeechPauses(pcm);
      // Speeches ended at 1000 ms and 3000 ms (1000 + 800 + 1200)
      expect(pauses).toEqual([1000, 3000]);
    });

    test('ignores pauses shorter than minSilenceMs (700 ms)', () => {
      // 1000 ms tone, 400 ms silence (not a pause), 1000 ms tone, 800 ms silence (qualifies)
      const pcm = createSyntheticAudioPattern([
        { durationMs: 1000, isTone: true },
        { durationMs: 400, isTone: false },
        { durationMs: 1000, isTone: true },
        { durationMs: 800, isTone: false },
      ]);

      const pauses = detectSpeechPauses(pcm);
      // Continuous speech across the 400ms gap until final silence at 2400 ms
      expect(pauses).toEqual([2400]);
    });
  });

  describe('findReferenceSpeechEnd', () => {
    test('matches elapsed timestamp to the most recent speech end', () => {
      const speechEnds = [1000, 3000, 6000];
      // Arrived at 1500 ms -> matches 1000 ms (latency = +500 ms)
      expect(findReferenceSpeechEnd(1500, speechEnds)).toBe(1000);
      // Arrived at 3800 ms -> matches 3000 ms (latency = +800 ms)
      expect(findReferenceSpeechEnd(3800, speechEnds)).toBe(3000);
    });

    test('identifies early arrival arriving before upcoming speech end as misaligned', () => {
      const speechEnds = [1000, 3000, 6000];
      // Arrived at 2900 ms, just 100 ms before speech end 3000 ms
      expect(findReferenceSpeechEnd(2900, speechEnds)).toBe(3000);
      // Arrived at 800 ms, before first speech end at 1000 ms
      expect(findReferenceSpeechEnd(800, speechEnds)).toBe(1000);
    });
  });

  describe('calculateMedian', () => {
    test('computes median for odd and even number of items', () => {
      expect(calculateMedian([])).toBeNull();
      expect(calculateMedian([100])).toBe(100);
      expect(calculateMedian([300, 100, 200])).toBe(200);
      expect(calculateMedian([400, 100, 300, 200])).toBe(250);
    });
  });

  describe('extractWavPcm', () => {
    test('throws on short or invalid buffer', () => {
      expect(() => extractWavPcm(Buffer.alloc(10))).toThrow();
    });

    test('extracts PCM data from a valid WAV header with data chunk', () => {
      // Build a minimal 44-byte WAV header
      const header = Buffer.alloc(44);
      header.write('RIFF', 0, 'ascii');
      header.writeUInt32LE(36 + 10, 4); // file size - 8
      header.write('WAVE', 8, 'ascii');
      header.write('fmt ', 12, 'ascii');
      header.writeUInt32LE(16, 16); // fmt chunk size
      header.writeUInt16LE(1, 20); // PCM format = 1
      header.writeUInt16LE(1, 22); // 1 channel
      header.writeUInt32LE(16_000, 24); // sample rate 16000
      header.writeUInt32LE(32_000, 28); // byte rate
      header.writeUInt16LE(2, 32); // block align
      header.writeUInt16LE(16, 34); // bits per sample
      header.write('data', 36, 'ascii');
      header.writeUInt32LE(10, 40); // data size = 10 bytes

      const pcmPayload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const fullWav = Buffer.concat([header, pcmPayload]);

      const extracted = extractWavPcm(fullWav);
      expect(extracted).toEqual(pcmPayload);
    });
  });

  describe('createSyntheticPcm', () => {
    test('creates correct number of 16-bit mono 16 kHz samples', () => {
      const pcm = createSyntheticPcm(100); // 100ms
      // 16,000 samples/s * 0.1s = 1,600 samples * 2 bytes = 3,200 bytes
      expect(pcm.length).toBe(3200);
    });
  });

  describe('loadReferenceData', () => {
    test('falls back gracefully to transcript when sidecar not present', () => {
      const res = loadReferenceData('01-simple-shift', 'non-existent-dir', 'packages/shared/fixtures/transcripts');
      expect(res.title).toContain('Simple shift');
      expect(res.hasKey).toBe(true);
      expect(res.refSource).toBe('transcript');
      expect(res.utterances.length).toBeGreaterThan(0);
      expect(res.refText.length).toBeGreaterThan(0);
    });

    test('enforces exact fixture-id match and ignores prefix-only matches', () => {
      // 01-nonexistent should NOT match 01-simple-shift
      const res = loadReferenceData('01-nonexistent', 'non-existent-dir', 'packages/shared/fixtures/transcripts');
      expect(res.hasKey).toBe(false);
      expect(res.refSource).toBe('none');
      expect(res.refText).toBe('');
    });

    test('handles unkeyed audio files gracefully (podcasts)', () => {
      const res = loadReferenceData('podcast-clip-01', 'non-existent-dir', 'packages/shared/fixtures/transcripts');
      expect(res.hasKey).toBe(false);
      expect(res.refSource).toBe('none');
      expect(res.refText).toBe('');
      expect(res.utterances).toEqual([]);
    });
  });

  describe('formatReport', () => {
    test('formats markdown report with target comparisons and badges', () => {
      const sampleResults: SttScenarioResult[] = [
        {
          id: '01-simple-shift',
          title: 'Hockey to music',
          isNoisy: false,
          hasKey: true,
          refText: 'Did you catch the game',
          hypText: 'Did you catch the game',
          refSource: 'sidecar',
          wer: 0,
          werTarget: 0.15,
          werPassed: true,
          firstFinalLatencyMs: 1400,
          medianFinalLatencyMs: 1350,
          latencyTargetMs: 2500,
          latencyPassed: true,
          misalignedCount: 0,
          stability: 0.98,
          overallPassed: true,
        },
        {
          id: 'podcast-clip',
          title: 'Podcast Interview',
          isNoisy: false,
          hasKey: false,
          refText: '',
          hypText: 'Welcome to the show everyone',
          refSource: 'none',
          wer: null,
          werTarget: null,
          werPassed: null,
          firstFinalLatencyMs: 1200,
          medianFinalLatencyMs: 1100,
          latencyTargetMs: 2500,
          latencyPassed: true,
          misalignedCount: 0,
          stability: 0.95,
          overallPassed: true,
        },
      ];

      const report = formatReport(sampleResults);
      expect(report).toContain('# Speech-to-Text Performance Report');
      expect(report).toContain('Hockey to music');
      expect(report).toContain('0.0 %');
      expect(report).toContain('1.40 s');
      expect(report).toContain('1.35 s');
      expect(report).toContain('98.0 %');
      expect(report).toContain('unkeyed');
      expect(report).toContain('95.0 %');
      expect(report).toContain('**PASS**');
    });
  });

  describe('streamAudioToLive with FakeWebSocket', () => {
    test('calculates first-final and median latency after speaker pauses', async () => {
      // Fake socket that responds to client streaming
      class MockSocket implements FakeWebSocket {
        onopen?: () => void;
        onmessage?: (event: { data: unknown }) => void;
        onerror?: (err: unknown) => void;
        onclose?: () => void;

        private streamStartTime = 0;

        constructor(_url: string) {
          setTimeout(() => {
            this.streamStartTime = Date.now();
            this.onopen?.();
          }, 10);
        }

        send(data: string | Buffer | Uint8Array) {
          if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            if (parsed.t === 'hello') {
              // Immediately respond with ready
              this.onmessage?.({
                data: JSON.stringify({ t: 'ready', conversationId: 'conv-mock' }),
              });

              // Simulate speaker speaking until endMs = 200ms, then pausing.
              // At endMs + 500ms (700ms after stream start), caption arrives:
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({
                    t: 'caption',
                    text: 'Did you catch the game',
                    final: true,
                    startMs: 0,
                  }),
                });
              }, 700);

              // Simulate second utterance: endMs = 1200ms, caption arrives at 1200 + 400ms = 1600ms
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({
                    t: 'caption',
                    text: 'That overtime was unreal',
                    final: true,
                    startMs: 800,
                  }),
                });
              }, 1600);
            }
          }
        }

        close() {
          this.onclose?.();
        }
      }

      // 300 ms of synthetic PCM = 3 frames
      const pcmBuffer = createSyntheticPcm(300);

      // Speech pauses at 200ms and 1200ms
      const speechEnds = [200, 1200];

      const result = await streamAudioToLive(
        pcmBuffer,
        'ws://fake-gateway/live',
        'mock-token',
        speechEnds,
        MockSocket,
      );

      expect(result.hypText).toBe('Did you catch the game That overtime was unreal');
      expect(result.captions.length).toBe(2);
      expect(result.misalignedCount).toBe(0);

      // Speech end 0 is at 200ms. Caption arrived at ~700ms after stream start.
      // Latency after pause = 700 - 200 = ~500ms (well under the 2500ms gate).
      expect(result.firstFinalLatencyMs).not.toBeNull();
      expect(result.firstFinalLatencyMs!).toBeGreaterThanOrEqual(400);
      expect(result.firstFinalLatencyMs!).toBeLessThanOrEqual(700);

      // Median latency should also be measured around 400-550ms
      expect(result.medianFinalLatencyMs).not.toBeNull();
      expect(result.medianFinalLatencyMs!).toBeGreaterThanOrEqual(350);
      expect(result.medianFinalLatencyMs!).toBeLessThanOrEqual(650);
    });

    test('flags early/misaligned captions arriving before speech pause as misaligned', async () => {
      class EarlyMockSocket implements FakeWebSocket {
        onopen?: () => void;
        onmessage?: (event: { data: unknown }) => void;
        onerror?: (err: unknown) => void;
        onclose?: () => void;

        constructor(_url: string) {
          setTimeout(() => {
            this.onopen?.();
          }, 10);
        }

        send(data: string | Buffer | Uint8Array) {
          if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            if (parsed.t === 'hello') {
              this.onmessage?.({
                data: JSON.stringify({ t: 'ready', conversationId: 'conv-mock' }),
              });

              // Speech end is at 800ms, but caption arrives very early at 150ms:
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({
                    t: 'caption',
                    text: 'Early caption',
                    final: true,
                    startMs: 0,
                  }),
                });
              }, 150);
            }
          }
        }

        close() {
          this.onclose?.();
        }
      }

      const pcmBuffer = createSyntheticPcm(200);
      const speechEnds = [800]; // speech end is at 800ms

      const result = await streamAudioToLive(
        pcmBuffer,
        'ws://fake-gateway/live',
        'mock-token',
        speechEnds,
        EarlyMockSocket,
      );

      // Caption arrived at 150ms before pause at 800ms (latency ~ -650ms)
      expect(result.misalignedCount).toBe(1);
      // Negative latencies are excluded from valid first-final latency
      expect(result.firstFinalLatencyMs).toBeNull();
      expect(result.medianFinalLatencyMs).toBeNull();
    });
  });
});
