import { describe, expect, test } from 'vitest';
import {
  calculateWer,
  createSyntheticPcm,
  extractWavPcm,
  formatReport,
  normalizeText,
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

  describe('formatReport', () => {
    test('formats markdown report with target comparisons and badges', () => {
      const sampleResults: SttScenarioResult[] = [
        {
          id: '01-simple-shift',
          title: 'Hockey to music',
          isNoisy: false,
          refText: 'Did you catch the game',
          hypText: 'Did you catch the game',
          wer: 0,
          werTarget: 0.15,
          werPassed: true,
          timeToFirstFinalMs: 1400,
          latencyTargetMs: 2500,
          latencyPassed: true,
          overallPassed: true,
        },
      ];

      const report = formatReport(sampleResults);
      expect(report).toContain('# Speech-to-Text Performance Report');
      expect(report).toContain('Hockey to music');
      expect(report).toContain('0.0 %');
      expect(report).toContain('1.40 s');
      expect(report).toContain('**PASS**');
    });
  });
});
