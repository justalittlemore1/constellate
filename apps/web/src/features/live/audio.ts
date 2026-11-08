/**
 * Audio capture: one MediaStream (microphone) or one decoded WAV, run through the
 * `pcm-processor` AudioWorklet (16 kHz Int16, 1,600-sample frames) and, in parallel, recorded
 * with MediaRecorder (Opus/WebM, 1 s timeslice) for upload on stop.
 *
 * WAV replay plays the file in real time through the very same worklet, so it exercises
 * speech-to-text end to end without anyone speaking.
 */
import { AUDIO_FRAME_BYTES } from '@constellate/shared';

export type CaptureSource = { kind: 'mic' } | { kind: 'wav'; data: ArrayBuffer };

export interface Capture {
  /** stop everything and resolve with the recording (null if MediaRecorder is unavailable) */
  stop(): Promise<Blob | null>;
  /** set by the caller; fired when a WAV finishes playing */
  onEnded?: () => void;
}

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
};

export const RECORDER_TIMESLICE_MS = 1000;

/** Browser APIs, injectable for tests. */
export interface AudioEnv {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
  createWorkletNode(ctx: AudioContext): AudioWorkletNode;
  MediaRecorder: typeof MediaRecorder | undefined;
  workletUrl: string;
}

export function browserAudioEnv(): AudioEnv {
  return {
    getUserMedia: (c) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new Error('This browser cannot record audio (a secure https page is required).'));
      }
      return navigator.mediaDevices.getUserMedia(c);
    },
    createContext: () => new AudioContext(),
    createWorkletNode: (ctx) =>
      new AudioWorkletNode(ctx, 'pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      }),
    MediaRecorder: typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
    workletUrl: new URL('./worklet/pcm-processor.js', import.meta.url).href,
  };
}

export function pickRecorderMime(MR: typeof MediaRecorder): string | undefined {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MR.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

/** Record a stream in 1 s slices; `stop()` resolves with the whole recording. */
export function startRecorder(stream: MediaStream, MR: typeof MediaRecorder | undefined): () => Promise<Blob | null> {
  if (!MR) return async () => null;
  let rec: MediaRecorder;
  try {
    const mimeType = pickRecorderMime(MR);
    rec = new MR(stream, mimeType ? { mimeType } : undefined);
  } catch {
    return async () => null;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start(RECORDER_TIMESLICE_MS);
  return () =>
    new Promise<Blob | null>((resolve) => {
      if (rec.state === 'inactive') return resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null);
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
}

/**
 * Start capturing. Rejects with the browser's error (NotAllowedError when the mic is denied).
 * `onFrame` receives ArrayBuffers of exactly AUDIO_FRAME_BYTES.
 */
export async function startCapture(
  source: CaptureSource,
  onFrame: (frame: ArrayBuffer) => void,
  env: AudioEnv = browserAudioEnv(),
): Promise<Capture> {
  const stream = source.kind === 'mic' ? await env.getUserMedia(MIC_CONSTRAINTS) : null;
  const ctx = env.createContext();
  try {
    await ctx.audioWorklet.addModule(env.workletUrl);
    if (ctx.state === 'suspended') await ctx.resume();
    const node = env.createWorkletNode(ctx);
    node.port.onmessage = (e: MessageEvent) => {
      const buf = e.data;
      if (buf instanceof ArrayBuffer && buf.byteLength === AUDIO_FRAME_BYTES) onFrame(buf);
    };
    // pull the worklet without making a sound
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);

    let stopRecorder: () => Promise<Blob | null>;
    let player: AudioBufferSourceNode | null = null;
    const capture: Capture = { stop: async () => null };

    if (stream) {
      const input = ctx.createMediaStreamSource(stream);
      input.connect(node);
      stopRecorder = startRecorder(stream, env.MediaRecorder);
    } else {
      const data = (source as Extract<CaptureSource, { kind: 'wav' }>).data;
      const buffer = await ctx.decodeAudioData(data.slice(0));
      player = ctx.createBufferSource();
      player.buffer = buffer;
      player.connect(node);
      player.connect(ctx.destination); // the room hears the replay
      const tap = ctx.createMediaStreamDestination();
      player.connect(tap);
      stopRecorder = startRecorder(tap.stream, env.MediaRecorder);
      player.onended = () => capture.onEnded?.();
      player.start();
    }

    let stopped: Promise<Blob | null> | null = null;
    capture.stop = () => {
      if (!stopped) {
        stopped = (async () => {
          if (player) {
            player.onended = null;
            try {
              player.stop();
            } catch {
              /* already ended */
            }
          }
          const blob = await stopRecorder();
          node.port.onmessage = null;
          node.disconnect();
          stream?.getTracks().forEach((t) => t.stop());
          await ctx.close().catch(() => undefined);
          return blob;
        })();
      }
      return stopped;
    };
    return capture;
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => undefined);
    throw err;
  }
}
