import { emptyGraph } from '@constellate/shared';
import { makeConversation, makeNode, TEST_CONVERSATION_ID } from '@constellate/shared/testing';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveDeps } from './controller';
import { mockDeps } from './deps';
import { LiveNodeList } from './LiveNodeList';
import { LiveScreen } from './LiveScreen';
import type { MockLiveServer } from './mock-server';
import { fakeDeps } from './testing';

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderScreen(deps: LiveDeps, source: Parameters<typeof LiveScreen>[0]['initialSource'] = { kind: 'mic' }) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<LiveScreen initialSource={source} deps={deps} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel, ...utils };
}

describe('LiveScreen on the mock server', () => {
  let server: MockLiveServer;
  let deps: LiveDeps;
  beforeEach(() => {
    ({ server, deps } = mockDeps({ speed: 4 }));
  });
  afterEach(() => server.dispose());

  it('asks for consent first and connects only after everyone agrees', async () => {
    renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' });
    await advance(0);
    expect(screen.getByRole('dialog', { name: 'Play the demo conversation' })).toBeInTheDocument();
    await advance(5000);
    expect(server.received).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(10);
    expect(server.received[0]).toMatchObject({ t: 'hello', consent: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Recording')).toBeInTheDocument();
  });

  it('grows the list of topics, shows captions, flags and parks, then lists open threads before leaving', async () => {
    const { onDone } = renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' });
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(60_000); // four minutes of conversation at 4×

    const topics = screen.getByRole('list', { name: 'Topics so far' });
    expect(within(topics).getByText('Sunday Service')).toBeInTheDocument();
    expect(within(topics).getByText('Intramural Soccer')).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Elapsed time' }).textContent).toMatch(/^[34]:\d\d$/);
    expect(screen.getByTestId('captions').textContent).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: /^Flag/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Moment flagged');
    await advance(1);
    expect(server.state.flags.some((f) => f.source === 'button')).toBe(true);
    expect(within(topics).getAllByText(/⚑ flagged/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Park a thought' }));
    const input = screen.getByLabelText(/two words is enough/);
    expect(input).toHaveAttribute('maxLength', '80');
    fireEvent.change(input, { target: { value: 'Lisbon trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Park it' }));
    await advance(1);
    expect(within(topics).getByText('Lisbon trip')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    const banner = screen.getByRole('dialog', { name: 'Before you go' });
    const open = within(banner).getByRole('list', { name: 'Open threads' });
    expect(within(open).getByText('Intramural Soccer')).toBeInTheDocument();
    expect(within(open).getByText('Lisbon trip')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Open the map' })).toBeDisabled();
    await advance(2000);
    expect(within(banner).getByText('Saved.')).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', { name: 'Open the map' }));
    expect(onDone).toHaveBeenCalledWith(server.conversationId);
  });

  it('pocket mode dims the screen and a double-tap flags', async () => {
    renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' });
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(20_000);
    fireEvent.click(screen.getByRole('button', { name: /Pocket mode/ }));
    const pocket = screen.getByTestId('pocket-mode');
    fireEvent.pointerUp(pocket);
    fireEvent.pointerUp(pocket);
    await advance(1);
    expect(server.state.flags.some((f) => f.source === 'tap')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Exit pocket mode' }));
    expect(screen.queryByTestId('pocket-mode')).not.toBeInTheDocument();
  });
});

describe('LiveScreen with fake deps', () => {
  it('offers WAV replay and the demo when the microphone is denied', async () => {
    const f = fakeDeps({
      startCapture: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError');
      }),
    });
    renderScreen(f.deps);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone agrees — start' }));
    await advance(0);
    expect(screen.getByRole('heading', { name: 'The microphone is blocked' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replay a WAV file/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose an audio file to replay')).toHaveAttribute('type', 'file');
    fireEvent.click(screen.getByRole('button', { name: /Play the demo conversation/ }));
    await advance(0);
    expect(screen.getByRole('dialog', { name: 'Play the demo conversation' })).toBeInTheDocument();
  });

  it('goes straight to the saved map when no thread is left open', async () => {
    const f = fakeDeps({ graph: () => emptyGraph(makeConversation()) });
    const { onDone } = renderScreen(f.deps);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone agrees — start' }));
    await advance(0);
    act(() => {
      f.net.last.open();
      f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    });
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(f.net.last.sent.at(-1)).toEqual({ t: 'stop' });
    act(() => f.net.last.push({ t: 'stopped', conversationId: TEST_CONVERSATION_ID }));
    await advance(0);
    expect(screen.getByText(/No loose ends/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await advance(1500);
    expect(onDone).toHaveBeenCalledWith(TEST_CONVERSATION_ID);
    expect(f.deps.upload).toHaveBeenCalled();
  });

  it('cancel on the consent sheet leaves without touching the microphone', async () => {
    const f = fakeDeps();
    const { onCancel } = renderScreen(f.deps);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(f.deps.startCapture).not.toHaveBeenCalled();
  });
});

describe('LiveNodeList', () => {
  it('follows the newest node and offers "Jump to now" after the user scrolls away', () => {
    const graph = {
      ...emptyGraph(makeConversation()),
      nodes: { a: makeNode('a', { label: 'Alpha' }), b: makeNode('b', { label: 'Beta', seq: 2 }) },
      activeNodeId: 'b',
    };
    render(<LiveNodeList graph={graph} />);
    expect(screen.getByText('Beta').closest('li')).toHaveAttribute('aria-current', 'step');
    const scroller = screen.getByTestId('live-node-scroller');
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    const chip = screen.getByRole('button', { name: 'Jump to now' });
    fireEvent.click(chip);
    expect(screen.queryByRole('button', { name: 'Jump to now' })).not.toBeInTheDocument();
    expect(scroller.scrollTop).toBe(1000);
  });
});
