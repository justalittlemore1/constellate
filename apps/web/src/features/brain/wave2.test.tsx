import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockBrainFromGraphs, type BrainPayload } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { BrainCanvas } from './BrainCanvas';
import { nodeRadius, toGalaxy } from './brainLayout';
import {
  appearScale,
  coreColour,
  defaultRenderers,
  STAR_ART,
  starRenderers,
  type BrainRenderers,
  type LinkDraw,
  type NodeDraw,
} from './brainRenderers';
import { linkProgress } from './starReveal';

/** Records every call and property write on a canvas context. */
function recordingCtx() {
  const log: { kind: 'call' | 'set'; name: string; args: unknown[] }[] = [];
  const gradients: { stops: [number, string][] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, name) =>
        (...args: unknown[]) => {
          log.push({ kind: 'call', name: String(name), args });
          if (name === 'createLinearGradient' || name === 'createRadialGradient') {
            const g = { stops: [] as [number, string][], addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
            gradients.push(g);
            return g;
          }
          return undefined;
        },
      set: (_t, name, value) => {
        log.push({ kind: 'set', name: String(name), args: [value] });
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const calls = (name: string) => log.filter((e) => e.kind === 'call' && e.name === name);
  const sets = (name: string) => log.filter((e) => e.kind === 'set' && e.name === name).map((e) => e.args[0]);
  return { ctx, log, gradients, calls, sets };
}

function node(over: Partial<NodeDraw> = {}) {
  const rec = recordingCtx();
  const d: NodeDraw = {
    ctx: rec.ctx,
    x: 0,
    y: 0,
    radius: nodeRadius(1), // 9
    name: 'Faith vs Evidence',
    scale: 1,
    opacity: 1,
    dimmed: false,
    selected: false,
    showLabel: true,
    glow: 1,
    textSize: 1,
    now: 0,
    reduced: false,
    ...over,
    ...(over.ctx ? {} : { ctx: rec.ctx }),
  };
  starRenderers.drawNode(d);
  return rec;
}

function link(over: Partial<LinkDraw> = {}) {
  const rec = recordingCtx();
  starRenderers.drawLink({
    ctx: rec.ctx,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    relation: 'related',
    weight: 0.5,
    lit: false,
    opacity: 1,
    scale: 1,
    ...over,
  });
  return rec;
}

afterEach(() => vi.restoreAllMocks());

describe('Brain concept art — "O1: six diffraction spikes"', () => {
  it('draws a 1 px vertical spike and two 0.7 px diagonals in #DDEBFF with round caps', () => {
    const rec = node();
    expect(rec.sets('strokeStyle')[0]).toBe('#DDEBFF');
    expect(rec.sets('lineCap')).toContain('round');
    const widths = rec.sets('lineWidth');
    expect(widths.slice(0, 2)).toEqual([1, 0.7]);
    // three spikes: one vertical segment, two diagonal segments
    const moves = rec
      .calls('moveTo')
      .slice(0, 3)
      .map((c) => c.args);
    const ends = rec
      .calls('lineTo')
      .slice(0, 3)
      .map((c) => c.args);
    const spike = 9 * STAR_ART.spikeRatio;
    expect(moves[0]).toEqual([0, -spike]);
    expect(ends[0]).toEqual([0, spike]);
    expect(moves.slice(1).every(([x, y]) => Math.abs(Number(x)) === Math.abs(Number(y)))).toBe(true);
  });

  it('spike length scales with the node size (6 + 3·√mentions)', () => {
    const small = node({ radius: nodeRadius(1) }).calls('moveTo')[0]!.args[1];
    const big = node({ radius: nodeRadius(9) }).calls('moveTo')[0]!.args[1];
    expect(Math.abs(Number(big)) / Math.abs(Number(small))).toBeCloseTo(nodeRadius(9) / nodeRadius(1));
  });

  it('has a core of radius ≈ 9 (scaled) and a white centre dot', () => {
    const rec = node();
    const arcs = rec.calls('arc').map((c) => c.args[2]);
    expect(arcs[0]).toBe(9); // core = node radius at full size
    expect(arcs[1]).toBeCloseTo(9 * 0.4); // centre
    expect(rec.sets('fillStyle')).toContain('#fff');
  });

  it('shifts the core colour slowly between #DCE8FF and #E9E0FF, and holds it under reduced motion', () => {
    expect(coreColour(0, false)).toBe('rgb(220,232,255)'); // #DCE8FF
    expect(coreColour(STAR_ART.shiftMs / 2, false)).toBe('rgb(233,224,255)'); // #E9E0FF at half a loop
    expect(coreColour(STAR_ART.shiftMs, false)).toBe('rgb(220,232,255)'); // full loop
    expect(STAR_ART.shiftMs).toBeGreaterThanOrEqual(8000);
    expect(STAR_ART.shiftMs).toBeLessThanOrEqual(12000);
    expect(coreColour(STAR_ART.shiftMs / 2, true)).toBe(STAR_ART.coreA);
    expect(node({ now: STAR_ART.shiftMs / 2, reduced: true }).sets('fillStyle')[0]).toBe(STAR_ART.coreA);
  });

  it('scales in while it fades in (appearing state)', () => {
    expect(appearScale(0)).toBeCloseTo(0.4);
    expect(appearScale(1)).toBe(1);
    const rec = node({ opacity: 0.5 });
    expect(rec.calls('arc')[0]!.args[2]).toBeCloseTo(9 * appearScale(0.5));
    expect(rec.sets('globalAlpha')[0]).toBe(0.5);
  });

  it('dims non-neighbours when something is selected, and rings the selected star', () => {
    expect(node({ dimmed: true }).sets('globalAlpha')[0]).toBeCloseTo(0.15);
    const selected = node({ selected: true });
    expect(selected.sets('strokeStyle')).toContain('#FFD84D');
    expect(selected.calls('arc')).toHaveLength(3); // core, centre, ring
  });

  it('puts the label below the spike tip, and reports that reach for the layout', () => {
    const rec = node({ showLabel: true });
    const ty = Number(rec.calls('fillText')[0]!.args[2]);
    expect(ty).toBeGreaterThan(9 * STAR_ART.spikeRatio); // clear of the vertical spike
    expect(starRenderers.reach!(9)).toBe(9 * STAR_ART.spikeRatio);
  });

  it('labels in Cormorant Garamond', () => {
    const rec = node({ showLabel: true });
    expect(String(rec.sets('font')[0])).toContain('Cormorant Garamond');
    expect(rec.calls('fillText')[0]!.args[0]).toBe('Faith vs Evidence');
    expect(node({ showLabel: false }).calls('fillText')).toHaveLength(0);
  });
});

describe('Brain links: each relation keeps its own non-colour cue', () => {
  it('broader = a comet trail, bright at the broader concept and fading toward the narrower one', () => {
    const rec = link({ relation: 'broader' });
    expect(rec.calls('createLinearGradient')[0]!.args).toEqual([0, 0, 100, 0]); // from the broader end
    expect(rec.gradients[0]!.stops).toEqual([
      [0, 'rgba(221,235,255,0.95)'],
      [1, 'rgba(221,235,255,0)'],
    ]);
    expect(rec.calls('arc')).toHaveLength(0);
  });

  it('related = a thin solid constellation line (0.8 px)', () => {
    const rec = link({ relation: 'related' });
    expect(rec.sets('lineWidth')).toEqual([0.8]);
    expect(rec.calls('setLineDash')[0]!.args[0]).toEqual([]);
    expect(rec.calls('createLinearGradient')).toHaveLength(0);
    expect(rec.calls('lineTo')[0]!.args).toEqual([100, 0]);
  });

  it('co-discussed = sparse static stardust dots (identical every frame: no drifting)', () => {
    const a = link({ relation: 'co_discussed' });
    const b = link({ relation: 'co_discussed' });
    expect(a.calls('arc').length).toBeGreaterThan(5);
    expect(a.calls('lineTo')).toHaveLength(0);
    expect(a.calls('arc').map((c) => c.args)).toEqual(b.calls('arc').map((c) => c.args));
  });

  it('links draw in after the stars: nothing at progress 0, half the line at 0.5', () => {
    expect(link({ progress: 0 }).log).toHaveLength(0);
    expect(link({ relation: 'related', progress: 0.5 }).calls('lineTo')[0]!.args).toEqual([50, 0]);
    expect(linkProgress(null, 1000)).toBe(0);
    expect(linkProgress(0, 350)).toBeCloseTo(0.5);
  });

  it('the galaxy keeps the broader concept as the source of a broader link', () => {
    const payload: BrainPayload = {
      concepts: [
        {
          id: 'a-narrow',
          name: 'Resurrection Accounts',
          description: null,
          parentConceptId: 'z-broad',
          mentionCount: 1,
        },
        { id: 'z-broad', name: 'Historical Jesus', description: null, parentConceptId: null, mentionCount: 1 },
      ],
      links: [{ sourceId: 'z-broad', targetId: 'a-narrow', relation: 'broader', weight: 0.8 }],
      occurrences: {},
    };
    expect(toGalaxy(payload).links[0]).toMatchObject({ source: 'z-broad', target: 'a-narrow', relation: 'broader' });
  });
});

vi.mock('react-force-graph-2d', () => ({
  default: (props: {
    graphData: { nodes: { id: string; name: string; radius: number }[] };
    nodeCanvasObject?: (n: unknown, ctx: CanvasRenderingContext2D, scale: number) => void;
  }) => {
    for (const n of props.graphData.nodes) props.nodeCanvasObject?.({ ...n, x: 0, y: 0 }, recordingCtx().ctx, 1);
    return <div data-testid="force-graph" />;
  },
}));

describe('BrainCanvas with the star art', () => {
  it('uses the O1 star renderers by default and passes reduced motion to them', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    expect(defaultRenderers).toBe(starRenderers);
    const payload = mockBrainFromGraphs([loadDemoGraph()]);
    const renderers: BrainRenderers = { drawNode: vi.fn(), drawLink: vi.fn() };
    render(<BrainCanvas payload={payload} selectedId={null} onSelect={() => {}} reduced renderers={renderers} />);
    expect(vi.mocked(renderers.drawNode).mock.calls[0]![0]).toMatchObject({ reduced: true, opacity: 1 });
  });

  it('keeps an accessible name for the canvas picture', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    const payload = mockBrainFromGraphs([loadDemoGraph()]);
    const { getByRole } = render(<BrainCanvas payload={payload} selectedId={null} onSelect={() => {}} reduced />);
    expect(getByRole('img')).toHaveAccessibleName(/^Brain galaxy of 8 concepts\. Use the Text view/);
  });
});
