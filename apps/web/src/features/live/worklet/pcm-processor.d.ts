/** Types for the self-contained worklet module (pcm-processor.js), so tests and the app can import it. */
export const TARGET_RATE: number;
export const FRAME_SAMPLES: number;

export class Resampler {
  constructor(inRate: number, outRate?: number);
  readonly ratio: number;
  push(input: Float32Array): Float32Array;
}

export function floatToInt16(input: Float32Array): Int16Array;

export class FrameAssembler {
  constructor(size?: number);
  push(samples: Int16Array): Int16Array[];
}

export function toMono(channels: Float32Array[]): Float32Array;

export class PcmPipeline {
  constructor(inRate: number);
  process(channels: Float32Array[] | undefined): Int16Array[];
}
