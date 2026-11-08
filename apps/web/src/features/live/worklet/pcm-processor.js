/**
 * AudioWorklet: microphone (or decoded WAV) → 16 kHz mono PCM s16le, posted as 1,600-sample
 * (100 ms) frames. Loaded with `audioWorklet.addModule(new URL('./worklet/pcm-processor.js', import.meta.url))`.
 *
 * Self-contained on purpose: a worklet module is served as a static asset, so it cannot import
 * from the app bundle. The pure pieces are exported so they are unit-tested directly.
 */

export const TARGET_RATE = 16000;
export const FRAME_SAMPLES = 1600;

/**
 * Stateful resampler to TARGET_RATE. Downsampling averages every input sample that falls in an
 * output period (a box filter: cheap, and enough anti-aliasing for speech); upsampling holds.
 * State carries across calls, so 128-sample render quanta produce a continuous stream.
 */
export class Resampler {
  /** @param {number} inRate @param {number} [outRate] */
  constructor(inRate, outRate = TARGET_RATE) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error(`bad sample rates ${inRate} → ${outRate}`);
    this.ratio = inRate / outRate;
    this.sum = 0;
    this.count = 0;
    /** input position (in input samples) at which the next output sample is due */
    this.next = this.ratio;
    this.pos = 0;
  }

  /** @param {Float32Array} input @returns {Float32Array} */
  push(input) {
    if (this.ratio === 1) return input.slice();
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 2);
    let n = 0;
    if (this.ratio > 1) {
      for (let i = 0; i < input.length; i++) {
        this.sum += input[i];
        this.count++;
        this.pos++;
        if (this.pos >= this.next) {
          out[n++] = this.sum / this.count;
          this.sum = 0;
          this.count = 0;
          this.next += this.ratio;
        }
      }
    } else {
      for (let i = 0; i < input.length; i++) {
        this.pos++;
        while (this.next <= this.pos) {
          out[n++] = input[i];
          this.next += this.ratio;
        }
      }
    }
    // keep the counters small so float precision never drifts on long recordings
    if (this.pos > 1e6) {
      this.next -= this.pos;
      this.pos = 0;
    }
    return out.subarray(0, n);
  }
}

/** Float [-1, 1] → Int16, clipping out-of-range samples. @param {Float32Array} input */
export function floatToInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Collects Int16 samples into fixed-size frames. */
export class FrameAssembler {
  /** @param {number} [size] */
  constructor(size = FRAME_SAMPLES) {
    this.size = size;
    this.buf = new Int16Array(size);
    this.fill = 0;
  }

  /** @param {Int16Array} samples @returns {Int16Array[]} complete frames (each a fresh buffer) */
  push(samples) {
    const frames = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(this.size - this.fill, samples.length - i);
      this.buf.set(samples.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === this.size) {
        frames.push(this.buf);
        this.buf = new Int16Array(this.size);
        this.fill = 0;
      }
    }
    return frames;
  }
}

/** Mix any number of channels down to mono. @param {Float32Array[]} channels */
export function toMono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** The whole pipeline for one render quantum. */
export class PcmPipeline {
  /** @param {number} inRate */
  constructor(inRate) {
    this.resampler = new Resampler(inRate);
    this.assembler = new FrameAssembler();
  }

  /** @param {Float32Array[]} channels @returns {Int16Array[]} */
  process(channels) {
    if (!channels || channels.length === 0 || channels[0].length === 0) return [];
    return this.assembler.push(floatToInt16(this.resampler.push(toMono(channels))));
  }
}

if (typeof registerProcessor === 'function') {
  class PcmProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.pipeline = new PcmPipeline(sampleRate);
    }

    process(inputs) {
      for (const frame of this.pipeline.process(inputs[0])) this.port.postMessage(frame.buffer, [frame.buffer]);
      return true;
    }
  }
  registerProcessor('pcm-processor', PcmProcessor);
}
