import type { GraphState, TopicNode } from '@constellate/shared';
import { makeEdge, makeGraph, makeNode } from '@constellate/shared/testing';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { renderApp } from '../../test/render';
import { ConversationMap, KEYBOARD_HINT } from './ConversationMap';
import { ConversationScreen } from './ConversationScreen';
import { FlowEdge, RevisitEdge, TetherEdge } from './edges';
import type { MapFlowEdge } from './flow';
import { installFlowDomStubs } from './testing';

beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();
const nodeOf = (label: string, nth = 0): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label)
    .sort((a, b) => a.seq - b.seq)[nth]!;
const tile = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`);
/** the focusable React Flow wrapper around a node */
const wrapper = (n: TopicNode) => tile(n).closest<HTMLElement>('.react-flow__node')!;

function liveGraph(): GraphState {
  const g = makeGraph();
  g.nodes = {
    a: makeNode('a', { seq: 1, label: 'Opening', status: 'closed', startMs: 0, endMs: 60_000, x: 140, y: 0 }),
    b: makeNode('b', { seq: 2, label: 'Maybe Topic', status: 'provisional', startMs: 60_000, x: 140, y: 96 }),
  };
  g.edges = { e: makeEdge('e', 'a', 'b') };
  g.activeNodeId = 'a';
  g.lastSeq = 2;
  return g;
}

describe('ConversationMap on the fixture graph', () => {
  it('renders every node as a labelled button, positioned only from node x/y', () => {
    render(<ConversationMap state={demo} />);
    for (const n of Object.values(demo.nodes)) {
      const el = wrapper(n);
      expect(el).toHaveAttribute('role', 'button');
      expect(el.getAttribute('aria-label')).toContain(n.label);
      expect(el).toHaveAttribute('tabindex', '0');
      // the circle's centre sits on (x, y): the box is offset by half its size
      const side = parseFloat(tile(n).style.width);
      expect(el.style.transform).toBe(`translate(${n.x - side / 2}px,${n.y - side / 2}px)`);
    }
  });

  it('puts nodes in conversation order so Tab follows the conversation', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const ids = [...container.querySelectorAll<HTMLElement>('.react-flow__node[role="button"]')].map(
      (el) => el.dataset.id,
    );
    const expected = Object.values(demo.nodes)
      .sort((a, b) => a.seq - b.seq)
      .map((n) => n.id);
    expect(ids).toEqual(expected);
  });

  it('draws each node kind with a non-colour cue', () => {
    render(<ConversationMap state={demo} />);
    expect(tile(nodeOf('Sunday Service'))).toHaveAttribute('data-kind', 'topic');
    // threads: hollow dashed ring + glyph per kind / status
    const soccer = tile(nodeOf('Intramural Soccer'));
    expect(within(soccer).getByTestId('thread-ring')).toHaveAttribute('stroke-dasharray');
    expect(within(soccer).getByTestId('glyph-pending')).toBeInTheDocument();
    expect(within(tile(nodeOf('Ask About Internship'))).getByTestId('glyph-parked')).toBeInTheDocument();
    const resolved = Object.values(demo.nodes).find((n) => n.kind === 'pending' && n.status === 'resolved')!;
    expect(within(tile(resolved)).getByTestId('glyph-resolved')).toBeInTheDocument();
    // revisit ↺ badge, flag pin, highlight ring
    const back = tile(nodeOf('Resurrection Accounts', 1));
    expect(within(back).getByTestId('revisit-badge')).toHaveTextContent('↺');
    expect(within(back).getByTestId('flag-badge')).toBeInTheDocument();
    expect(within(back).getByTestId('highlight-ring')).toBeInTheDocument();
    expect(within(tile(nodeOf('Sunday Service'))).queryByTestId('revisit-badge')).toBeNull();
  });

  it('draws each edge kind with its own pattern', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const kinds = (k: string) => container.querySelectorAll(`g[data-kind="${k}"]`);
    expect(kinds('flow').length).toBe(Object.values(demo.edges).filter((e) => e.kind === 'flow').length);
    expect(kinds('revisit').length).toBe(2);
    expect(kinds('tether').length).toBe(4);
    expect(kinds('note').length).toBe(1);
    const revisitPath = kinds('revisit')[0]!.querySelector('path')!;
    expect(revisitPath.getAttribute('stroke-dasharray')).toBe('7 5');
    expect(revisitPath.getAttribute('marker-end')).toMatch(/url\(/);
    const tetherPath = kinds('tether')[0]!.querySelector('path')!;
    expect(tetherPath.getAttribute('stroke-linecap')).toBe('round');
    expect(tetherPath.getAttribute('marker-end')).toBeNull();
    const flowPath = kinds('flow')[0]!.querySelector('path')!;
    expect(flowPath.getAttribute('stroke-dasharray')).toBeNull();
    expect(flowPath.getAttribute('marker-end')).toMatch(/url\(/);
  });

  it('shows the sticky note in Balanced and hides it in Broad, where level-2 topics fold in', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    expect(screen.getByTestId(`map-note-${demo.annotations[0]!.id}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Broad' }));
    expect(screen.getByRole('button', { name: 'Broad' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId(`map-note-${demo.annotations[0]!.id}`)).toBeNull();
    expect(screen.queryByTestId(`map-node-${nodeOf('Gospel Sources').id}`)).toBeNull();
    expect(within(tile(nodeOf('Historical Jesus'))).getByTestId('child-badge')).toHaveTextContent('+2');
  });

  it('Detailed shows the start time under each label', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    expect(within(tile(nodeOf('Historical Jesus'))).queryByText('01:10')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Detailed' }));
    expect(within(tile(nodeOf('Historical Jesus'))).getByText('01:10')).toBeInTheDocument();
  });
});

describe('live statuses and motion', () => {
  it('active node pulses and says "now"; provisional is at 40 % and called tentative', () => {
    const g = liveGraph();
    render(<ConversationMap state={g} followLatest />);
    const a = tile(g.nodes.a!);
    expect(a).toHaveAttribute('data-active', 'true');
    expect(within(a).getByTestId('pulse')).toBeInTheDocument();
    expect(within(a).getByText('now')).toBeInTheDocument();
    const b = tile(g.nodes.b!);
    expect(b.style.opacity).toBe('0.4');
    expect(wrapper(g.nodes.b!).getAttribute('aria-label')).toContain('tentative');
    expect(screen.getAllByTestId('particle').length).toBeGreaterThan(0);
  });

  it('reduced motion removes the pulse and the particles but keeps the static ring and words', () => {
    usePrefs.getState().set({ reduceMotion: true });
    const g = liveGraph();
    render(<ConversationMap state={g} followLatest />);
    expect(screen.queryByTestId('pulse')).toBeNull();
    expect(screen.queryByTestId('particle')).toBeNull();
    expect(within(tile(g.nodes.a!)).getByText('now')).toBeInTheDocument();
    usePrefs.getState().reset();
  });

  it('shows new nodes as the state grows', () => {
    const g = liveGraph();
    const { rerender } = render(<ConversationMap state={g} followLatest />);
    const c = makeNode('c', { seq: 3, label: 'Fresh Idea', startMs: 120_000, x: 140, y: 192 });
    rerender(
      <ConversationMap state={{ ...g, nodes: { ...g.nodes, c }, activeNodeId: 'c', lastSeq: 3 }} followLatest />,
    );
    expect(tile(c)).toHaveAttribute('data-active', 'true');
  });

  it('shows a placeholder before the first topic', () => {
    render(<ConversationMap state={makeGraph()} followLatest />);
    expect(screen.getByText('Topics appear here as the conversation goes.')).toBeInTheDocument();
  });
});

describe('screen reader names and instructions', () => {
  it('every node points at the keyboard instructions', () => {
    render(<ConversationMap state={demo} />);
    for (const n of Object.values(demo.nodes)) {
      const id = wrapper(n).getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      expect(document.getElementById(id!)).toHaveTextContent(KEYBOARD_HINT);
    }
  });

  it('edges are named in words, never by raw ids', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const edges = [...container.querySelectorAll<SVGGElement>('.react-flow__edge')];
    expect(edges.length).toBeGreaterThan(0);
    for (const el of edges) {
      const name = el.getAttribute('aria-label') ?? '';
      expect(name).not.toMatch(/^Edge from/);
      expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
    const names = edges.map((el) => el.getAttribute('aria-label'));
    expect(names).toContain('Moved on from Sunday Service to Historical Jesus');
    expect(names).toContain('Resurrection Accounts returns to the earlier Resurrection Accounts');
    expect(names).toContain('Thread Intramural Soccer linked to Gospel Sources');
    expect(names).toContain('Note on Resurrection Accounts: Look up the Q source hypothesis');
  });
});

describe('Detailed zoom keeps edges off the time line', () => {
  it('re-routes forward edges when each label gains its time line', async () => {
    const user = userEvent.setup();
    const { container } = render(<ConversationMap state={demo} />);
    const flowId = Object.values(demo.edges).find(
      (e) => e.kind === 'flow' && e.sourceId === nodeOf('Historical Jesus').id,
    )!.id;
    const path = () => container.querySelector(`[data-testid="map-edge-${flowId}"] path`)!.getAttribute('d');
    const balanced = path();
    await user.click(screen.getByRole('button', { name: 'Detailed' }));
    expect(path()).not.toBe(balanced);
  });
});

describe('interactions', () => {
  it('tap → preview card → detail sheet → "How did we get here?" lights the path', async () => {
    const user = userEvent.setup();
    const onNodeSelect = vi.fn();
    render(<ConversationMap state={demo} onNodeSelect={onNodeSelect} />);
    const target = nodeOf('Resurrection Accounts');
    fireEvent.click(tile(target));
    expect(onNodeSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: target.id }));
    const card = screen.getByTestId('preview-card');
    expect(card).toHaveTextContent(target.summary);
    expect(card).toHaveTextContent('03:50–05:10');

    await user.click(within(card).getByRole('button', { name: `Open details for ${target.label}` }));
    const sheet = screen.getByRole('dialog', { name: target.label });
    expect(sheet).toHaveTextContent('picked up again at 07:00');
    expect(sheet).toHaveTextContent('Look up the Q source hypothesis');
    // no recording given → no play button
    expect(within(sheet).queryByRole('button', { name: /play/i })).toBeNull();

    await user.click(within(sheet).getByRole('button', { name: 'How did we get here?' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('path-banner')).toHaveTextContent(
      'Sunday Service → Historical Jesus → Gospel Sources → Resurrection Accounts',
    );
    expect(tile(nodeOf('Camus and Absurdism'))).toHaveClass('cmap-dim');
    expect(tile(nodeOf('Gospel Sources'))).not.toHaveClass('cmap-dim');
    await user.click(screen.getByRole('button', { name: 'Clear path' }));
    expect(screen.queryByTestId('path-banner')).toBeNull();
  });

  it('offers "Play this moment" when the screen gives a player', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    render(<ConversationMap state={demo} onPlaySegment={onPlay} />);
    const n = nodeOf('Gospel Sources');
    fireEvent.click(tile(n));
    await user.click(screen.getByRole('button', { name: `Play ${n.label}` }));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: n.id }));
  });

  it('long-press opens quick actions', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationMap state={demo} />);
      const n = nodeOf('Faith vs Evidence');
      fireEvent.pointerDown(tile(n), { button: 0, clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(600));
      const sheet = screen.getByRole('dialog', { name: `${n.label}: quick actions` });
      expect(within(sheet).getByRole('button', { name: 'Open details' })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: 'How did we get here?' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a moved finger is a pan, not a long-press', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationMap state={demo} />);
      const el = tile(nodeOf('Faith vs Evidence'));
      fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(el, { clientX: 60, clientY: 10 });
      act(() => vi.advanceTimersByTime(600));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keyboard: arrows walk the nodes in order, Enter previews, Enter again opens details', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    const first = nodeOf('Sunday Service');
    const second = nodeOf('Historical Jesus');
    wrapper(first).focus();
    await user.keyboard('{ArrowDown}');
    expect(wrapper(second)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(wrapper(first)).toHaveFocus();
    await user.keyboard('{End}');
    const last = Object.values(demo.nodes).sort((a, b) => b.seq - a.seq)[0]!;
    expect(wrapper(last)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('preview-card')).toHaveTextContent(last.label);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: last.label })).toBeInTheDocument();
  });

  it('the legend explains every symbol in words', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    await user.click(screen.getByRole('button', { name: 'What the symbols mean' }));
    const legend = screen.getByRole('dialog', { name: 'What the map shows' });
    for (const t of [
      'Topic',
      'Being discussed now',
      'Tentative topic',
      'Came back to an earlier topic',
      'Mentioned for later',
      'Parked thought',
      'Highlighted',
      'Flagged moment',
      'Your note',
    ]) {
      expect(within(legend).getByText(t)).toBeInTheDocument();
    }
  });

  it('has keyboard-reachable zoom buttons', () => {
    render(<ConversationMap state={demo} />);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit the whole map' })).toBeInTheDocument();
  });
});

describe('edge components', () => {
  const base = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 140,
    sourceY: 0,
    targetX: 280,
    targetY: 200,
    sourcePosition: 'top',
    targetPosition: 'top',
    markerEnd: 'url(#m)',
    selectable: false,
    deletable: false,
    selected: false,
    animated: false,
  } as unknown as Parameters<typeof FlowEdge>[0];
  const data = (over: Partial<NonNullable<MapFlowEdge['data']>> = {}) => ({
    kind: 'flow' as const,
    sourceRadius: 20,
    targetRadius: 20,
    highlighted: false,
    dimmed: false,
    motion: true,
    labelGap: 0,
    ...over,
  });

  it('flow particles only with motion on', () => {
    const { container, rerender } = render(
      <svg>
        <FlowEdge {...base} data={data()} />
      </svg>,
    );
    expect(container.querySelectorAll('[data-testid="particle"]').length).toBe(2);
    rerender(
      <svg>
        <FlowEdge {...base} data={data({ motion: false })} />
      </svg>,
    );
    expect(container.querySelectorAll('[data-testid="particle"]').length).toBe(0);
  });

  it('highlighted edges are thicker but keep their own colour and pattern', () => {
    const { container } = render(
      <svg>
        <RevisitEdge {...base} data={data({ kind: 'revisit', highlighted: true })} />
        <TetherEdge {...base} id="t" data={data({ kind: 'tether', highlighted: true })} />
      </svg>,
    );
    const rev = container.querySelector('g[data-kind="revisit"] path')!;
    expect(rev.getAttribute('stroke')).toBe('var(--revisit)');
    expect(Number(rev.getAttribute('stroke-width'))).toBeGreaterThan(2);
    expect(rev.getAttribute('stroke-dasharray')).toBe('7 5');
    expect(container.querySelector('g[data-kind="tether"] path')!.getAttribute('stroke')).toBe('var(--thread)');
  });

  it('dimmed edges fade for the path tracer', () => {
    const { container } = render(
      <svg>
        <FlowEdge {...base} data={data({ dimmed: true })} />
      </svg>,
    );
    expect(container.querySelector('g[data-kind="flow"]')).toHaveAttribute('opacity', '0.15');
    expect(container.querySelectorAll('[data-testid="particle"]').length).toBe(0);
  });
});

describe('ConversationScreen (/c/:id)', () => {
  it('loads the conversation and renders its map', async () => {
    renderApp({ route: `/c/${demo.conversation.id}`, element: <ConversationScreen />, path: '/c/:id' });
    expect(await screen.findByRole('heading', { name: demo.conversation.title })).toBeInTheDocument();
    expect(await screen.findByTestId(`map-node-${nodeOf('Sunday Service').id}`)).toBeInTheDocument();
  });

  it('shows an error with a retry for an unknown conversation', async () => {
    renderApp({ route: '/c/nope', element: <ConversationScreen />, path: '/c/:id' });
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't load");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
