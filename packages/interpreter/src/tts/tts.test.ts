import { describe, expect, it } from 'vitest';
import type { TranscriptFixture } from '@constellate/shared';
import { addNoise, concat, decodePcm16, encodePcm16, rateFromMime, resample, rms, TARGET_RATE, wav } from './audio';
import { gapsFor, renderFixture, toWav, VOICES, type Synthesize } from './render';

const tone = (n: number, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 5));

describe('audio helpers', () => {
  it('round-trips 16-bit PCM within quantisation error', () => {
    const s = tone(100);
    const back = decodePcm16(encodePcm16(s));
    expect(back.length).toBe(100);
    back.forEach((x, i) => expect(Math.abs(x - s[i]!)).toBeLessThan(1 / 16_000));
  });

  it('resamples 24 kHz to 16 kHz with the right length', () => {
    expect(resample(tone(24_000), 24_000, 16_000).length).toBe(16_000);
    const same = tone(10);
    expect(resample(same, 16_000, 16_000)).toBe(same);
  });

  it('concatenates clips with leading gaps and reports their spans', () => {
    const { samples, spans } = concat([
      { samples: tone(1_600), gapMs: 500 },
      { samples: tone(3_200), gapMs: 300 },
    ]);
    expect(spans).toEqual([
      [500, 600],
      [900, 1100],
    ]);
    expect(samples.length).toBe(8_000 + 1_600 + 4_800 + 3_200);
  });

  it('mixes noise about 20 dB below the speech, deterministically', () => {
    const s = tone(16_000, 0.3);
    const a = addNoise(s, -20, 7);
    const b = addNoise(s, -20, 7);
    expect(a).toEqual(b);
    const noise = Float32Array.from(a, (x, i) => x - s[i]!);
    const db = 20 * Math.log10(rms(noise) / rms(s));
    expect(db).toBeGreaterThan(-21);
    expect(db).toBeLessThan(-19);
  });

  it('writes a 16 kHz mono 16-bit WAV header', () => {
    const w = wav(tone(10));
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(TARGET_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(20);
    expect(w.length).toBe(64);
  });

  it('reads the rate from a Gemini audio mime type', () => {
    expect(rateFromMime('audio/L16;codec=pcm;rate=24000')).toBe(24_000);
    expect(rateFromMime(undefined, 22_050)).toBe(22_050);
  });
});

describe('renderFixture', () => {
  const fixture: TranscriptFixture = {
    id: 'x-test',
    title: 't',
    description: 'd',
    speakers: ['A', 'B'],
    utterances: [
      { speaker: 0, startMs: 0, endMs: 1_000, text: 'hello there' },
      { speaker: 1, startMs: 1_200, endMs: 2_000, text: 'hi' },
      { speaker: 0, startMs: 2_500, endMs: 3_000, text: 'bye' },
    ],
  };

  it('uses one voice per speaker, seeded 0.3–1.2 s gaps, and times each clip', async () => {
    const calls: [string, string][] = [];
    const synth: Synthesize = async (text, voice) => {
      calls.push([text, voice]);
      return { pcm: encodePcm16(tone(24_000)), rate: 24_000 }; // 1 s at 24 kHz
    };
    const r = await renderFixture(fixture, synth);
    expect(calls.map((c) => c[1])).toEqual([VOICES[0], VOICES[1], VOICES[0]]);
    const gaps = gapsFor(fixture, 123);
    expect(gaps[0]).toBe(500);
    gaps.slice(1).forEach((g) => expect(g >= 300 && g <= 1_200).toBe(true));
    const u = r.sidecar.utterances;
    expect(u[0]).toMatchObject({ id: 'u1', startMs: 500, endMs: 1_500, text: 'hello there' });
    expect(u[1]!.startMs - u[0]!.endMs).toBeGreaterThanOrEqual(300);
    expect(u[2]!.endMs - u[2]!.startMs).toBe(1_000);
    expect(r.samples.length).toBe(Math.round((u[2]!.endMs / 1000) * TARGET_RATE) + TARGET_RATE);
    expect(toWav(r).length).toBe(44 + r.samples.length * 2);
    expect(toWav(r, -20)).not.toEqual(toWav(r));
  });
});
