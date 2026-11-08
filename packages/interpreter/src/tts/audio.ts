/**
 * Small, dependency-free audio helpers for synthetic test audio (no ffmpeg needed on Windows):
 * 16-bit PCM decode/encode, linear resampling, concatenation with gaps, and noise mixing.
 * Samples are Float32 in [-1, 1].
 */

export const TARGET_RATE = 16_000;

/** Deterministic PRNG (mulberry32) so a script always renders to the same file. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function decodePcm16(buf: Uint8Array): Float32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(Math.floor(buf.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function encodePcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return out;
}

/** Linear-interpolation resampler; adequate for speech going down to 16 kHz. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const n = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    const a = samples[Math.min(j, samples.length - 1)] ?? 0;
    const b = samples[Math.min(j + 1, samples.length - 1)] ?? 0;
    out[i] = a + (b - a) * f;
  }
  return out;
}

export interface Clip {
  samples: Float32Array;
  /** silence before this clip, ms */
  gapMs: number;
}

/** Join clips with their leading gaps; returns the audio and each clip's [startMs, endMs]. */
export function concat(
  clips: readonly Clip[],
  rate = TARGET_RATE,
): { samples: Float32Array; spans: [number, number][] } {
  const total = clips.reduce((n, c) => n + Math.round((c.gapMs * rate) / 1000) + c.samples.length, 0);
  const out = new Float32Array(total);
  const spans: [number, number][] = [];
  let pos = 0;
  for (const c of clips) {
    pos += Math.round((c.gapMs * rate) / 1000);
    out.set(c.samples, pos);
    spans.push([Math.round((pos / rate) * 1000), Math.round(((pos + c.samples.length) / rate) * 1000)]);
    pos += c.samples.length;
  }
  return { samples: out, spans };
}

export function rms(samples: Float32Array): number {
  let s = 0;
  for (const x of samples) s += x * x;
  return samples.length ? Math.sqrt(s / samples.length) : 0;
}

/**
 * Mix in pink-ish background noise `db` below the speech RMS (e.g. -20). Deterministic per seed.
 * A stand-in for "cafe noise": broadband and steady, harder for STT than silence.
 */
export function addNoise(samples: Float32Array, db: number, seed = 1): Float32Array {
  const r = rng(seed);
  const target = rms(samples) * 10 ** (db / 20);
  // Paul Kellet's economy pink filter over white noise
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const noise = new Float32Array(samples.length);
  for (let i = 0; i < noise.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    noise[i] = b0 + b1 + b2 + w * 0.1848;
  }
  const scale = target / (rms(noise) || 1);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i]! + noise[i]! * scale));
  return out;
}

/** 16-bit mono PCM WAV file bytes. */
export function wav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const data = encodePcm16(samples);
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

/** Sample rate from a Gemini audio mime type such as `audio/L16;codec=pcm;rate=24000`. */
export function rateFromMime(mime: string | undefined, fallback = 24_000): number {
  const m = mime?.match(/rate=(\d+)/);
  return m ? Number(m[1]) : fallback;
}
