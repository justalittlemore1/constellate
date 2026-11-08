import type { Utterance } from '@constellate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installFlowDomStubs } from '../features/map/testing';
import { createMockApi } from '../lib/api';
import {
  DEFAULT_CLIP_MS,
  lineAt,
  playTranscript,
  stopPlayback,
  togglePause,
  transcriptClip,
  usePlayback,
  usePlaybackState,
  usePlayMoment,
} from '../lib/audio';
import { loadDemoGraph } from '../lib/fixtures';
import { usePrefs } from '../lib/prefs';
import { renderApp } from '../test/render';
import { ApiProvider } from '../lib/api';
import { AuthProvider } from '../lib/auth';
import { NowPlayingBar, TRANSCRIPT_LABEL } from './NowPlayingBar';
import { PROMISE_LINE } from '../features/library/DiarySheet';
import { BrainScreen } from '../features/brain/BrainScreen';

// the Brain canvas needs a real browser; the Text view carries the content
vi.mock('react-force-graph-2d', () => ({ default: () => <div data-testid="force-graph" /> }));

beforeAll(() => installFlowDomStubs());
afterEach(() => {
  act(() => stopPlayback());
  vi.useRealTimers();
  vi.restoreAllMocks();
  usePrefs.getState().reset();
});

const demo = loadDemoGraph();
const cid = demo.conversation.id;
const u = (id: string, startMs: number, endMs: number, text: string): Utterance => ({
  id,
  conversationId: cid,
  speaker: null,
  startMs,
  endMs,
  text,
});
const LINES = [
  u('u1', 0, 9_000, 'Before the moment.'),
  u('u2', 10_000, 14_000, 'First line of the moment.'),
  u('u3', 15_000, 19_000, 'Second line of the moment.'),
  u('u4', 30_000, 35_000, 'After the moment.'),
];

const fakeClock = () =>
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });

describe('transcript clip maths', () => {
  it('covers startMs − 1 s … endMs + 1 s and keeps the overlapping utterances in order', () => {
    const clip = transcriptClip(11_000, 18_000, [...LINES].reverse());
    expect(clip.fromMs).toBe(10_000);
    expect(clip.toMs).toBe(19_000);
    expect(clip.lines.map((l) => l.id)).toEqual(['u2', 'u3']);
    expect(transcriptClip(5_000, null, LINES).toMs).toBe(5_000 + DEFAULT_CLIP_MS + 1_000);
    expect(lineAt(clip, 10_500)?.id).toBe('u2');
    expect(lineAt(transcriptClip(12_000, 18_000, LINES.slice(2)), 11_000)?.id).toBe('u3'); // lead-in
    expect(lineAt(clip, 16_000)?.id).toBe('u3');
  });
});

describe('transcript playback (no recording)', () => {
  it('runs for the clip’s real duration, showing its utterances one after another, then stops', () => {
    fakeClock();
    render(<NowPlayingBar />);
    const state = renderHook(() => usePlaybackState());
    act(() => playTranscript({ key: 'node-1', startMs: 11_000, endMs: 18_000, utterances: LINES }));

    const bar = screen.getByRole('region', { name: 'Now playing' });
    expect(bar).toHaveTextContent(TRANSCRIPT_LABEL);
    expect(state.result.current).toMatchObject({ current: 'node-1', mode: 'transcript', atMs: 10_000 });
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('First line of the moment.');
    expect(screen.getByTestId('now-playing-line')).toHaveAttribute('aria-live', 'polite');
    expect(bar).toHaveTextContent(/00:10\D+00:19/);

    act(() => vi.advanceTimersByTime(5_500)); // 15.5 s on the conversation clock
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('Second line of the moment.');
    expect(bar).toHaveTextContent(/00:15\D+00:19/);

    act(() => vi.advanceTimersByTime(4_000)); // past endMs + 1 s
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();
    expect(state.result.current).toMatchObject({ current: null, mode: null });
  });

  it('pause holds the clock; resume carries on', () => {
    fakeClock();
    render(<NowPlayingBar />);
    act(() => playTranscript({ key: 'k', startMs: 11_000, endMs: 18_000, utterances: LINES }));
    act(() => vi.advanceTimersByTime(2_000));
    act(() => togglePause());
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('region', { name: 'Now playing' })).toHaveTextContent(/00:12\D+00:19/);
    act(() => togglePause());
    act(() => vi.advanceTimersByTime(3_500));
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('Second line of the moment.');
  });

  it('Stop and Escape close it', async () => {
    const user = userEvent.setup();
    render(<NowPlayingBar />);
    act(() => playTranscript({ key: 'k', startMs: 11_000, endMs: 18_000, utterances: LINES }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();

    act(() => playTranscript({ key: 'k', startMs: 11_000, endMs: 18_000, utterances: LINES }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();
  });

  it('Escape closes an open dialog first, not the bar (unless focus is in the bar)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Sheet">
          <button type="button">In sheet</button>
        </div>
        <NowPlayingBar />
      </>,
    );
    act(() => playTranscript({ key: 'k', startMs: 11_000, endMs: 18_000, utterances: LINES }));
    screen.getByRole('button', { name: 'In sheet' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'Now playing' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Pause' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();
  });

  it('says so when there is no transcript for the moment', () => {
    render(<NowPlayingBar />);
    act(() => playTranscript({ key: 'k', startMs: 50_000, endMs: 52_000, utterances: LINES }));
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('No transcript for this moment.');
  });

  it('under reduced motion: no animation, the caption and time still show', () => {
    usePrefs.getState().set({ reduceMotion: true });
    render(<NowPlayingBar />);
    act(() => playTranscript({ key: 'k', startMs: 11_000, endMs: 18_000, utterances: LINES }));
    expect(screen.getByTestId('now-playing-progress').style.transition).toBe('none');
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('First line of the moment.');
    expect(screen.getByRole('region', { name: 'Now playing' })).toHaveTextContent(/00:10\D+00:19/);
  });

  it('usePlayback reports the playing key either way (for the “playing” glow)', () => {
    const { result } = renderHook(() => usePlayback());
    act(() => playTranscript({ key: 'node-7', startMs: 11_000, endMs: 18_000, utterances: LINES }));
    expect(result.current.current).toBe('node-7');
    expect(result.current.isPlaying('node-7')).toBe(true);
    expect(result.current.mode).toBe('transcript');
  });
});

function withApi(api: ReturnType<typeof createMockApi>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider mock client={null}>
        <ApiProvider api={api}>{children}</ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('usePlayMoment', () => {
  it('with a recording: plays the audio exactly as before (no transcript bar)', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const api = createMockApi();
    api.audioUrl = async () => 'https://storage.test/rec.webm?sig=1';
    const listUtterances = vi.spyOn(api, 'listUtterances');
    render(<NowPlayingBar />);
    const { result } = renderHook(() => ({ play: usePlayMoment(), state: usePlaybackState() }), {
      wrapper: withApi(api),
    });
    await act(() =>
      result.current.play({ key: 'n1', conversationId: cid, startMs: 11_000, endMs: 18_000, audioPath: 'x.webm' }),
    );
    expect(play).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({ current: 'n1', mode: 'audio' });
    expect(listUtterances).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();
  });

  it('without a recording: fetches the utterances when none are passed, then plays the transcript', async () => {
    const api = createMockApi();
    const listUtterances = vi.spyOn(api, 'listUtterances').mockResolvedValue(LINES);
    render(<NowPlayingBar />);
    const { result } = renderHook(() => usePlayMoment(), { wrapper: withApi(api) });
    await act(() =>
      result.current({ key: 'n2', conversationId: cid, startMs: 11_000, endMs: 18_000, audioPath: null }),
    );
    expect(listUtterances).toHaveBeenCalledWith(cid);
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('First line of the moment.');
  });

  it('uses the utterances it is given without fetching', async () => {
    const api = createMockApi();
    const listUtterances = vi.spyOn(api, 'listUtterances');
    render(<NowPlayingBar />);
    const { result } = renderHook(() => usePlayMoment(), { wrapper: withApi(api) });
    await act(() =>
      result.current({
        key: 'n3',
        conversationId: cid,
        startMs: 11_000,
        endMs: 18_000,
        audioPath: null,
        utterances: LINES,
      }),
    );
    expect(listUtterances).not.toHaveBeenCalled();
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('First line of the moment.');
  });
});

describe('Highlights and Brain Play buttons use the same player', () => {
  it('Brain occurrence Play shows the transcript bar when there is no recording', async () => {
    const api = createMockApi();
    await api.rebuildBrain();
    vi.spyOn(api, 'listUtterances').mockResolvedValue(LINES);
    const user = userEvent.setup();
    renderApp({
      route: '/brain',
      api,
      element: (
        <>
          <NowPlayingBar />
          <BrainScreen />
        </>
      ),
    });
    await user.click(await screen.findByRole('button', { name: 'Text view' }));
    const list = screen.getByRole('region', { name: 'All concepts' });
    await user.click(within(list).getAllByRole('button')[0]!);
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getAllByRole('button', { name: /^Play / })[0]!);
    expect(await screen.findByRole('region', { name: 'Now playing' })).toHaveTextContent(TRANSCRIPT_LABEL);
  });
});

describe('the Diary promise row', () => {
  async function promise() {
    renderApp({ route: `/c/${cid}?diary=1` });
    const diary = await screen.findByRole('dialog', { name: 'Diary' });
    return within(diary).getByRole('region', { name: 'Promises' });
  }

  it('is one paragraph in the body text colour (the cue blank keeps its accent underline)', async () => {
    const section = await promise();
    const text = within(section).getByTestId('promise-text');
    expect(text).toHaveClass('text-ink');
    expect(text).toHaveTextContent(/^When When should you do this\?, I will send Sam the reading list/);
    expect(text.querySelectorAll('.text-ink-2')).toHaveLength(0); // no grey first line
  });

  it('has even line spacing: one line-height, and a cue input no taller than a line, adding no padding', async () => {
    const section = await promise();
    const text = within(section).getByTestId('promise-text');
    expect(text.style.lineHeight).toBe(PROMISE_LINE);
    const cue = within(section).getByRole('textbox', { name: 'When should you do this?' });
    expect(cue).toHaveClass('h-[1.25em]', 'leading-[1.25em]', 'py-0'); // 1.25em < the 1.6em line
    const target = within(section).getByTestId('promise-cue-target');
    expect(target.className).not.toMatch(/(^|\s)(py|my|pt|pb)-/); // the 44 px target is a ::before
    expect(target.className).toContain('before:h-11');
  });

  it('aligns the checkbox with the first line (its 44 px target is centred on that line)', async () => {
    const section = await promise();
    const target = within(section).getByTestId('promise-done-target');
    expect(target).toHaveClass('size-11');
    expect(target.className).toContain('my-[calc((var(--promise-line)-2.75rem)/2)]');
    expect(target.style.getPropertyValue('--promise-line')).toBe(PROMISE_LINE);
  });
});
