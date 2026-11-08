import { describe, expect, it } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { flowPath, REVISIT_MARGIN_X, revisitControlX, revisitPath, rimToRim } from './edges';
import { boxRadius, labelBlockHeight } from './flow';
import { visibleGraph } from './model';
import { ensureVisible, fitAll, fitWidth, followY, graphBounds, withLaneFrame } from './viewport';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('edge geometry', () => {
  it('flow edges leave below the source label and end on the rim of the target', () => {
    const d = flowPath({ x: 100, y: 0 }, { x: 240, y: 200 }, 20, 18, 30);
    const [mx, my, , , , , ex, ey] = nums(d);
    expect(d.startsWith('M')).toBe(true);
    expect([mx, my]).toEqual([100, 50]); // 0 + radius 20 + label gap 30
    expect([ex, ey]).toEqual([240, 200 - 18 - 3]);
  });

  it('with no room under a tall label, a lane change leaves from the side facing the target', () => {
    // Detailed: Historical Jesus (r 26.4) → Gospel Sources one row down, one lane right
    const d = flowPath({ x: 127, y: 96 }, { x: 289, y: 192 }, 26.4, 20.4, 41);
    const [ax, ay] = nums(d);
    expect([ax, ay]).toEqual([127 + 26.4, 96]); // right side of the circle, level with its centre
    expect(d.trim().endsWith(`289 ${192 - 20.4 - 3}`)).toBe(true);
  });

  it('with no room in the same lane, it is a short stub just above the target', () => {
    const d = flowPath({ x: 133, y: 672 }, { x: 124, y: 768 }, 20, 20, 56);
    const [ax, ay = NaN, bx, by = NaN] = nums(d);
    expect([ax, bx]).toEqual([124, 124]);
    expect(by).toBe(768 - 23);
    expect(by - ay).toBeGreaterThanOrEqual(8);
    expect(ay).toBeGreaterThan(672 + 20 + 5); // starts below the label's first line, not on the circle
  });

  it('revisit arcs swing out to the left margin, left of both endpoints', () => {
    const s = { x: 286, y: 576 };
    const t = { x: 269, y: 288 };
    const cx = revisitControlX(s, t);
    expect(cx).toBeLessThanOrEqual(REVISIT_MARGIN_X);
    expect(cx).toBeLessThan(Math.min(s.x, t.x) - 60);
    const d = revisitPath(s, t, 20, 22);
    const [ax, ay] = nums(d);
    expect([ax, ay]).toEqual([266, 576]); // leaves from the left of the newer node
    expect(d.trim().endsWith(`${269 - 22 - 3} 288`)).toBe(true); // arrives at the left of the earlier one
  });

  it('longer returns swing further out so nested arcs do not overlap', () => {
    const short = revisitControlX({ x: 140, y: 400 }, { x: 140, y: 300 });
    const long = revisitControlX({ x: 140, y: 900 }, { x: 140, y: 100 });
    expect(long).toBeLessThan(short);
  });

  it('tethers run rim to rim', () => {
    expect(nums(rimToRim({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20))).toEqual([0 + 10, 0, 100 - 20, 0]);
  });
});

describe('node boxes and labels', () => {
  it('every node hit box is at least 44 px', () => {
    expect(boxRadius(15) * 2).toBeGreaterThanOrEqual(44);
    expect(boxRadius(30) * 2).toBeGreaterThanOrEqual(30 * 2 + 16);
  });
  it('long labels take two lines', () => {
    expect(labelBlockHeight('Camus and Absurdism', false)).toBeGreaterThan(labelBlockHeight('Faith', false));
    expect(labelBlockHeight('Faith', true)).toBeGreaterThan(labelBlockHeight('Faith', false));
  });
});

describe('viewport', () => {
  const b = graphBounds(visibleGraph(loadDemoGraph(), 'balanced'))!;

  it('bounds include labels and the revisit arcs on the left', () => {
    expect(b.minX).toBeLessThan(100); // leftmost node is at x≈124; arcs go further left
    expect(b.maxX).toBeGreaterThan(466);
  });

  it('fitWidth fits the whole width of a 390 px phone and starts at the top', () => {
    const vp = fitWidth(b, 390, 60);
    expect(b.minX * vp.zoom + vp.x).toBeGreaterThanOrEqual(0);
    expect(b.maxX * vp.zoom + vp.x).toBeLessThanOrEqual(390);
    expect(b.minY * vp.zoom + vp.y).toBeCloseTo(68);
    expect(vp.zoom).toBeGreaterThan(0.5); // labels stay readable, no auto-Broad
  });

  it('fitAll shows everything inside the available height', () => {
    const vp = fitAll(b, 390, 700, 60, 24);
    expect(b.maxY * vp.zoom + vp.y).toBeLessThanOrEqual(700 - 24);
    expect(b.minY * vp.zoom + vp.y).toBeGreaterThanOrEqual(60);
  });

  it('followY puts a node at 62 % of the height without changing zoom or x', () => {
    const vp = followY({ x: 5, y: 0, zoom: 0.8 }, 500, 700);
    expect(500 * vp.zoom + vp.y).toBeCloseTo(434);
    expect(vp.x).toBe(5);
    expect(vp.zoom).toBe(0.8);
  });

  it('ensureVisible only moves when the point is off screen', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(ensureVisible(vp, { x: 200, y: 300 }, 390, 700)).toEqual(vp);
    const moved = ensureVisible(vp, { x: 200, y: 1200 }, 390, 700);
    expect(1200 + moved.y).toBeLessThanOrEqual(700);
  });

  it('live framing always spans the lanes and the thread gutter', () => {
    const tiny = { minX: 100, maxX: 200, minY: 0, maxY: 50 };
    const f = withLaneFrame(tiny);
    expect(f.minX).toBeLessThanOrEqual(20);
    expect(f.maxX).toBeGreaterThan(460);
  });
});
