import { emptyGraph } from '@constellate/shared';
import { makeConversation, makeNode, TEST_CONVERSATION_ID } from '@constellate/shared/testing';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrefs } from '../../lib/prefs';
import { installFlowDomStubs } from '../map/testing';
import { MapBoundary } from './LiveMap';
import { WASH } from './styles';
import type { LiveDeps } from './controller';
import { FLAG_HOLD_MS, type LiveFeatures } from './flags';
import { mockDeps } from './deps';
import { LiveNodeList } from './LiveNodeList';
import { PhoneFrame } from '../../app/PhoneFrame';
import { LiveScreen } from './LiveScreen';
import type { MockLiveServer } from './mock-server';
import { fakeDeps } from './testing';

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeAll(() => installFlowDomStubs());

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  usePrefs.getState().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderScreen(
  deps: LiveDeps,
  source: Parameters<typeof LiveScreen>[0]['initialSource'] = { kind: 'mic' },
  speed?: number,
  features?: Partial<LiveFeatures>,
) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <LiveScreen
      initialSource={source}
      deps={deps}
      speed={speed}
      features={features}
      onDone={onDone}
      onCancel={onCancel}
    />,
  );
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

  it('in the node list (low-stimulation): grows topics, shows captions, flags and parks, then lists open threads', async () => {
    usePrefs.getState().set({ lowStimulation: true });
    const { onDone } = renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' }, undefined, {
      parkThought: true,
    });
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(60_000); // four minutes of conversation at 4×

    const topics = screen.getByRole('list', { name: 'Topics so far' });
    expect(within(topics).getByText('Sunday Service')).toBeInTheDocument();
    expect(within(topics).getByText('Intramural Soccer')).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Elapsed time' }).textContent).toMatch(/^[34]:\d\d$/);
    expect(screen.getByTestId('captions').textContent).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: /^Flag/ }));
    expect(screen.getByText('Moment flagged')).toHaveAttribute('role', 'status');
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

describe('LiveScreen accessibility', () => {
  let server: MockLiveServer;
  let deps: LiveDeps;
  beforeEach(() => {
    ({ server, deps } = mockDeps({ speed: 4 }));
  });
  afterEach(() => server.dispose());

  const press = (key: string, el: Element = document.activeElement ?? document.body) =>
    act(() => {
      fireEvent.keyDown(el, { key });
    });

  async function startDemo(features?: Partial<LiveFeatures>) {
    const utils = renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' }, undefined, features);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(20_000);
    return utils;
  }

  it('the consent sheet takes focus, makes the screen behind it inert, and Escape cancels', async () => {
    const { onCancel } = renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' });
    await advance(0);
    const dialog = screen.getByRole('dialog', { name: 'Play the demo conversation' });
    expect(screen.getByRole('button', { name: 'Start the demo' })).toHaveFocus();
    expect(screen.getByTestId('live-content')).toHaveAttribute('inert');
    expect(screen.getByTestId('live-content').tagName).toBe('MAIN'); // the screen's main landmark
    press('Escape');
    expect(onCancel).toHaveBeenCalled();
    expect(dialog).toBeInTheDocument(); // the route leaves; nothing was started
    expect(server.received).toHaveLength(0);
  });

  it('Park traps focus, ignores F typed in its field, closes on Escape and returns focus to the opener', async () => {
    await startDemo({ parkThought: true });
    expect(screen.getByTestId('live-content')).not.toHaveAttribute('inert');
    const opener = screen.getByRole('button', { name: 'Park a thought' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Park a thought' });
    const input = within(dialog).getByLabelText(/two words is enough/);
    expect(input).toHaveFocus();
    expect(screen.getByTestId('live-content')).toHaveAttribute('inert');

    // double F inside the real field types text, never flags
    press('f', input);
    press('f', input);
    fireEvent.change(input, { target: { value: 'ff' } });
    await advance(10);
    expect(server.received.some((m) => m.t === 'flag')).toBe(false);

    // Tab from the last control wraps to the first inside the dialog
    const buttons = within(dialog).getAllByRole('button');
    const last = buttons.at(-1)!;
    last.focus();
    press('Tab', last);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);

    press('Escape');
    expect(screen.queryByRole('dialog', { name: 'Park a thought' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(server.received.some((m) => m.t === 'park')).toBe(false);
  });

  it('pocket mode is a dialog: focus moves to Exit, Escape exits and focus returns', async () => {
    await startDemo();
    const opener = screen.getByRole('button', { name: /Pocket mode/ });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Pocket mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit pocket mode' })).toHaveFocus();
    expect(screen.getByTestId('live-content')).toHaveAttribute('inert');
    press('Escape');
    expect(screen.queryByRole('dialog', { name: 'Pocket mode' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Before you go takes focus and Escape leaves for the saved map', async () => {
    const { onDone } = await startDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await advance(0);
    const dialog = screen.getByRole('dialog', { name: 'Before you go' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(onDone).toHaveBeenCalledWith(server.conversationId);
  });

  it('does not announce every stage change, only lost connections', async () => {
    await startDemo();
    act(() => server.drop());
    const regions = screen.getAllByRole('status');
    expect(regions.some((r) => r.textContent === 'Connection lost. Reconnecting…')).toBe(true);
    expect(screen.getByText('Reconnecting…').closest('[aria-live]')).toBeNull();
    await advance(1000);
    expect(screen.getByText('Listening').closest('[aria-live]')).toBeNull();
    expect(regions.every((r) => !r.textContent?.includes('Listening'))).toBe(true);
  });
});

describe('LiveScreen without a conversation id', () => {
  it('stopping before the server answered goes home instead of trapping the user', async () => {
    const f = fakeDeps();
    const { onCancel, onDone } = renderScreen(f.deps);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone agrees — start' }));
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' })); // still connecting: no ready yet
    await advance(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('LiveScreen inside the PhoneFrame', () => {
  it('focuses the consent button on first open even though #overlay-root mounts after the screen', async () => {
    const { deps, server } = mockDeps({ speed: 4 });
    render(
      <PhoneFrame>
        <LiveScreen initialSource={{ kind: 'transcript', fixture: 'demo-religion' }} deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />
      </PhoneFrame>,
    );
    await advance(0);
    const start = screen.getByRole('button', { name: 'Start the demo' });
    expect(document.getElementById('overlay-root')!.contains(start)).toBe(true);
    expect(start).toHaveFocus();
    server.dispose();
  });
});

/** a map node button whose accessible name mentions the label */
const mapNode = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.react-flow__node[role="button"]')].find((el) =>
    el.getAttribute('aria-label')?.includes(label),
  );

describe('LiveScreen map (A3)', () => {
  let server: MockLiveServer;
  let deps: LiveDeps;
  beforeEach(() => {
    ({ server, deps } = mockDeps({ speed: 4 }));
  });
  afterEach(() => server.dispose());

  async function startDemo(speed?: number) {
    const utils = renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' }, speed);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(10);
    return utils;
  }

  it('explains the empty map, then mounts the constellation following the newest node', async () => {
    await startDemo();
    expect(screen.getByText('Topics appear here as the conversation goes.')).toBeInTheDocument();
    await advance(5_000); // first topic at 2.5 s of conversation (0.6 s at 4×)
    const content = screen.getByTestId('live-content');
    expect(content.querySelector('.react-flow')).not.toBeNull();
    expect(mapNode('Sunday Service')).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Topics so far' })).not.toBeInTheDocument();
    await advance(20_000); // second topic at 70 s (17.5 s at 4×)
    expect(mapNode('Historical Jesus')).toBeDefined();
  });

  it('keeps the node list in low-stimulation mode', async () => {
    usePrefs.getState().set({ lowStimulation: true });
    await startDemo();
    await advance(5_000);
    expect(screen.getByRole('list', { name: 'Topics so far' })).toBeInTheDocument();
    expect(screen.getByTestId('live-content').querySelector('.react-flow')).toBeNull();
  });

  it('labels a sped-up demo replay', async () => {
    await startDemo(4);
    expect(screen.getByText('Demo replay ×4')).toBeInTheDocument();
  });

  it('labels a real-time demo replay without a multiplier', async () => {
    await startDemo(1);
    expect(screen.getByText('Demo replay')).toBeInTheDocument();
  });
});

describe('MapBoundary', () => {
  it('shows the fallback if the map throws, and the fallback keeps updating', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('canvas broke');
    };
    const { rerender } = render(
      <MapBoundary fallback={<p>list v1</p>}>
        <Boom />
      </MapBoundary>,
    );
    expect(screen.getByText('list v1')).toBeInTheDocument();
    rerender(
      <MapBoundary fallback={<p>list v2</p>}>
        <Boom />
      </MapBoundary>,
    );
    expect(screen.getByText('list v2')).toBeInTheDocument();
  });
});

describe('caption strip', () => {
  it('cuts long captions at a word, with an ellipsis and a fade, never mid-word', async () => {
    const f = fakeDeps({ graph: () => emptyGraph(makeConversation()) });
    renderScreen(f.deps);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone agrees — start' }));
    await advance(0);
    const long = 'Whether Jesus existed as a historical figure and what historians mostly agree on today.';
    act(() => {
      f.net.last.open();
      f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
      f.net.last.push({ t: 'caption', text: long, final: true, startMs: 0, utteranceId: 'u1' });
    });
    const line = screen.getByTestId('caption-line');
    expect(line.className).toContain('mask-image');
    const text = line.textContent!;
    expect(text.startsWith('…')).toBe(true);
    const shown = text.slice(1);
    expect(long.endsWith(shown)).toBe(true);
    expect(long[long.length - shown.length - 1]).toBe(' '); // starts at a word boundary
    // screen readers still get the whole caption
    expect(screen.getByText(long)).toHaveClass('sr-only');
  });
});

describe('redesign wave 1: flag notes, hidden Park, star-chart frame', () => {
  let server: MockLiveServer;
  let deps: LiveDeps;
  beforeEach(() => {
    ({ server, deps } = mockDeps({ speed: 4 }));
  });
  afterEach(() => server.dispose());

  async function live(features?: Partial<LiveFeatures>) {
    const utils = renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' }, 4, features);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(20_000); // ~80 s of conversation: Historical Jesus is the current topic
    return utils;
  }
  const flagButton = () => screen.getByRole('button', { name: /^(Flag|Keep holding…)$/ });
  const hold = async () => {
    const b = flagButton();
    fireEvent.pointerDown(b);
    await advance(FLAG_HOLD_MS);
    fireEvent.pointerUp(b);
  };
  const shiftF = () =>
    act(() => {
      fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true });
    });

  it('hides Park a thought by default: no button, two controls in the bar', async () => {
    await live();
    expect(screen.queryByRole('button', { name: 'Park a thought' })).not.toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Recording controls' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Flag', 'Stop']);
  });

  it('a tap still flags without a note', async () => {
    await live();
    const b = flagButton();
    fireEvent.pointerDown(b);
    fireEvent.pointerUp(b);
    await advance(1);
    expect(screen.queryByRole('dialog', { name: 'Add a note to this flag' })).not.toBeInTheDocument();
    expect(server.state.flags.some((f) => f.source === 'button' && f.note === null)).toBe(true);
  });

  it('hold → labelled note field (≤ 140) in the star-chart frame → saved on the topic node, not as a new node', async () => {
    await live();
    const nodesBefore = Object.keys(server.state.nodes).length;
    await hold();
    const dialog = screen.getByRole('dialog', { name: 'Add a note to this flag' });
    expect(dialog).toHaveAttribute('data-frame', 'star-chart');
    expect(dialog.className).toContain('rounded-none');
    const field = within(dialog).getByRole('textbox', { name: 'Note' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('maxLength', '140');
    fireEvent.change(field, { target: { value: 'Sam on the Q source' } });
    expect(within(dialog).getByText('19/140 characters')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));
    await advance(1);
    const flag = server.state.flags.find((f) => f.note === 'Sam on the Q source');
    expect(flag).toMatchObject({ source: 'button' });
    expect(server.state.nodes[flag!.nodeId!]?.label).toBe('Historical Jesus');
    expect(Object.keys(server.state.nodes)).toHaveLength(nodesBefore);
    expect(screen.getByText('Flagged with a note')).toBeInTheDocument();
  });

  it('Escape cancels the note: nothing is flagged and focus goes back to Flag', async () => {
    await live();
    const flagsBefore = server.state.flags.length;
    flagButton().focus();
    await hold();
    expect(screen.getByRole('dialog', { name: 'Add a note to this flag' })).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Add a note to this flag' })).not.toBeInTheDocument();
    expect(flagButton()).toHaveFocus();
    await advance(10);
    expect(server.state.flags).toHaveLength(flagsBefore);
  });

  it('Shift+F is the keyboard way in; "Flag without note" adds the plain flag', async () => {
    await live();
    shiftF();
    const dialog = screen.getByRole('dialog', { name: 'Add a note to this flag' });
    // typing F in the note never counts towards a double-F flag
    const field = within(dialog).getByRole('textbox', { name: 'Note' });
    fireEvent.keyDown(field, { key: 'f' });
    fireEvent.keyDown(field, { key: 'f' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Flag without note' }));
    await advance(1);
    const keyFlags = server.state.flags.filter((f) => f.source === 'key');
    expect(keyFlags).toHaveLength(1);
    expect(keyFlags[0]!.note).toBeNull();
  });

  it('Enter in the note saves it', async () => {
    await live();
    shiftF();
    const field = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(field, { target: { value: 'quick one' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await advance(1);
    expect(server.state.flags.some((f) => f.note === 'quick one' && f.source === 'key')).toBe(true);
  });

  it('degraded (flagNotes: false): hold and Shift+F just flag, no note field', async () => {
    await live({ flagNotes: false });
    await hold();
    expect(screen.queryByRole('dialog', { name: 'Add a note to this flag' })).not.toBeInTheDocument();
    await advance(1);
    expect(server.state.flags.filter((f) => f.source === 'button')).toHaveLength(1);
    await advance(2000); // past the debounce
    shiftF();
    expect(screen.queryByRole('dialog', { name: 'Add a note to this flag' })).not.toBeInTheDocument();
    await advance(1);
    expect(server.state.flags.filter((f) => f.source === 'key')).toHaveLength(1);
  });

  it('consent and Before you go use the square star-chart frame; the recording dot is steady', async () => {
    renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' });
    await advance(0);
    const consent = screen.getByRole('dialog', { name: 'Play the demo conversation' });
    expect(consent).toHaveAttribute('data-frame', 'star-chart');
    expect(within(consent).getByText(/Press and hold Flag \(or press Shift\+F\) to add a note/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(5000);
    const dot = screen.getByText('Recording').querySelector('span[aria-hidden]')!;
    expect(dot.className).not.toMatch(/animate|pulse/);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await advance(0);
    const bye = screen.getByRole('dialog', { name: 'Before you go' });
    expect(bye).toHaveAttribute('data-frame', 'star-chart');
    expect(bye.querySelector('[class*="rounded-xl"], [class*="rounded-full"]')).toBeNull();
  });
});

describe('bottom bar and pocket mode polish', () => {
  let server: MockLiveServer;
  let deps: LiveDeps;
  beforeEach(() => {
    ({ server, deps } = mockDeps({ speed: 4 }));
  });
  afterEach(() => server.dispose());

  async function live() {
    renderScreen(deps, { kind: 'transcript', fixture: 'demo-religion' }, 4);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    await advance(5_000);
  }

  it('Flag and Stop are ~48 px, 16 px text, one line with the icon after the text, named "Flag" / "Stop"', async () => {
    await live();
    const bar = screen.getByRole('navigation', { name: 'Recording controls' });
    for (const name of ['Flag', 'Stop']) {
      const b = within(bar).getByRole('button', { name });
      expect(b).toHaveAccessibleName(name);
      expect(b.className).toMatch(/\bmin-h-12\b/); // 48 px (never below the 44 px target)
      expect(b.className).not.toMatch(/min-h-\[56px\]/);
      expect(b.className).toContain('text-[16px]');
      expect(b.className).not.toContain('flex-col'); // one line
      const svg = b.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      // the icon comes after the label text
      const label = [...b.childNodes].find((n) => n.textContent?.trim() === name)!;
      expect(label.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('the Flag name stays "Flag" while the label says "Keep holding…", above a thin progress line', async () => {
    await live();
    const b = screen.getByRole('button', { name: 'Flag' });
    fireEvent.pointerDown(b);
    expect(b).toHaveTextContent('Keep holding…');
    expect(b).toHaveAccessibleName('Flag');
    expect(screen.getByTestId('flag-hold-progress').className).toContain('h-[2px]');
    fireEvent.pointerLeave(b);
  });

  it('the bottom bar has no grey top border', async () => {
    await live();
    const bar = screen.getByRole('navigation', { name: 'Recording controls' });
    expect(bar.className).not.toMatch(/\bborder-t\b|border-white/);
  });

  it('pocket mode shows only its one sentence and an "Exit" button (named "Exit pocket mode"); Escape still exits', async () => {
    await live();
    fireEvent.click(screen.getByRole('button', { name: /Pocket mode/ }));
    const pocket = screen.getByRole('dialog', { name: 'Pocket mode' });
    const exit = within(pocket).getByRole('button', { name: 'Exit pocket mode' });
    expect(exit).toHaveTextContent(/^Exit$/);
    expect(pocket.textContent).toBe('Pocket mode. Double-tap anywhere to flag a moment.Exit');
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Pocket mode' })).not.toBeInTheDocument();
  });

  it('hover / press use the shared grey wash (~7.5 % white) on enabled controls', async () => {
    await live();
    const wash = 'enabled:hover:before:bg-white/[0.075]';
    expect(WASH).toContain(wash);
    expect(WASH).toContain('enabled:active:before:bg-white/[0.075]');
    for (const name of ['Flag', 'Stop', /Pocket mode/]) {
      expect(screen.getByRole('button', { name }).className).toContain(wash);
    }
    fireEvent.click(screen.getByRole('button', { name: /Pocket mode/ }));
    expect(screen.getByRole('button', { name: 'Exit pocket mode' }).className).toContain(wash);
  });
});
