/**
 * Viewport maths for the map (pure). The map never moves nodes; it only chooses where to look.
 */
import { GUTTER_X, LANE_WIDTH, type TopicNode } from '@constellate/shared';
import { revisitControlX } from './edges';
import type { VisibleGraph } from './model';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** half a label's width: labels are 136 px wide and centred under the node */
const LABEL_HALF = 72;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;

/** Everything drawn, including labels and the revisit arcs that swing out to the left. */
export function graphBounds(g: VisibleGraph): Bounds | null {
  if (!g.nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const byId = new Map<string, TopicNode>(g.nodes.map((v) => [v.node.id, v.node]));
  for (const v of g.nodes) {
    minX = Math.min(minX, v.node.x - LABEL_HALF);
    maxX = Math.max(maxX, v.node.x + LABEL_HALF);
    minY = Math.min(minY, v.node.y - v.radius - 14);
    maxY = Math.max(maxY, v.node.y + v.radius + 40);
  }
  for (const e of g.edges) {
    if (e.kind !== 'revisit') continue;
    const s = byId.get(e.sourceId);
    const t = byId.get(e.targetId);
    if (!s || !t) continue;
    const cx = revisitControlX(s, t);
    // leftmost point of a cubic whose two control points share x = cx: ≈ (a + 6·cx + b) / 8
    minX = Math.min(minX, (s.x + t.x + 6 * cx) / 8 - 8);
  }
  for (const a of g.notes) {
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x + 148);
    maxY = Math.max(maxY, a.y + 60);
  }
  return { minX, minY, maxX, maxY };
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Phone default: the whole width fits (labels stay readable), starting at the top.
 * `top` is the inset taken by the floating toolbar.
 */
export function fitWidth(b: Bounds, w: number, top = 0, maxZoom = 1.2, minZoom = MIN_ZOOM): Viewport {
  const bw = b.maxX - b.minX;
  const zoom = clampZoom(Math.max(minZoom, Math.min(maxZoom, (w - 16) / bw)));
  return { zoom, x: (w - bw * zoom) / 2 - b.minX * zoom, y: top + 8 - b.minY * zoom };
}

/** Overview: everything visible at once (the Fit button and double-tap on empty space). */
export function fitAll(b: Bounds, w: number, h: number, top = 0, bottom = 0): Viewport {
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const availH = Math.max(80, h - top - bottom - 16);
  const zoom = clampZoom(Math.min(1.2, (w - 16) / bw, availH / bh));
  return {
    zoom,
    x: (w - bw * zoom) / 2 - b.minX * zoom,
    y: top + 8 + (availH - bh * zoom) / 2 - b.minY * zoom,
  };
}

/**
 * Default zoom floor so the map starts readable on a phone: labels (14 px) render at ≥ 15 px and
 * the smallest topic star (level 2, radius 13.6) at ≥ 28 px across; taps stay ≥ 44 px.
 */
export const READABLE_ZOOM = 1.1;
/** x between the first two topic lanes (140 and 280): kept centred when the map is wider than the screen */
export const LANE_CENTRE_X = 1.5 * LANE_WIDTH;

/**
 * The default frame: fit the width if that is readable; otherwise zoom to READABLE_ZOOM, keep the
 * topic lanes centred and start at the top (the thread gutter and return loops are a pan away).
 */
export function readableViewport(b: Bounds, w: number, top = 0, minZoom = READABLE_ZOOM): Viewport {
  const fit = fitWidth(b, w, top);
  if (fit.zoom >= minZoom) return fit;
  return { zoom: minZoom, x: w / 2 - LANE_CENTRE_X * minZoom, y: top + 8 - b.minY * minZoom };
}

/** Live map: where the newest star sits, as a fraction of the height from the top. */
export const LIVE_FOLLOW_FRAC = 0.38;

/** Fraction of the screen the bottom detail sheet may cover (see map.css). */
export const SHEET_FRACTION = 0.58;

/**
 * With the detail sheet open at the bottom, scroll so `p` sits in the middle of the map area that
 * is still uncovered above the sheet (keeping zoom; x only moves if the star is off-screen).
 * Rects are screen rects of the map container and of the phone / window.
 */
export function panAboveSheet(
  vp: Viewport,
  p: { x: number; y: number },
  map: { top: number; height: number; width: number },
  frame: { top: number; height: number },
  fraction = SHEET_FRACTION,
): Viewport {
  const sheetTop = frame.top + frame.height * (1 - fraction);
  const visible = Math.max(80, Math.min(map.height, sheetTop - map.top));
  const y = Math.max(40, visible / 2) - p.y * vp.zoom;
  const sx = p.x * vp.zoom + vp.x;
  const margin = 60;
  let x = vp.x;
  if (sx < margin) x += margin - sx;
  else if (sx > map.width - margin) x -= sx - (map.width - margin);
  return { ...vp, x, y };
}

/** Keep x and zoom; scroll so that `y` sits at `frac` of the height (follow the newest node). */
export function followY(vp: Viewport, y: number, h: number, frac = 0.62): Viewport {
  return { ...vp, y: h * frac - y * vp.zoom };
}

/** Bring a point into view only if it is outside the visible area (keyboard focus). */
export function ensureVisible(
  vp: Viewport,
  p: { x: number; y: number },
  w: number,
  h: number,
  margin = 60,
  top = 0,
): Viewport {
  const sx = p.x * vp.zoom + vp.x;
  const sy = p.y * vp.zoom + vp.y;
  let { x, y } = vp;
  if (sx < margin) x += margin - sx;
  else if (sx > w - margin) x -= sx - (w - margin);
  if (sy < top + margin) y += top + margin - sy;
  else if (sy > h - margin * 2) y -= sy - (h - margin * 2);
  return { ...vp, x, y };
}

/** Bounds widened to the whole lane frame: the left margin (revisit arcs) to the thread gutter. */
export function withLaneFrame(b: Bounds): Bounds {
  return { ...b, minX: Math.min(b.minX, 20), maxX: Math.max(b.maxX, GUTTER_X + 64) };
}
