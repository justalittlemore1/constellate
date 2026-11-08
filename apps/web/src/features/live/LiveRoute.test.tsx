import { emptyGraph } from '@constellate/shared';
import { makeConversation, TEST_CONVERSATION_ID } from '@constellate/shared/testing';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveRouteConfig, LiveRoute, MOCK_DEMO_SPEED, savedConversationPath } from './LiveRoute';
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens the saved map with the Diary (?diary=1) so the reflection prompt comes while it is fresh', async () => {
    expect(savedConversationPath(TEST_CONVERSATION_ID)).toBe(`/c/${TEST_CONVERSATION_ID}?diary=1`);

    const f = fakeDeps({ graph: () => emptyGraph(makeConversation()) });
    function Where() {
      const loc = useLocation();
      return <p data-testid="where">{loc.pathname + loc.search}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/live/new']}>
        <Routes>
          <Route path="/live/:id" element={<LiveRoute deps={f.deps} />} />
          <Route path="/c/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone agrees — start' }));
    await advance(0);
    act(() => {
      f.net.last.open();
      f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    });
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    act(() => f.net.last.push({ t: 'stopped', conversationId: TEST_CONVERSATION_ID }));
    await advance(2000);
    expect(screen.getByTestId('where')).toHaveTextContent(`/c/${TEST_CONVERSATION_ID}?diary=1`);
  });
});
