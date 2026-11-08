import { AUDIO_FRAME_BYTES } from '@constellate/shared';
import { describe, expect, it, vi } from 'vitest';
import { MIC_CONSTRAINTS, RECORDER_TIMESLICE_MS, startCapture, type AudioEnv } from './audio';

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  static last: FakeRecorder;
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startedWith?: number;
  constructor(
    readonly stream: unknown,
    readonly opts?: { mimeType?: string },
  ) {
    FakeRecorder.last = this;
  }
  get mimeType() {
    return this.opts?.mimeType ?? '';
  }
  start(slice: number) {
    this.state = 'recording';
    this.startedWith = slice;
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['last'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function fakeEnv() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const worklet = { ...node(), port: { onmessage: null as ((e: { data: unknown }) => void) | null } };
  const player = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  const ctx = {
    state: 'suspended',
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createMediaStreamSource: vi.fn(() => node()),
    createBufferSource: () => player,
    createMediaStreamDestination: () => ({ ...node(), stream: { id: 'tap' } }),
    decodeAudioData: vi.fn(async () => ({ duration: 1 })),
  };
  const env: AudioEnv = {
    getUserMedia: vi.fn(async () => stream),
    createContext: () => ctx as unknown as AudioContext,
    createWorkletNode: () => worklet as unknown as AudioWorkletNode,
    MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder,
    workletUrl: '/pcm-processor.js',
  };
  return { env, ctx, worklet, track, player };
}

describe('startCapture (microphone)', () => {
  it('asks for echo-cancelled, noise-suppressed mono audio and loads the worklet', async () => {
    const { env, ctx } = fakeEnv();
    await startCapture({ kind: 'mic' }, vi.fn(), env);
    expect(env.getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(MIC_CONSTRAINTS.audio).toEqual({ echoCancellation: true, noiseSuppression: true, channelCount: 1 });
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('/pcm-processor.js');
    expect(ctx.resume).toHaveBeenCalled();
    expect(FakeRecorder.last.opts).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(FakeRecorder.last.startedWith).toBe(RECORDER_TIMESLICE_MS);
  });

  it('forwards only whole 3,200-byte frames from the worklet', async () => {
    const { env, worklet } = fakeEnv();
    const onFrame = vi.fn();
    await startCapture({ kind: 'mic' }, onFrame, env);
    worklet.port.onmessage?.({ data: new ArrayBuffer(AUDIO_FRAME_BYTES) });
    worklet.port.onmessage?.({ data: new ArrayBuffer(100) });
    worklet.port.onmessage?.({ data: 'junk' });
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('stop releases the microphone, closes the context and returns the recording', async () => {
    const { env, ctx, track } = fakeEnv();
    const cap = await startCapture({ kind: 'mic' }, vi.fn(), env);
    const blob = await cap.stop();
    expect(blob?.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(await cap.stop()).toBe(blob); // idempotent
  });

  it('propagates a denied microphone and opens no audio context', async () => {
    const { env } = fakeEnv();
    const createContext = vi.spyOn(env, 'createContext');
    env.getUserMedia = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    await expect(startCapture({ kind: 'mic' }, vi.fn(), env)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(createContext).not.toHaveBeenCalled();
  });
});

describe('startCapture (WAV replay)', () => {
  it('decodes the file, plays it through the same worklet and reports the end', async () => {
    const { env, ctx, player } = fakeEnv();
    const cap = await startCapture({ kind: 'wav', data: new ArrayBuffer(44) }, vi.fn(), env);
    expect(env.getUserMedia).not.toHaveBeenCalled();
    expect(ctx.decodeAudioData).toHaveBeenCalled();
    expect(player.start).toHaveBeenCalled();
    expect(FakeRecorder.last.stream).toEqual({ id: 'tap' }); // recorded for playback later
    const ended = vi.fn();
    cap.onEnded = ended;
    player.onended?.();
    expect(ended).toHaveBeenCalled();
  });
});
