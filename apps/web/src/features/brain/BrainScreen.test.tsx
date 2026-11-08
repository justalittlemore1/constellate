import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_UI_FLAGS_ON, setUiFlags } from '../../lib/uiFlags';
import { createMockApi, mockBrainFromGraphs, type BrainPayload } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { renderApp } from '../../test/render';
import {
  footprint,
  linkDistance,
  neighbours,
  nodeRadius,
  aspectPull,
  pullToCentreLine,
  separateFootprints,
  toGalaxy,
  topConceptIds,
  type Body,
} from './brainLayout';
import { BrainScreen } from './BrainScreen';

// The canvas needs a real browser; stand in with one button per node so selection can be tested.
vi.mock('react-force-graph-2d', () => ({
  default: (props: {
    graphData: { nodes: { id: string; name: string; radius: number }[]; links: unknown[] };
    onNodeClick: (n: { id: string }) => void;
  }) => (
    <div data-testid="force-graph" data-links={props.graphData.links.length}>
      {props.graphData.nodes.map((n) => (
        <button key={n.id} type="button" data-radius={n.radius} onClick={() => props.onNodeClick(n)}>
          node {n.name}
        </button>
      ))}
    </div>
  ),
}));

const demo = loadDemoGraph();
const fixturePayload: BrainPayload = mockBrainFromGraphs([demo]);

async function builtApi() {
  const api = createMockApi();
  await api.rebuildBrain();
  return api;
}

describe('Brain view with every flag on (search, Galaxy/List toggle, header regenerate)', () => {
  beforeEach(() => setUiFlags(ALL_UI_FLAGS_ON));

  it('renders the fixture payload in the galaxy with radius from mention count', async () => {
    // jsdom has no layout: give the canvas container a size
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    renderApp({ route: '/brain', api: await builtApi(), element: <BrainScreen /> });

    const graph = await screen.findByTestId('force-graph');
    expect(screen.getByRole('img', { name: /^Brain galaxy of 8 concepts\. Use the Text view/ })).toBe(
      screen.getByTestId('brain-canvas'),
    );
    expect(within(graph).getAllByRole('button')).toHaveLength(fixturePayload.concepts.length);
    const faith = fixturePayload.concepts.find((c) => c.name === 'Faith vs Evidence')!;
    expect(faith.mentionCount).toBe(2);
    expect(within(graph).getByRole('button', { name: 'node Faith vs Evidence' })).toHaveAttribute(
      'data-radius',
      String(nodeRadius(2)),
    );

    // tapping a node opens its concept sheet
    await userEvent.click(within(graph).getByRole('button', { name: 'node Faith vs Evidence' }));
    expect(screen.getByRole('dialog', { name: 'Faith vs Evidence' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('opens a concept sheet by keyboard from the list view, with occurrences, play and map links', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/brain', api: await builtApi(), element: <BrainScreen /> });
    await user.click(await screen.findByRole('button', { name: 'List' }));
    const list = screen.getByRole('region', { name: 'All concepts' });

    // keyboard only: focus the first concept (most mentioned first) and press Enter
    const first = within(list).getAllByRole('button')[0]!;
    first.focus();
    expect(first).toHaveTextContent('2 mentions');
    await user.keyboard('{Enter}');

    const sheet = screen.getByRole('dialog');
    const name = sheet.getAttribute('aria-labelledby');
    const concept = fixturePayload.concepts.find((c) => c.name === document.getElementById(name!)!.textContent)!;
    expect(concept.mentionCount).toBe(2);
    expect(within(sheet).getByText(/Mentioned 2 times across 1 conversation/)).toBeInTheDocument();

    const occurrences = within(sheet).getByRole('region', { name: 'Where it came up' });
    expect(within(occurrences).getAllByRole('listitem')).toHaveLength(2);
    expect(within(occurrences).getAllByRole('button', { name: /^Play / })).toHaveLength(2);
    const occ = fixturePayload.occurrences[concept.id]![0]!;
    expect(within(occurrences).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      `/c/${demo.conversation.id}?node=${occ.nodeId}&t=${occ.startMs}`,
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(first).toHaveFocus();
  });

  it('jumps between connected concepts from the sheet', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/brain', api: await builtApi(), element: <BrainScreen /> });
    await user.click(await screen.findByRole('button', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: /^Historical Jesus/ }));
    const connected = within(screen.getByRole('dialog')).getByRole('region', { name: 'Connected concepts' });
    await user.click(within(connected).getByRole('button', { name: /Gospel Sources/ }));
    expect(screen.getByRole('dialog', { name: 'Gospel Sources' })).toBeInTheDocument();
  });

  it('shows participants of each occurrence', async () => {
    const api = await builtApi();
    await api.addParticipant(demo.conversation.id, 'Sam');
    const user = userEvent.setup();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    await user.click(await screen.findByRole('button', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: /^Camus and Absurdism/ }));
    expect(await within(screen.getByRole('dialog')).findByText('With Sam')).toBeInTheDocument();
  });

  it('searches concepts and opens a result', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/brain', api: await builtApi(), element: <BrainScreen /> });
    await user.type(await screen.findByRole('searchbox', { name: 'Search concepts' }), 'camus{Enter}');
    const results = await screen.findByRole('list', { name: 'Results for camus' });
    await user.click(within(results).getByRole('button', { name: 'Camus and Absurdism' }));
    expect(screen.getByRole('dialog', { name: 'Camus and Absurdism' })).toBeInTheDocument();
  });

  it('empty Brain offers Generate, which rebuilds and shows the result', async () => {
    const api = createMockApi();
    const spy = vi.spyOn(api, 'rebuildBrain');
    const user = userEvent.setup();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    expect(await screen.findByRole('heading', { name: 'Your Brain is empty' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Generate Brain' }).at(-1)!);
    expect(spy).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Added 1 conversation/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Your Brain is empty' })).not.toBeInTheDocument());
  });

  it('the library’s Generate Brain button starts a rebuild on arrival', async () => {
    const api = createMockApi();
    const spy = vi.spyOn(api, 'rebuildBrain');
    const user = userEvent.setup();
    renderApp({ api });
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('button', { name: 'Generate Brain' }));
    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'List' })).toBeInTheDocument();
  });
});

describe('Brain layout maths', () => {
  it('follows the plan formulas', () => {
    expect(nodeRadius(0)).toBe(6);
    expect(nodeRadius(4)).toBe(12);
    expect(linkDistance(1)).toBe(40);
    expect(linkDistance(0)).toBe(200);
    expect(linkDistance(0.5)).toBe(120);
    expect(linkDistance(7)).toBe(40);
  });

  it('labels the 15 largest concepts and merges parallel links', () => {
    const concepts = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      description: null,
      parentConceptId: null,
      mentionCount: i,
    }));
    const top = topConceptIds(concepts);
    expect(top.size).toBe(15);
    expect(top.has('c19')).toBe(true);
    expect(top.has('c4')).toBe(false);

    const payload: BrainPayload = {
      concepts: concepts.slice(0, 3),
      links: [
        { sourceId: 'c0', targetId: 'c1', relation: 'co_discussed', weight: 0.3 },
        { sourceId: 'c1', targetId: 'c0', relation: 'related', weight: 0.7 },
        { sourceId: 'c1', targetId: 'c2', relation: 'broader', weight: 0.5 },
        { sourceId: 'c1', targetId: 'gone', relation: 'related', weight: 0.9 },
      ],
      occurrences: {},
    };
    const g = toGalaxy(payload);
    expect(g.links).toEqual([
      { source: 'c0', target: 'c1', weight: 0.7, relation: 'related' },
      { source: 'c1', target: 'c2', weight: 0.5, relation: 'broader' },
    ]);
    expect([...neighbours(payload, 'c1')].sort()).toEqual(['c0', 'c2', 'gone']);
  });
});

describe('label collision', () => {
  const settle = (nodes: Body[], fp: Parameters<typeof separateFootprints>[1]) => {
    for (let i = 0; i < 200; i++) {
      for (const n of nodes) n.vx = n.vy = 0;
      separateFootprints(nodes, fp, 0.5);
      for (const n of nodes) {
        n.x = (n.x ?? 0) + (n.vx ?? 0);
        n.y = (n.y ?? 0) + (n.vy ?? 0);
      }
    }
  };

  it('a labelled footprint covers the node and the label below it', () => {
    expect(footprint(10, null, 4)).toEqual({ hw: 14, up: 14, down: 14 });
    const f = footprint(10, 80, 4);
    expect(f.hw).toBe(44); // half the label, wider than the node
    expect(f.down).toBeGreaterThan(f.up); // room for the label underneath
  });

  it('pushes overlapping labels apart until their boxes no longer overlap', () => {
    const fp = () => footprint(8, 90);
    // two labelled concepts side by side, labels overlapping
    const nodes: Body[] = [
      { x: 0, y: 0 },
      { x: 30, y: 2 },
    ];
    settle(nodes, fp);
    const f = fp();
    const [a, b] = nodes as [Required<Body>, Required<Body>];
    const overlapX = 2 * f.hw - Math.abs(b.x - a.x);
    const overlapY = f.up + f.down - Math.abs(b.y - a.y);
    expect(overlapX <= 0.5 || overlapY <= 0.5).toBe(true);
  });

  it('a label below one node does not sit on the node underneath it', () => {
    const fp = () => footprint(8, 60);
    const nodes: Body[] = [
      { x: 0, y: 0 },
      { x: 0, y: 20 }, // inside the first node's label area
    ];
    settle(nodes, fp);
    const f = fp();
    expect(Math.abs((nodes[1]!.y ?? 0) - (nodes[0]!.y ?? 0))).toBeGreaterThanOrEqual(f.up + f.down - 0.5);
  });

  it('leaves concepts that do not overlap alone', () => {
    const nodes: Body[] = [
      { x: 0, y: 0, vx: 0, vy: 0 },
      { x: 500, y: 500, vx: 0, vy: 0 },
    ];
    separateFootprints(nodes, () => footprint(8, 60), 1);
    expect(nodes.map((n) => [n.vx, n.vy])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});

describe('portrait shaping', () => {
  it('pulls towards the centre line only on tall canvases, more the taller they are', () => {
    expect(aspectPull(400, 300)).toBe(0); // landscape: no pull
    expect(aspectPull(390, 640)).toBeGreaterThan(0);
    expect(aspectPull(390, 800)).toBeGreaterThan(aspectPull(390, 640));
    expect(aspectPull(100, 2000)).toBe(0.12); // capped
    const nodes: Body[] = [
      { x: 100, y: 5, vx: 0, vy: 0 },
      { x: -50, y: 5, vx: 0, vy: 0 },
    ];
    pullToCentreLine(nodes, 0.1, 1);
    expect(nodes.map((n) => [n.vx, n.vy])).toEqual([
      [-10, 0],
      [5, 0],
    ]);
  });
});
