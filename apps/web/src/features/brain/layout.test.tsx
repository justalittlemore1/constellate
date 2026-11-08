import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockBrainFromGraphs, type BrainPayload } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { BrainCanvas } from './BrainCanvas';
import {
  footprintsOverlap,
  layoutGalaxy,
  linkDistance,
  spreadLinkDistance,
  topConceptIds,
  type GalaxyNode,
} from './brainLayout';
import { LABEL_PX, starRenderers } from './brainRenderers';

let captured: { nodes: (GalaxyNode & { x?: number; y?: number; fx?: number; fy?: number })[] } | null = null;
vi.mock('react-force-graph-2d', () => ({
  default: (props: { graphData: typeof captured }) => {
    captured = props.graphData;
    return <div data-testid="force-graph" />;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  captured = null;
});

const payload = mockBrainFromGraphs([loadDemoGraph()]);
const labelled = topConceptIds(payload.concepts);
/** label width: 0.6 em per character of 15 px Fraunces — measured in a browser the widest fixture
 *  label is 0.576 em/char ("Summer Road Trip"), so this errs on the wide side */
const labelWidth = (n: GalaxyNode) => (labelled.has(n.id) ? n.name.length * LABEL_PX * 0.6 : null);
const reach = (r: number) => starRenderers.reach!(r);

/** canvas area of the Brain page on each phone (header, hint and Generate taken off) */
const PHONES = [
  { name: '375 px', width: 375, height: 540 },
  { name: '430 px', width: 430, height: 700 },
];

function assertNoOverlaps(p: BrainPayload, width: number, height: number) {
  const { positions, footprints } = layoutGalaxy(p, {
    width,
    height,
    reach,
    labelWidth: (n) => (labelled.has(n.id) || p !== payload ? n.name.length * LABEL_PX * 0.6 : null),
  });
  const ids = [...positions.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i]!, ids[j]!];
      expect(
        footprintsOverlap(positions.get(a)!, footprints.get(a)!, positions.get(b)!, footprints.get(b)!),
        `${a} and ${b} overlap`,
      ).toBe(false);
    }
  }
  return { positions, footprints };
}

describe('Brain layout: spread out, no overlaps', () => {
  for (const phone of PHONES) {
    it(`no two concept stars or labels overlap in the fixture Brain at ${phone.name}`, () => {
      assertNoOverlaps(payload, phone.width, phone.height);
    });

    it(`uses the screen at ${phone.name}: fits the canvas at zoom 1 and fills most of it`, () => {
      const { positions, footprints } = layoutGalaxy(payload, {
        width: phone.width,
        height: phone.height,
        reach,
        labelWidth,
      });
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [id, p] of positions) {
        const f = footprints.get(id)!;
        minX = Math.min(minX, p.x - f.hw);
        maxX = Math.max(maxX, p.x + f.hw);
        minY = Math.min(minY, p.y - f.up);
        maxY = Math.max(maxY, p.y + f.down);
      }
      const w = maxX - minX;
      const h = maxY - minY;
      expect(w).toBeLessThanOrEqual(phone.width); // fits without zooming out (labels stay full size)
      expect(h).toBeLessThanOrEqual(phone.height);
      expect(Math.max(w / phone.width, h / phone.height)).toBeGreaterThan(0.8); // not a small cluster in the middle
    });
  }

  for (const phone of PHONES) {
    it(`the fitted view keeps every star and label on screen at ${phone.name} (zoom 1–2)`, () => {
      const { positions, footprints, view } = layoutGalaxy(payload, {
        width: phone.width,
        height: phone.height,
        reach,
        labelWidth,
      });
      expect(view.zoom).toBeGreaterThanOrEqual(1);
      expect(view.zoom).toBeLessThanOrEqual(2);
      for (const [id, p] of positions) {
        const f = footprints.get(id)!;
        // boxes scaled by the zoom (conservative: labels are drawn at a constant screen size)
        expect((Math.abs(p.x - view.cx) + f.hw) * view.zoom).toBeLessThanOrEqual(phone.width / 2);
        expect((p.y - view.cy + f.down) * view.zoom).toBeLessThanOrEqual(phone.height / 2);
        expect((view.cy - p.y + f.up) * view.zoom).toBeLessThanOrEqual(phone.height / 2);
      }
    });
  }

  it('is much more spread out than before: longer links and wide spacing between stars', () => {
    expect(spreadLinkDistance(0.5)).toBeGreaterThan(linkDistance(0.5) * 1.4);
    const { positions } = layoutGalaxy(payload, { width: 375, height: 600, reach, labelWidth });
    const pts = [...positions.values()];
    let nearest = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        nearest = Math.min(nearest, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
    expect(nearest).toBeGreaterThan(40); // no two star centres closer than 40 px
  });

  it('is deterministic (the same sky on every visit, so the reveal looks the same)', () => {
    const a = layoutGalaxy(payload, { width: 375, height: 600, reach, labelWidth }).positions;
    const b = layoutGalaxy(payload, { width: 375, height: 600, reach, labelWidth }).positions;
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('keeps a larger Brain free of overlaps too', () => {
    const concepts = Array.from({ length: 24 }, (_, i) => ({
      id: `c${String(i).padStart(2, '0')}`,
      name: ['Free Will', 'Stoicism', 'Career Change', 'Running', 'Grief', 'Music Theory'][i % 6]! + ` ${i}`,
      description: null,
      parentConceptId: null,
      mentionCount: 1 + (i % 4),
    }));
    const links = concepts.slice(1).map((c, i) => ({
      sourceId: concepts[i]!.id,
      targetId: c.id,
      relation: 'co_discussed' as const,
      weight: 0.4,
    }));
    assertNoOverlaps({ concepts, links, occurrences: {} }, 430, 720);
  });
});

describe('BrainCanvas pins the laid-out positions', () => {
  it('passes every node to force-graph fixed at its layout position', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(375);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    render(<BrainCanvas payload={payload} selectedId={null} onSelect={() => {}} reduced />);
    expect(captured!.nodes).toHaveLength(payload.concepts.length);
    for (const n of captured!.nodes) {
      expect(n.fx).toBe(n.x);
      expect(n.fy).toBe(n.y);
      expect(Number.isFinite(n.fx)).toBe(true);
    }
  });
});
