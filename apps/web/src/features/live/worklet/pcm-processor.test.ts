import { AUDIO_FRAME_BYTES, AUDIO_SAMPLE_RATE } from '@constellate/shared';
import { describe, expect, it } from 'vitest';
import {
  FRAME_SAMPLES,
  FrameAssembler,
  PcmPipeline,
  Resampler,
  TARGET_RATE,
  floatToInt16,
  toMono,
} from './pcm-processor.js';

const QUANTUM = 128; // AudioWorklet render quantum

function sine(rate: number, seconds: number, hz = 440, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

/** feed a signal through the pipeline in render quanta, as the browser does */
function runPipeline(signal: Float32Array, rate: number): Int16Array[] {
  const p = new PcmPipeline(rate);
  const frames: Int16Array[] = [];
  for (let i = 0; i < signal.length; i += QUANTUM) frames.push(...p.process([signal.subarray(i, i + QUANTUM)]));
  return frames;
}

/** dominant frequency estimate from zero crossings */
function zeroCrossingHz(samples: ArrayLike<number>, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1]! < 0 !== samples[i]! < 0) crossings++;
  return (crossings / 2) * (rate / samples.length);
}

describe('wire format constants', () => {
  it('match the shared contract: 1,600 samples × 2 bytes = AUDIO_FRAME_BYTES at 16 kHz', () => {
    expect(TARGET_RATE).toBe(AUDIO_SAMPLE_RATE);
    expect(FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT).toBe(AUDIO_FRAME_BYTES);
  });
});

describe('Resampler', () => {
  it.each([48_000, 44_100, 16_000, 8_000])('produces 16,000 samples per second of %i Hz input', (rate) => {
    const r = new Resampler(rate);
    const input = sine(rate, 1);
    let total = 0;
    for (let i = 0; i < input.length; i += QUANTUM) total += r.push(input.subarray(i, i + QUANTUM)).length;
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
  });

  it('keeps the pitch of a 440 Hz sine when downsampling from 48 kHz', () => {
    const out = new Resampler(48_000).push(sine(48_000, 1));
    expect(zeroCrossingHz(out, 16_000)).toBeCloseTo(440, -1);
  });

  it('averages exact 3:1 groups at 48 kHz', () => {
    const out = new Resampler(48_000).push(Float32Array.from([0, 0.3, 0.6, 0.9, 0.9, 0.9]));
    expect(Array.from(out)).toEqual([expect.closeTo(0.3, 5), expect.closeTo(0.9, 5)]);
  });

  it('rejects nonsense sample rates', () => {
    expect(() => new Resampler(0)).toThrow();
  });
});

describe('floatToInt16', () => {
  it('maps full scale to the Int16 limits and clips beyond it', () => {
    const out = floatToInt16(Float32Array.from([0, 1, -1, 0.5, -0.5, 1.7, -3]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 16384, -16384, 32767, -32768]);
  });
});

describe('FrameAssembler', () => {
  it('emits only complete 1,600-sample frames and carries the remainder', () => {
    const a = new FrameAssembler();
    expect(a.push(new Int16Array(1000))).toHaveLength(0);
    const frames = a.push(Int16Array.from({ length: 2500 }, (_, i) => i));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.length).toBe(1600);
    expect(frames[0]![1000]).toBe(0); // first sample of the second push lands after the carried 1,000
    expect(frames[1]![0]).toBe(600);
    expect(frames[0]!.buffer).not.toBe(frames[1]!.buffer); // each frame owns its buffer (transferable)
  });
});

describe('toMono', () => {
  it('averages channels', () => {
    expect(Array.from(toMono([Float32Array.from([1, 0]), Float32Array.from([0, 0])]))).toEqual([0.5, 0]);
  });
});

describe('PcmPipeline', () => {
  it('turns 1 s of 48 kHz sine into ten 3,200-byte frames with the right pitch and level', () => {
    const frames = runPipeline(sine(48_000, 1), 48_000);
    expect(frames).toHaveLength(10);
    for (const f of frames) expect(f.byteLength).toBe(AUDIO_FRAME_BYTES);
    const all = new Int16Array(frames.length * FRAME_SAMPLES);
    frames.forEach((f, i) => all.set(f, i * FRAME_SAMPLES));
    expect(zeroCrossingHz(all, 16_000)).toBeCloseTo(440, -1);
    const peak = all.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(0.45 * 32767);
    expect(peak).toBeLessThanOrEqual(0.5 * 32767 + 1);
  });

  it('clips a too-loud signal instead of wrapping around', () => {
    const frames = runPipeline(sine(16_000, 0.1, 100, 2), 16_000);
    expect(frames).toHaveLength(1);
    const f = frames[0]!;
    expect(Math.max(...f)).toBe(32767);
    expect(Math.min(...f)).toBe(-32768);
  });

  it('ignores empty input (no microphone connected yet)', () => {
    expect(new PcmPipeline(48_000).process([])).toEqual([]);
    expect(new PcmPipeline(48_000).process(undefined)).toEqual([]);
  });
});
