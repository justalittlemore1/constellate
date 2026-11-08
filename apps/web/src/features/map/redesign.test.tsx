/**
 * Humans' redesign, wave 1: the defaults (flags off), merged returns, comet trails, the
 * hover / click hierarchy, auto-follow resume and the star-chart frame.
 */
import type { GraphState, TopicNode } from '@constellate/shared';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { ConversationMap } from './ConversationMap';
import { AUTO_FOLLOW_RESUME_MS, MAP_FLAGS, resolveFlags } from './flags';
import { durationMs, radiusForMs, threadStars, topicRadius, visibleGraph } from './model';
import { installFlowDomStubs } from './testing';
import { useAutoFollow } from './useAutoFollow';

beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();
const byLabel = (label: string, nth = 0): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label && n.kind === 'topic')
    .sort((a, b) => a.seq - b.seq)[nth]!;
const res1 = byLabel('Resurrection Accounts', 0);
const res2 = byLabel('Resurrection Accounts', 1);
const faith1 = byLabel('Faith vs Evidence', 0);
const faith2 = byLabel('Faith vs Evidence', 1);
const tile = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`);
const wrapper = (n: TopicNode) => tile(n).closest<HTMLElement>('.react-flow__node')!;

describe('flags', () => {
  it('hide every feature by default; one override brings one back', () => {
    expect(Object.values(MAP_FLAGS).every((v) => v === false)).toBe(true);
    expect(resolveFlags({ zoomButtons: true })).toEqual({ ...MAP_FLAGS, zoomButtons: true });
  });

  it('default map: no detail bar, outline toggle, legend, zoom buttons or revisit arcs', () => {
    const { container } = render(<ConversationMap state={demo} />);
    for (const name of [
      'Broad',
      'Balanced',
      'Detailed',
      'Fit the whole map',
      'Show as outline',
      'What the symbols mean',
      'Zoom in',
      'Zoom out',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(container.querySelectorAll('g[data-kind="revisit"]')).toHaveLength(0);
    expect(screen.queryAllByTestId('revisit-badge')).toHaveLength(0);
  });

  it('flipping a flag back restores it', () => {
    render(<ConversationMap state={demo} flags={{ zoomButtons: true, legendHelp: true }} />);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What the symbols mean' })).toBeInTheDocument();
  });
});

describe('"Text view" link (keyboard and screen readers only)', () => {
  it('is visually hidden until focused, and switches to the outline and back', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    const link = screen.getByRole('button', { name: 'Text view' });
    expect(link).toHaveClass('sr-only');
    expect(link.className).toMatch(/focus:not-sr-only/);
    await user.click(link);
    expect(screen.getByRole('tree', { name: /outline/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Map view' }));
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('is the first stop for the keyboard', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Text view' })).toHaveFocus();
  });
});

describe('returns as loops: one star per thread', () => {
  it('threadStars maps later occurrences to the first', () => {
    const m = threadStars(demo);
    expect(m.get(res2.id)).toBe(res1.id);
    expect(m.get(faith2.id)).toBe(faith1.id);
    expect(m.has(res1.id)).toBe(false);
    // a deferred thread and the topic where it was picked up keep their own shapes
    const tripThread = Object.values(demo.nodes).find((n) => n.kind === 'pending' && n.label === 'Summer Road Trip')!;
    expect(m.has(tripThread.id)).toBe(false);
  });

  it('draws one star at the first position, sized by the summed duration', () => {
    const vg = visibleGraph(demo, 'balanced', { mergeReturns: true });
    const stars = vg.nodes.filter((v) => v.node.threadId === res1.threadId);
    expect(stars).toHaveLength(1);
    const star = stars[0]!;
    expect([star.node.x, star.node.y]).toEqual([res1.x, res1.y]);
    expect(star.occurrences.map((o) => o.id)).toEqual([res1.id, res2.id]);
    expect(star.totalMs).toBe(durationMs(res1) + durationMs(res2));
    expect(star.radius).toBe(radiusForMs(star.totalMs, res1.level));
    expect(star.radius).toBeGreaterThan(topicRadius(res1));
    expect(star.flags).toBe(1); // the flag on the later occurrence counts on the star
    expect(vg.starOf(res2.id)).toBe(res1.id);
  });

  it('redirects edges: into the return loops back, out of it branches from the star', () => {
    const vg = visibleGraph(demo, 'balanced', { mergeReturns: true });
    const doubts = byLabel('Personal Doubts');
    const camus = byLabel('Camus and Absurdism');
    const trip = byLabel('Summer Road Trip');
    const find = (s: string, t: string) =>
      vg.edges.find((e) => e.kind === 'flow' && e.sourceId === s && e.targetId === t);
    expect(find(doubts.id, res1.id)?.returning).toBe(true);
    expect(find(res1.id, camus.id)?.returning).toBeUndefined();
    expect(find(trip.id, faith1.id)?.returning).toBe(true);
    expect(vg.edges.some((e) => e.kind === 'revisit')).toBe(false);
    expect(vg.edges.some((e) => e.sourceId === res2.id || e.targetId === res2.id)).toBe(false);
  });

  it('without merging (revisitArcs on) every occurrence keeps its own node', () => {
    const vg = visibleGraph(demo, 'balanced');
    expect(vg.nodes).toHaveLength(Object.keys(demo.nodes).length);
  });

  it('on the canvas: one button, its name says how often it came up; the loop is named in words', () => {
    const { container } = render(<ConversationMap state={demo} />);
    expect(screen.queryByTestId(`map-node-${res2.id}`)).toBeNull();
    const name = wrapper(res1).getAttribute('aria-label')!;
    expect(name.startsWith('Resurrection Accounts,')).toBe(true);
    expect(name).toContain('came up 2 times: 03:50–05:10, 07:00–07:50');
    const loop = [...container.querySelectorAll<SVGGElement>('.react-flow__edge')].find(
      (g) => g.getAttribute('aria-label') === 'Came back from Personal Doubts to Resurrection Accounts',
    );
    expect(loop).toBeTruthy();
    // the loop is told apart by its shape (a side channel), not by colour
    expect(loop!.querySelector('[data-route]')).toHaveAttribute('data-route', 'return');
  });
});

describe('comet trails (flag cometTrails)', () => {
  it('flow edges fade from the source to the target and have no arrowhead; tethers stay dotted', () => {
    const { container } = render(<ConversationMap state={demo} flags={{ cometTrails: true }} />);
    const flow = container.querySelector('g[data-kind="flow"]')!;
    const trail = flow.querySelector('[data-testid="comet-trail"]')!;
    expect(trail.getAttribute('marker-end')).toBeNull();
    const grad = flow.querySelector('linearGradient')!;
    const stops = [...grad.querySelectorAll('stop')].map((s) => Number(s.getAttribute('stop-opacity')));
    expect(stops[0]).toBeGreaterThan(stops[stops.length - 1]!);
    expect(flow.querySelector('[data-testid="comet-head"]')).toBeTruthy();
    const tether = container.querySelector('g[data-kind="tether"] path')!;
    expect(tether.getAttribute('stroke-dasharray')).toBe('0.5 4');
    expect(container.querySelector('g[data-kind="tether"] linearGradient')).toBeNull();
  });

  it('no particles by default', () => {
    render(<ConversationMap state={demo} />);
    expect(screen.queryAllByTestId('particle')).toHaveLength(0);
  });
});

describe('fewer clicks', () => {
  it('a click or tap opens the full sheet; no preview step', () => {
    render(<ConversationMap state={demo} />);
    fireEvent.click(tile(byLabel('Gospel Sources')));
    expect(screen.getByRole('dialog', { name: 'Gospel Sources' })).toBeInTheDocument();
    expect(screen.queryByTestId('preview-card')).toBeNull();
  });

  it('hover (mouse) shows the preview strip, not the sheet', () => {
    render(<ConversationMap state={demo} />);
    fireEvent.mouseEnter(wrapper(byLabel('Gospel Sources')));
    expect(screen.getByTestId('preview-card')).toHaveTextContent('Gospel Sources');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keyboard focus shows the strip; Enter opens the sheet', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    act(() => wrapper(byLabel('Sunday Service')).focus());
    expect(screen.getByTestId('preview-card')).toHaveTextContent('Sunday Service');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Sunday Service' })).toBeInTheDocument();
  });

  it("the merged star's sheet lists every moment", () => {
    render(<ConversationMap state={demo} onPlaySegment={() => {}} />);
    fireEvent.click(tile(res1));
    const sheet = screen.getByRole('dialog', { name: 'Resurrection Accounts' });
    const items = within(within(sheet).getByTestId('moments')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['03:50–05:10 · first', '07:00–07:50 · came back']);
    expect(
      within(sheet).getByRole('button', { name: 'Play Resurrection Accounts at 07:00–07:50' }),
    ).toBeInTheDocument();
  });

  it('live screen (no onEdit) is read-only: no Highlight, no notes, no highlighter', () => {
    render(<ConversationMap state={demo} live />);
    expect(screen.queryByRole('button', { name: /highlighter/i })).toBeNull();
    fireEvent.click(tile(byLabel('Sunday Service')));
    const sheet = screen.getByRole('dialog', { name: 'Sunday Service' });
    expect(within(sheet).queryByRole('button', { name: 'Highlight' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Add a note' })).toBeNull();
  });
});

describe('live auto-follow', () => {
  it('pausing on a user pan, resuming after ~5 s without a touch', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useAutoFollow(true));
      expect(result.current.following).toBe(true);
      act(() => result.current.onUserMoveStart());
      expect(result.current.following).toBe(false);
      act(() => result.current.onUserMoveEnd());
      act(() => vi.advanceTimersByTime(AUTO_FOLLOW_RESUME_MS - 100));
      // a touch restarts the countdown
      act(() => result.current.onTouch());
      act(() => vi.advanceTimersByTime(AUTO_FOLLOW_RESUME_MS - 100));
      expect(result.current.following).toBe(false);
      act(() => vi.advanceTimersByTime(200));
      expect(result.current.following).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing on a saved map', () => {
    const { result } = renderHook(() => useAutoFollow(false));
    act(() => result.current.onUserMoveStart());
    expect(result.current.following).toBe(true);
  });

  it('no "Jump to now" chip by default', () => {
    render(<ConversationMap state={demo} live />);
    expect(screen.queryByRole('button', { name: 'Jump to now' })).toBeNull();
  });
});

describe('appearance', () => {
  function liveWithActive(): GraphState {
    return { ...demo, activeNodeId: byLabel('Camus and Absurdism').id };
  }

  it('stars fade in (CSS, instant under reduced motion); the active star never pulses', () => {
    render(<ConversationMap state={liveWithActive()} live />);
    const camus = tile(byLabel('Camus and Absurdism'));
    expect(camus).toHaveClass('cmap-appear');
    expect(document.querySelector('.cmap-pulse')).toBeNull();
    expect(within(camus).getByTestId('y3-main')).toHaveClass('cmap-shift-fill');
    expect(within(camus).getByTestId('active-core')).toBeInTheDocument();
    expect(within(camus).getByText('now')).toBeInTheDocument();
  });

  it('reduced motion: no colour shift either', () => {
    usePrefs.getState().set({ reduceMotion: true });
    render(<ConversationMap state={liveWithActive()} live />);
    expect(document.querySelector('.cmap-shift-fill')).toBeNull();
    usePrefs.getState().reset();
  });
});

describe('star-chart frame', () => {
  it('preview strip and sheets carry the frame and the serif title', () => {
    render(<ConversationMap state={demo} />);
    fireEvent.mouseEnter(wrapper(byLabel('Gospel Sources')));
    expect(screen.getByTestId('preview-card')).toHaveClass('cmap-chart');
    expect(screen.getByTestId('preview-card').className).not.toMatch(/rounded/);
    fireEvent.click(tile(byLabel('Gospel Sources')));
    const sheet = screen.getByRole('dialog', { name: 'Gospel Sources' });
    expect(sheet).toHaveAttribute('data-testid', 'node-detail-sheet');
    expect(
      within(sheet).getByRole('heading', { name: 'Gospel Sources' }).querySelector('.cmap-chart-title'),
    ).toBeTruthy();
  });
});
