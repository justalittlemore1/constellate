import { emptyGraph } from '@constellate/shared';
import { makeConversation, TEST_CONVERSATION_ID } from '@constellate/shared/testing';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFlowDomStubs } from '../map/testing';
import { liveRouteConfig, LiveRoute, MOCK_DEMO_SPEED, savedConversationPath } from './LiveRoute';
import { STOP_TIMEOUT_MS, type LiveDeps } from './controller';
import { mockDeps } from './deps';
import { LIVE_FEATURES } from './flags';
import { fakeDeps } from './testing';

const cfg = (id: string, query: string, useMocks: boolean, serverDemoSpeed = 1) =>
  liveRouteConfig(id, new URLSearchParams(query), { useMocks, serverDemoSpeed });

describe('liveRouteConfig', () => {
  it('records from the microphone in real time against the real server', () => {
    expect(cfg('new', '', false, 4)).toEqual({ source: { kind: 'mic' }, speed: 1 });
    expect(cfg('new', 'speed=8', false, 4).speed).toBe(1); // a URL cannot speed up a real recording
  });

  it("replays A4's demo link at the server's configured speed", () => {
    expect(cfg('new', 'replay=demo-religion', false, 4)).toEqual({
      source: { kind: 'transcript', fixture: 'demo-religion' },
      speed: 4,
    });
    expect(cfg('demo', 'fixture=demo-career', false).source).toEqual({ kind: 'transcript', fixture: 'demo-career' });
    expect(cfg('new', 'replay=demo-religion', false).speed).toBe(1);
  });

  it('runs the demo 4× in mock mode, a mock "recording" in real time, and honours ?speed there', () => {
    expect(cfg('new', 'replay=demo-religion', true).speed).toBe(MOCK_DEMO_SPEED);
    expect(MOCK_DEMO_SPEED).toBe(4);
    expect(cfg('new', '', true)).toEqual({ source: { kind: 'transcript', fixture: 'demo-religion' }, speed: 1 });
    expect(cfg('new', 'replay=demo-religion&speed=2', true).speed).toBe(2);
  });
});

describe('after Stop', () => {
  beforeAll(() => installFlowDomStubs());
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function Where() {
    const loc = useLocation();
    return <p data-testid="where">{loc.pathname + loc.search}</p>;
  }
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  const noSheet = () => expect(screen.queryByRole('dialog', { name: 'Before you go' })).not.toBeInTheDocument();

  function renderRoute(deps: LiveDeps, entry = '/live/new') {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/live/:id" element={<LiveRoute deps={deps} />} />
          <Route path="/c/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  async function startMic() {
    const f = fakeDeps({ graph: () => emptyGraph(makeConversation()) });
    renderRoute(f.deps);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone agrees — start' }));
    await advance(0);
    act(() => {
      f.net.last.open();
      f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    });
    await advance(0);
    return f;
  }

  it('Stop goes straight to /c/<id>?diary=1 once the server confirms: no Before you go sheet', async () => {
    expect(LIVE_FEATURES.beforeYouGo).toBe(false);
    expect(savedConversationPath(TEST_CONVERSATION_ID)).toBe(`/c/${TEST_CONVERSATION_ID}?diary=1`);
    const f = await startMic();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(f.net.last.sent.at(-1)).toEqual({ t: 'stop' });
    await advance(0);
    // still saving: stays on the live screen (stop → upload → stopped is unchanged), says so, no sheet
    noSheet();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    expect(screen.getByText('Recording stopped. Saving the conversation…')).toHaveAttribute('role', 'status');
    act(() => f.net.last.push({ t: 'stopped', conversationId: TEST_CONVERSATION_ID }));
    await advance(0);
    expect(f.deps.upload).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent(`/c/${TEST_CONVERSATION_ID}?diary=1`);
  });

  it('still leaves for the diary after the stop timeout when the server never confirms', async () => {
    const f = await startMic();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await advance(STOP_TIMEOUT_MS - 100);
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    await advance(200);
    noSheet();
    expect(f.deps.upload).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent(`/c/${TEST_CONVERSATION_ID}?diary=1`);
  });

  it('a demo replay that ends by itself goes straight to its diary too', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps, server } = mockDeps({ speed: 50 });
    renderRoute(deps, '/live/new?replay=demo-religion');
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(5_000); // well into the replay
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    for (let i = 0; i < 40 && !screen.queryByTestId('where'); i++) {
      noSheet();
      await advance(500);
    }
    expect(screen.getByTestId('where')).toHaveTextContent(`/c/${server.conversationId}?diary=1`);
    server.dispose();
  });
});
