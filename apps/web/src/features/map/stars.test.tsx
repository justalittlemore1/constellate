/**
 * Wave 2 star art (Y4, now behind the facetedStars flag): node kind / status → art, reduced motion = static, accessible names unchanged.
 */
import type { GraphState, TopicNode } from '@constellate/shared';
import { makeEdge, makeGraph, makeNode } from '@constellate/shared/testing';
import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { EMBER, PALETTES, Y4_DARK, Y4_LIGHT } from './art';
import { ConversationMap } from './ConversationMap';
import { THREAD_RADIUS, topicRadius, visibleGraph } from './model';
import { installFlowDomStubs } from './testing';

beforeAll(() => installFlowDomStubs());

/** wave-2 faceted stars sit behind the facetedStars flag since wave 3 */
const Y4 = { facetedStars: true };

const demo = loadDemoGraph();
const byLabel = (label: string, kind: TopicNode['kind'] = 'topic'): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label && n.kind === kind)
    .sort((a, b) => a.seq - b.seq)[0]!;
const tile = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`);
const wrapper = (n: TopicNode) => tile(n).closest<HTMLElement>('.react-flow__node')!;

function states(): GraphState {
  const g = makeGraph();
  g.nodes = {
    a: makeNode('a', { seq: 1, label: 'Active One', status: 'active', startMs: 0, endMs: null, x: 140, y: 0 }),
    p: makeNode('p', { seq: 2, label: 'Maybe', status: 'provisional', startMs: 60_000, x: 140, y: 96 }),
    h: makeNode('h', {
      seq: 3,
      label: 'Golden',
      status: 'closed',
      highlighted: true,
      startMs: 0,
      endMs: 90_000,
      x: 140,
      y: 192,
    }),
  };
  g.edges = { e1: makeEdge('e1', 'a', 'p'), e2: makeEdge('e2', 'p', 'h') };
  g.activeNodeId = 'a';
  return g;
}

describe('topic = Y4 faceted star', () => {
  it("draws the light and dark facets from the humans' geometry, scaled to the radius", () => {
    render(<ConversationMap state={demo} flags={Y4} />);
    const n = byLabel('Sunday Service');
    const star = within(tile(n)).getByTestId('y4-star');
    expect(star).toHaveAttribute('data-palette', 'young');
    expect(within(tile(n)).getByTestId('y4-light')).toHaveAttribute('d', Y4_LIGHT);
    expect(within(tile(n)).getByTestId('y4-light')).toHaveAttribute('fill', PALETTES.young.light);
    expect(within(tile(n)).getByTestId('y4-dark')).toHaveAttribute('d', Y4_DARK);
    expect(within(tile(n)).getByTestId('y4-dark')).toHaveAttribute('fill', PALETTES.young.dark);
    expect(star.getAttribute('transform')).toContain(`scale(${topicRadius(n) / 24})`);
  });

  it('states: active = white core; provisional = 40 %; highlighted = gold hairline; selected = hairline', () => {
    const g = states();
    render(<ConversationMap state={g} focusNodeId="h" flags={Y4} />);
    const a = screen.getByTestId('map-node-a');
    expect(within(a).getByTestId('active-core')).toHaveAttribute('fill', '#FFFFFF');
    expect(within(screen.getByTestId('map-node-h')).queryByTestId('active-core')).toBeNull();
    expect(screen.getByTestId('map-node-p').style.opacity).toBe('0.4');
    const ring = within(screen.getByTestId('map-node-h')).getByTestId('highlight-ring');
    expect(ring).toHaveAttribute('stroke', 'var(--highlight)');
    expect(ring).toHaveAttribute('stroke-width', '1');
    // the deep-linked node is selected
    expect(within(screen.getByTestId('map-node-h')).getByTestId('selected-ring')).toHaveAttribute('stroke-width', '1');
    // nothing pulses
    expect(document.querySelector('.cmap-pulse, [data-testid="pulse"]')).toBeNull();
  });

  it('the merged-thread star still sizes by the summed duration', () => {
    const vg = visibleGraph(demo, 'balanced', { mergeReturns: true });
    const res = vg.nodes.find((v) => v.node.label === 'Resurrection Accounts')!;
    render(<ConversationMap state={demo} flags={Y4} />);
    expect(within(tile(res.node)).getByTestId('y4-star').getAttribute('transform')).toContain(
      `scale(${res.radius / 24})`,
    );
  });
});

describe('deferred threads', () => {
  it('unexplored = E2 ember: dashed shell r10 + small core, a different shape from a star', () => {
    render(<ConversationMap state={demo} flags={Y4} />);
    const soccer = tile(byLabel('Intramural Soccer', 'pending'));
    expect(soccer).toHaveAttribute('data-art', 'ember');
    const shell = within(soccer).getByTestId('ember-shell');
    expect(shell).toHaveAttribute('r', String(EMBER.radius));
    expect(shell).toHaveAttribute('stroke', EMBER.stroke);
    expect(shell).toHaveAttribute('stroke-dasharray', '2 3');
    expect(within(soccer).getByTestId('ember-core')).toHaveAttribute('r', String(EMBER.coreRadius));
    expect(within(soccer).queryByTestId('y4-star')).toBeNull();
    expect(visibleGraph(demo, 'balanced').nodes.find((v) => v.node.label === 'Intramural Soccer')!.radius).toBe(
      THREAD_RADIUS,
    );
  });

  it('picked up = rekindled Y4 star in orange, sized like other stars, with its tether and "picked up"', () => {
    const { container } = render(<ConversationMap state={demo} flags={Y4} />);
    const trip = byLabel('Summer Road Trip', 'pending');
    const t = tile(trip);
    expect(t).toHaveAttribute('data-art', 'rekindled');
    expect(within(t).getByTestId('y4-light')).toHaveAttribute('fill', PALETTES.rekindled.light);
    expect(within(t).getByTestId('y4-dark')).toHaveAttribute('fill', PALETTES.rekindled.dark);
    expect(within(t).getByText('picked up')).toBeInTheDocument();
    const tethers = [...container.querySelectorAll('.react-flow__edge')].filter((e) =>
      (e.getAttribute('aria-label') ?? '').startsWith('Thread Summer Road Trip'),
    );
    expect(tethers.length).toBeGreaterThan(0);
  });

  it('parked thoughts are hidden by default (flag), and come back with the flag', () => {
    const parked = byLabel('Ask About Internship', 'parked');
    const { unmount } = render(<ConversationMap state={demo} flags={Y4} />);
    expect(screen.queryByTestId(`map-node-${parked.id}`)).toBeNull();
    unmount();
    render(<ConversationMap state={demo} flags={{ ...Y4, parkedThoughts: true }} />);
    expect(tile(parked)).toHaveAttribute('data-art', 'ember');
  });
});

describe('motion and names', () => {
  it('colour shifts only, between two close colours; nothing animates under reduced motion', () => {
    const { unmount } = render(<ConversationMap state={demo} flags={Y4} />);
    const light = within(tile(byLabel('Sunday Service'))).getByTestId('y4-light');
    expect(light).toHaveClass('cmap-shift-fill');
    expect(light.style.getPropertyValue('--shift-from')).toBe(PALETTES.young.light);
    expect(light.style.getPropertyValue('--shift-to')).toBe(PALETTES.young.lightShift);
    expect(within(tile(byLabel('Intramural Soccer', 'pending'))).getByTestId('ember-core')).toHaveClass(
      'cmap-shift-fill',
    );
    unmount();
    usePrefs.getState().set({ reduceMotion: true });
    render(<ConversationMap state={demo} flags={Y4} />);
    expect(document.querySelector('.cmap-shift-fill')).toBeNull();
    usePrefs.getState().reset();
  });

  it('accessible names are unchanged and still start with the visible label', () => {
    render(<ConversationMap state={demo} flags={Y4} />);
    expect(wrapper(byLabel('Sunday Service')).getAttribute('aria-label')!.startsWith('Sunday Service,')).toBe(true);
    const trip = byLabel('Summer Road Trip', 'pending');
    expect(wrapper(trip).getAttribute('aria-label')!.startsWith('Summer Road Trip picked up,')).toBe(true);
    const soccer = byLabel('Intramural Soccer', 'pending');
    expect(wrapper(soccer).getAttribute('aria-label')).toContain('mentioned for later, not picked up');
  });
});

describe('banners use the star-chart frame', () => {
  it('path banner has no rounded corners or shadow', async () => {
    const { container } = render(<ConversationMap state={demo} flags={Y4} />);
    void container;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(tile(byLabel('Gospel Sources')));
    fireEvent.click(screen.getByRole('button', { name: 'How did we get here?' }));
    const banner = screen.getByTestId('path-banner');
    expect(banner).toHaveClass('cmap-chart');
    expect(banner.className).not.toMatch(/rounded|shadow/);
  });
});
