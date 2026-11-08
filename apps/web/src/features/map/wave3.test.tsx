/**
 * Humans' map changes, wave 3: constellation lines, Y3 compass stars, square notes, bottom
 * detail sheet, no watermark, live framing, readable start size, hover wash.
 */
import type { GraphState, TopicNode } from '@constellate/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { EMBER, Y3_MAIN, Y3_PALETTES, Y3_SECONDARY } from './art';
import { ConversationMap } from './ConversationMap';
import { LINE_COLOUR, linePath, pathMidpoint } from './edges';
import { boxRadius } from './flow';
import { visibleGraph } from './model';
import { installFlowDomStubs } from './testing';
import {
  followY,
  graphBounds,
  LIVE_FOLLOW_FRAC,
  panAboveSheet,
  READABLE_ZOOM,
  readableViewport,
  SHEET_FRACTION,
  withLaneFrame,
} from './viewport';

beforeAll(() => installFlowDomStubs());

// vitest doesn't serve CSS as text, so read the stylesheet itself
const mapCss = readFileSync(join(__dirname, 'map.css'), 'utf8');

const demo = loadDemoGraph();
const byLabel = (label: string, kind: TopicNode['kind'] = 'topic', nth = 0): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label && n.kind === kind)
    .sort((a, b) => a.seq - b.seq)[nth]!;
const tile = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`);

describe('1. classic constellation lines', () => {
  it('flow edges are thin pale-gold lines with a midpoint chevron and no arrowhead', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const flows = [...container.querySelectorAll('g[data-kind="flow"]')];
    expect(flows.length).toBeGreaterThan(0);
    for (const g of flows) {
      expect(g).toHaveAttribute('data-style', 'line');
      const line = g.querySelector('[data-testid="constellation-line"]')!;
      expect(line).toHaveAttribute('stroke', LINE_COLOUR);
      expect(Number(line.getAttribute('stroke-width'))).toBeLessThanOrEqual(1);
      expect(line.getAttribute('marker-end')).toBeNull();
      expect(g.querySelector('[data-testid="chevron"]')).toBeTruthy();
    }
    expect(Number(flows[0]!.getAttribute('opacity'))).toBeCloseTo(0.8);
  });

  it('return loops keep their curve plus the chevron; tethers stay dotted with no chevron', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const loop = container.querySelector('g[data-route="return"]')!;
    expect(loop.querySelector('[data-testid="constellation-line"]')!.getAttribute('d')).toContain(' C ');
    expect(loop.querySelector('[data-testid="chevron"]')).toBeTruthy();
    const tether = container.querySelector('g[data-kind="tether"]')!;
    expect(tether.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('0.5 4');
    expect(tether.querySelector('[data-testid="chevron"]')).toBeNull();
  });

  it('keeps the spoken edge names', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const names = [...container.querySelectorAll('.react-flow__edge')].map((e) => e.getAttribute('aria-label'));
    expect(names).toContain('Moved on from Sunday Service to Historical Jesus');
    expect(names).toContain('Came back from Personal Doubts to Resurrection Accounts');
  });

  it('straight where possible; curved only when a straight line would cross the label', () => {
    // a lane change one row down clears the short label: straight
    expect(linePath({ x: 140, y: 0 }, { x: 280, y: 96 }, 20, 18, 26, false, 6)).toMatch(/^M [\d.-]+ [\d.-]+ L /);
    // straight down through a long label: curved route instead
    expect(linePath({ x: 140, y: 0 }, { x: 150, y: 200 }, 20, 18, 26, false, 20)).toContain(' C ');
  });

  it('the chevron sits at the midpoint and points source → target', () => {
    const line = pathMidpoint('M 0 0 L 100 0');
    expect(line).toEqual({ x: 50, y: 0, angle: 0 });
    const down = pathMidpoint('M 0 0 L 0 100');
    expect(down.angle).toBeCloseTo(90);
    const up = pathMidpoint('M 0 100 C 0 50, 0 50, 0 0');
    expect(up.y).toBeCloseTo(50);
    expect(up.angle).toBeCloseTo(-90);
  });

  it('the comet trails come back with the cometTrails flag', () => {
    const { container } = render(<ConversationMap state={demo} flags={{ cometTrails: true }} />);
    expect(container.querySelector('[data-testid="comet-trail"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chevron"]')).toBeNull();
  });
});

describe('2. Y3 eight-point compass stars', () => {
  it("draws the main star and the 45°-rotated secondary from the humans' geometry", () => {
    render(<ConversationMap state={demo} />);
    const t = tile(byLabel('Sunday Service'));
    expect(within(t).getByTestId('y3-star')).toHaveAttribute('data-palette', 'young');
    const main = within(t).getByTestId('y3-main');
    expect(main).toHaveAttribute('d', Y3_MAIN);
    expect(main).toHaveAttribute('fill', Y3_PALETTES.young.main);
    expect(main.style.getPropertyValue('--shift-to')).toBe(Y3_PALETTES.young.mainShift);
    const second = within(t).getByTestId('y3-secondary');
    expect(second).toHaveAttribute('d', Y3_SECONDARY);
    expect(second).toHaveAttribute('transform', 'rotate(45)');
    expect(second).toHaveAttribute('fill', Y3_PALETTES.young.secondary);
  });

  it('rekindled = the same Y3 in orange, still "picked up"; the ember is unchanged', () => {
    render(<ConversationMap state={demo} />);
    const trip = tile(byLabel('Summer Road Trip', 'pending'));
    expect(within(trip).getByTestId('y3-star')).toHaveAttribute('data-palette', 'rekindled');
    expect(within(trip).getByTestId('y3-main')).toHaveAttribute('fill', Y3_PALETTES.rekindled.main);
    expect(within(trip).getByTestId('y3-secondary')).toHaveAttribute('fill', Y3_PALETTES.rekindled.secondary);
    expect(within(trip).getByText('picked up')).toBeInTheDocument();
    const soccer = tile(byLabel('Intramural Soccer', 'pending'));
    expect(within(soccer).getByTestId('ember-shell')).toHaveAttribute('stroke', EMBER.stroke);
  });

  it('states unchanged (active core, highlight hairline); static under reduced motion', () => {
    const g: GraphState = { ...demo, activeNodeId: byLabel('Gospel Sources').id };
    const { unmount } = render(<ConversationMap state={g} live />);
    expect(within(tile(byLabel('Gospel Sources'))).getByTestId('active-core')).toBeInTheDocument();
    expect(within(tile(byLabel('Resurrection Accounts'))).getByTestId('highlight-ring')).toBeInTheDocument();
    unmount();
    usePrefs.getState().set({ reduceMotion: true });
    render(<ConversationMap state={g} live />);
    expect(document.querySelector('.cmap-shift-fill')).toBeNull();
    usePrefs.getState().reset();
  });
});

describe('3. square notes', () => {
  it('the sticky note on the canvas and the "Your notes" box have square corners', () => {
    render(<ConversationMap state={demo} onEdit={() => {}} />);
    expect(screen.getByTestId(`map-note-${demo.annotations[0]!.id}`).className).not.toMatch(/rounded/);
    fireEvent.click(tile(byLabel('Resurrection Accounts')));
    const sheet = screen.getByRole('dialog', { name: 'Resurrection Accounts' });
    const note = within(sheet).getByText('Look up the Q source hypothesis').closest('li')!;
    expect(note.className).not.toMatch(/rounded/);
  });
});

describe('4. detail sheet at the bottom', () => {
  it('caps the sheet at ~58 % and lightens the scrim so the map shows above it', () => {
    expect(mapCss).toMatch(/\[data-testid='node-detail-sheet'\]\s*\{\s*max-height:\s*58%/);
    expect(mapCss).toMatch(/\.sheet-scrim:has\(\+ \[data-testid='node-detail-sheet'\]\)/);
  });

  it('pans the selected star into the middle of the uncovered area above the sheet', () => {
    const map = { top: 60, height: 784, width: 390 };
    const frame = { top: 0, height: 844 };
    const vp = panAboveSheet({ x: 0, y: 0, zoom: 1.1 }, { x: 200, y: 900 }, map, frame);
    const sheetTop = frame.height * (1 - SHEET_FRACTION);
    const screenY = 900 * vp.zoom + vp.y + map.top;
    expect(screenY).toBeGreaterThan(map.top);
    expect(screenY).toBeLessThan(sheetTop);
    expect(screenY).toBeCloseTo((map.top + sheetTop) / 2, 0);
  });

  it('Escape closes it and focus goes back to the star', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} />);
    const node = tile(byLabel('Gospel Sources')).closest<HTMLElement>('.react-flow__node')!;
    act(() => node.focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Gospel Sources' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(node).toHaveFocus();
  });
});

describe('5. no watermark', () => {
  it('hides the React Flow attribution', () => {
    const { container } = render(<ConversationMap state={demo} />);
    expect(container.querySelector('.react-flow__attribution')).toBeNull();
  });
});

describe('6–7. live framing and a readable start', () => {
  const vg = visibleGraph(demo, 'balanced', { mergeReturns: true, hideParked: true });
  const bounds = graphBounds(vg)!;

  it('on a 375 px phone the default zoom makes labels ≥ 15 px and the smallest star ≥ 28 px', () => {
    for (const b of [bounds, withLaneFrame(bounds)]) {
      const vp = readableViewport(b, 375, 0);
      expect(vp.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
      expect(14 * vp.zoom).toBeGreaterThanOrEqual(15);
      const topics = vg.nodes.filter((v) => v.node.kind === 'topic');
      const smallest = Math.min(...topics.map((v) => v.radius));
      expect(2 * smallest * vp.zoom).toBeGreaterThanOrEqual(28);
      // taps stay ≥ 44 px
      expect(2 * boxRadius(smallest) * vp.zoom).toBeGreaterThanOrEqual(44);
      // the topic lanes (labels included) stay on screen; the gutter is a pan away
      const leftLabel = Math.min(...topics.map((v) => v.node.x)) - 68;
      expect(leftLabel * vp.zoom + vp.x).toBeGreaterThanOrEqual(0);
    }
    // long topics stay proportionally larger
    const r = vg.nodes.filter((v) => v.node.kind === 'topic').map((v) => [v.totalMs, v.radius] as const);
    const longest = r.reduce((a, b) => (b[0] > a[0] ? b : a));
    const shortest = r.reduce((a, b) => (b[0] < a[0] ? b : a));
    expect(longest[1]).toBeGreaterThan(shortest[1]);
  });

  it('live: the newest star (including the very first) sits ~38 % down from the top', () => {
    const h = 700;
    const first = byLabel('Sunday Service');
    const vp = followY(readableViewport(withLaneFrame(bounds), 375, 0), first.y, h, LIVE_FOLLOW_FRAC);
    const screenY = first.y * vp.zoom + vp.y;
    expect(screenY / h).toBeGreaterThanOrEqual(0.35);
    expect(screenY / h).toBeLessThanOrEqual(0.4);
    // and it is not pushed to the left edge
    expect(first.x * vp.zoom + vp.x).toBeGreaterThan(375 * 0.15);
  });
});

describe('8. hover / press wash', () => {
  it('map controls share the grey wash (A4 token with a ~7.5 % white fallback)', () => {
    render(<ConversationMap state={demo} onEdit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Paint topics gold (highlighter)' })).toHaveClass('cmap-control');
    expect(screen.getByRole('button', { name: 'Text view' })).toHaveClass('cmap-control');
    fireEvent.mouseEnter(tile(byLabel('Gospel Sources')).closest('.react-flow__node')!);
    expect(screen.getByRole('button', { name: 'Open details for Gospel Sources' })).toHaveClass('cmap-control');
    expect(mapCss).toMatch(/\.cmap-control:hover[\s\S]*var\(--hover-wash, rgb\(255 255 255 \/ 0\.075\)\)/);
  });
});
