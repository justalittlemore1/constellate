import type { BrainPayload, Concept, ConceptRelation } from '../../lib/api';

/** PLAN → The Brain → View: node radius 6 + 3·√mentionCount. */
export function nodeRadius(mentionCount: number): number {
  return 6 + 3 * Math.sqrt(Math.max(0, mentionCount));
}

/** PLAN → The Brain → View: link distance 40 + 160·(1 − w), w clamped to [0, 1]. */
export function linkDistance(weight: number): number {
  const w = Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0));
  return 40 + 160 * (1 - w);
}

export const LABELLED_CONCEPTS = 15;

/** Ids of the `n` most-mentioned concepts (ties broken by name, so it's stable). */
export function topConceptIds(concepts: Concept[], n = LABELLED_CONCEPTS): Set<string> {
  return new Set(
    [...concepts]
      .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((c) => c.id),
  );
}

export interface GalaxyNode {
  id: string;
  name: string;
  mentionCount: number;
  radius: number;
}

export interface GalaxyLink {
  source: string;
  target: string;
  /** strongest weight between the pair, drives the link distance */
  weight: number;
  /** strongest explicit relation: broader > related > co_discussed (comet trail / line / stardust);
   *  for `broader`, `source` is the broader concept */
  relation: ConceptRelation;
}

const RELATION_RANK: Record<ConceptRelation, number> = { broader: 3, related: 2, co_discussed: 1 };

/** One undirected link per concept pair (several relations may connect the same two concepts). */
export function toGalaxy(payload: BrainPayload): { nodes: GalaxyNode[]; links: GalaxyLink[] } {
  const ids = new Set(payload.concepts.map((c) => c.id));
  const nodes = payload.concepts.map((c) => ({
    id: c.id,
    name: c.name,
    mentionCount: c.mentionCount,
    radius: nodeRadius(c.mentionCount),
  }));
  const pairs = new Map<string, GalaxyLink>();
  const broaderOf = new Map<string, string>(); // pair key → the broader concept's id
  for (const l of payload.links) {
    if (!ids.has(l.sourceId) || !ids.has(l.targetId) || l.sourceId === l.targetId) continue;
    const [a, b] = [l.sourceId, l.targetId].sort() as [string, string];
    const key = `${a}|${b}`;
    if (l.relation === 'broader') broaderOf.set(key, l.sourceId); // server/mock: source is the broader
    const prev = pairs.get(key);
    if (!prev) {
      pairs.set(key, { source: a, target: b, weight: l.weight, relation: l.relation });
    } else {
      prev.weight = Math.max(prev.weight, l.weight);
      if (RELATION_RANK[l.relation] > RELATION_RANK[prev.relation]) prev.relation = l.relation;
    }
  }
  // a broader link runs from the broader concept, so its comet trail starts bright there
  for (const [key, link] of pairs) {
    const broader = broaderOf.get(key);
    if (link.relation === 'broader' && broader && link.source !== broader) {
      [link.source, link.target] = [link.target, link.source];
    }
  }
  return { nodes, links: [...pairs.values()] };
}

/** Concept ids directly linked to `id` (not including `id`). */
export function neighbours(payload: BrainPayload, id: string): Set<string> {
  const out = new Set<string>();
  for (const l of payload.links) {
    if (l.sourceId === id) out.add(l.targetId);
    if (l.targetId === id) out.add(l.sourceId);
  }
  out.delete(id);
  return out;
}

export const RELATION_WORDS: Record<ConceptRelation, string> = {
  broader: 'broader or narrower',
  related: 'related in meaning',
  co_discussed: 'discussed together',
};

/** Line pattern per relation, so relations never depend on colour alone. */
export const RELATION_DASH: Record<ConceptRelation, number[] | null> = {
  broader: null,
  related: [6, 4],
  co_discussed: [1.5, 3.5],
};

/** Space a concept takes on the canvas: the node plus (if labelled) its label underneath. */
export interface Footprint {
  /** half the width */
  hw: number;
  /** extent above / below the node centre */
  up: number;
  down: number;
}

export const LABEL_GAP = 3;
/** one line of 15 px Fraunces, with its ascenders and descenders */
export const LABEL_LINE = 20;

export function footprint(radius: number, labelWidth: number | null, pad = 4): Footprint {
  if (labelWidth === null) return { hw: radius + pad, up: radius + pad, down: radius + pad };
  return {
    hw: Math.max(radius, labelWidth / 2) + pad,
    up: radius + pad,
    down: radius + LABEL_GAP + LABEL_LINE + pad,
  };
}

export interface Body {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/**
 * One step of box collision: every overlapping pair is nudged apart along the axis of least
 * overlap (by velocity, like d3's forceCollide), so labels stop sitting on nodes and on each other.
 * O(n²) — fine for a personal Brain of a few hundred concepts.
 */
export function separateFootprints<T extends Body>(nodes: T[], fp: (n: T) => Footprint, strength: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const fa = fp(a);
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      const fb = fp(b);
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const bx = b.x ?? 0;
      const by = b.y ?? 0;
      const overlapX = Math.min(ax + fa.hw, bx + fb.hw) - Math.max(ax - fa.hw, bx - fb.hw);
      const overlapY = Math.min(ay + fa.down, by + fb.down) - Math.max(ay - fa.up, by - fb.up);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX < overlapY) {
        const s = (bx > ax || (bx === ax && j % 2 === 0) ? 1 : -1) * (overlapX / 2) * strength;
        a.vx = (a.vx ?? 0) - s;
        b.vx = (b.vx ?? 0) + s;
      } else {
        const ca = ay + (fa.down - fa.up) / 2;
        const cb = by + (fb.down - fb.up) / 2;
        const s = (cb > ca || (cb === ca && j % 2 === 0) ? 1 : -1) * (overlapY / 2) * strength;
        a.vy = (a.vy ?? 0) - s;
        b.vy = (b.vy ?? 0) + s;
      }
    }
  }
}

/**
 * Pull towards the vertical centre line, stronger the taller the canvas is than wide, so the
 * galaxy takes the shape of a portrait phone screen and the fit can zoom in instead of leaving
 * a wide, short strip in the middle.
 */
export function aspectPull(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return Math.min(0.12, Math.max(0, 0.06 * (height / width - 1)));
}

export function pullToCentreLine<T extends Body>(nodes: T[], k: number, alpha: number): void {
  for (const n of nodes) n.vx = (n.vx ?? 0) - (n.x ?? 0) * k * alpha;
}

// ── round 5: a spread-out, deterministic layout ──────────────────────────────────────────────
// force-graph's live simulation left the Brain cramped and different on every visit. The galaxy is
// now laid out here, once per payload and canvas size (same input → same sky, so the reveal always
// looks the same), and the nodes are pinned. Stronger many-body repulsion, longer links, and a
// collision box covering each star *and* its label; then scaled up to use the screen.

export interface Point {
  x: number;
  y: number;
}

/** Spread-out link length (was 40 + 160·(1 − w)): longer, still shorter for stronger links. */
export function spreadLinkDistance(weight: number): number {
  return 70 + 220 * (1 - Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0)));
}

export const LAYOUT = {
  iterations: 320,
  /** many-body repulsion (∝ 1/d²); force-graph's default charge was −30, then −60 */
  repulsion: 14_000,
  spring: 0.06,
  gravity: 0.012,
  /** padding around each star + label box, so neighbours never touch (≥ 10 px between boxes) */
  pad: 5,
  /** free space kept at the canvas edges when scaling up to fill it */
  margin: 10,
} as const;

/** Do two footprints (centred on a and b) overlap? */
export function footprintsOverlap(a: Point, fa: Footprint, b: Point, fb: Footprint): boolean {
  const ox = Math.min(a.x + fa.hw, b.x + fb.hw) - Math.max(a.x - fa.hw, b.x - fb.hw);
  const oy = Math.min(a.y + fa.down, b.y + fb.down) - Math.max(a.y - fa.up, b.y - fb.up);
  return ox > 0 && oy > 0;
}

/** Move overlapping pairs apart along the axis of least overlap; returns whether any overlapped. */
function resolveOverlaps(
  ids: string[],
  pos: Map<string, Point>,
  fp: Map<string, Footprint>,
  strength: number,
  verticalOnly = false,
): boolean {
  let any = false;
  for (let i = 0; i < ids.length; i++) {
    const a = pos.get(ids[i]!)!;
    const fa = fp.get(ids[i]!)!;
    for (let j = i + 1; j < ids.length; j++) {
      const b = pos.get(ids[j]!)!;
      const fb = fp.get(ids[j]!)!;
      const ox = Math.min(a.x + fa.hw, b.x + fb.hw) - Math.max(a.x - fa.hw, b.x - fb.hw);
      const oy = Math.min(a.y + fa.down, b.y + fb.down) - Math.max(a.y - fa.up, b.y - fb.up);
      if (ox <= 0 || oy <= 0) continue;
      any = true;
      if (ox < oy && !verticalOnly) {
        const dir = b.x > a.x || (b.x === a.x && j % 2 === 0) ? 1 : -1;
        const s = ((ox + 0.5) / 2) * strength * dir;
        a.x -= s;
        b.x += s;
      } else {
        const ca = a.y + (fa.down - fa.up) / 2;
        const cb = b.y + (fb.down - fb.up) / 2;
        const dir = cb > ca || (cb === ca && j % 2 === 0) ? 1 : -1;
        const s = ((oy + 0.5) / 2) * strength * dir;
        a.y -= s;
        b.y += s;
      }
    }
  }
  return any;
}

export interface GalaxyLayoutOptions {
  /** canvas size in CSS px */
  width: number;
  height: number;
  /** how far the star art reaches from its centre (labels sit below it) */
  reach: (radius: number) => number;
  /** label width in CSS px, or null for unlabelled concepts */
  labelWidth: (node: GalaxyNode) => number | null;
}

export interface GalaxyLayout {
  positions: Map<string, Point>;
  footprints: Map<string, Footprint>;
  /** where to centre the canvas and how far to zoom so every star and label box is on screen */
  view: { cx: number; cy: number; zoom: number };
}

/** Centre and zoom that keep every box on screen; zoom is clamped to [1, 2]. */
export function fitView(
  positions: Map<string, Point>,
  footprints: Map<string, Footprint>,
  width: number,
  height: number,
  margin = LAYOUT.margin,
): { cx: number; cy: number; zoom: number } {
  if (positions.size === 0) return { cx: 0, cy: 0, zoom: 1 };
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
  const zoom = Math.min(
    2,
    Math.max(1, Math.min((width - 2 * margin) / (maxX - minX), (height - 2 * margin) / (maxY - minY))),
  );
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom };
}

/**
 * Lay the galaxy out in CSS px at zoom 1, centred on 0,0: brightest concepts start near the
 * middle (golden-angle spiral), then repulsion, springs, gravity and a portrait pull settle it, and
 * collision passes run until no star-and-label box overlaps another. Finally the layout is scaled
 * up (never down) so it fills the canvas; scaling only grows the gaps, so nothing starts to overlap.
 */
export function layoutGalaxy(payload: BrainPayload, opts: GalaxyLayoutOptions): GalaxyLayout {
  const { nodes, links } = toGalaxy(payload);
  const ordered = [...nodes].sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name));
  const ids = ordered.map((n) => n.id);
  const fp = new Map(
    ordered.map((n) => [n.id, footprint(opts.reach(n.radius), opts.labelWidth(n), LAYOUT.pad)] as const),
  );
  const pos = new Map<string, Point>();
  ordered.forEach((n, i) => {
    const angle = i * 2.399963; // golden angle
    const r = 70 * Math.sqrt(i);
    pos.set(n.id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
  });
  const kx = LAYOUT.gravity + aspectPull(opts.width, opts.height) * 0.1;

  for (let t = 0; t < LAYOUT.iterations; t++) {
    const alpha = 1 - t / LAYOUT.iterations;
    const delta = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    // many-body repulsion
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i]!)!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j]!)!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = Math.min(40, (LAYOUT.repulsion * alpha) / d2);
        delta.get(ids[i]!)!.x -= (dx / d) * f;
        delta.get(ids[i]!)!.y -= (dy / d) * f;
        delta.get(ids[j]!)!.x += (dx / d) * f;
        delta.get(ids[j]!)!.y += (dy / d) * f;
      }
    }
    // springs along links (longer than before)
    for (const l of links) {
      const a = pos.get(l.source);
      const b = pos.get(l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - spreadLinkDistance(l.weight)) * LAYOUT.spring * alpha;
      delta.get(l.source)!.x += (dx / d) * f;
      delta.get(l.source)!.y += (dy / d) * f;
      delta.get(l.target)!.x -= (dx / d) * f;
      delta.get(l.target)!.y -= (dy / d) * f;
    }
    // gravity, a little stronger across than down so the galaxy takes a portrait shape
    for (const id of ids) {
      const p = pos.get(id)!;
      const d = delta.get(id)!;
      p.x += d.x - p.x * kx * alpha;
      p.y += d.y - p.y * LAYOUT.gravity * alpha;
    }
    resolveOverlaps(ids, pos, fp, 0.5);
  }
  // settle every overlap
  for (let k = 0; k < 600 && resolveOverlaps(ids, pos, fp, 1); k++);

  // Fit the canvas at zoom 1 (labels are drawn at full size): keep boxes between the side walls
  // (they may slide sideways into gaps), then compact vertically until the height fits too.
  const availWidth = Math.max(1, opts.width - 2 * LAYOUT.margin);
  const availHeight = Math.max(1, opts.height - 2 * LAYOUT.margin);
  const extent = () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const p = pos.get(id)!;
      const f = fp.get(id)!;
      minX = Math.min(minX, p.x - f.hw);
      maxX = Math.max(maxX, p.x + f.hw);
      minY = Math.min(minY, p.y - f.up);
      maxY = Math.max(maxY, p.y + f.down);
    }
    return { minX, maxX, minY, maxY };
  };
  const walls = () => {
    const half = availWidth / 2;
    for (const id of ids) {
      const p = pos.get(id)!;
      const hw = fp.get(id)!.hw;
      p.x = hw * 2 >= availWidth ? 0 : Math.max(-half + hw, Math.min(half - hw, p.x));
    }
  };
  const settle = () => {
    for (let k = 0; k < 800; k++) {
      const any = resolveOverlaps(ids, pos, fp, 1);
      walls();
      if (!any) break;
    }
    // walls can leave a final overlap: finish with vertical moves only (always resolvable)
    for (let k = 0; k < 800 && resolveOverlaps(ids, pos, fp, 1, true); k++);
  };
  if (ids.length > 0) {
    const e = extent();
    const cx = (e.minX + e.maxX) / 2;
    for (const id of ids) pos.get(id)!.x -= cx; // centre across
    if (e.maxX - e.minX > availWidth) settle();
    for (let k = 0; k < 160; k++) {
      const { minY, maxY } = extent();
      if (maxY - minY <= availHeight) break;
      const cy = (minY + maxY) / 2;
      for (const id of ids) pos.get(id)!.y = cy + (pos.get(id)!.y - cy) * 0.97;
      settle();
    }
  }

  // Still taller than the canvas (a narrow phone)? Pack the boxes into rows instead, keeping
  // their current top-to-bottom order so the rough structure survives: deterministic, never
  // overlapping, and as short as the width allows. Readability beats the force layout here.
  if (ids.length > 0) {
    const e = extent();
    if (e.maxY - e.minY > availHeight) shelfPack(ids, pos, fp, availWidth);
  }

  // fill the canvas: scale positions up (never down) about the centre of the boxes
  if (ids.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const p = pos.get(id)!;
      const f = fp.get(id)!;
      minX = Math.min(minX, p.x - f.hw);
      maxX = Math.max(maxX, p.x + f.hw);
      minY = Math.min(minY, p.y - f.up);
      maxY = Math.max(maxY, p.y + f.down);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const availW = Math.max(1, opts.width - 2 * LAYOUT.margin);
    const availH = Math.max(1, opts.height - 2 * LAYOUT.margin);
    // positions spread by s while boxes keep their size: solve for s so the boxes just fit
    let s = 1;
    for (let k = 0; k < 40; k++) {
      let w = 0;
      let h = 0;
      for (const id of ids) {
        const p = pos.get(id)!;
        const f = fp.get(id)!;
        w = Math.max(w, Math.abs((p.x - cx) * s) + f.hw);
        h = Math.max(h, Math.abs((p.y - cy) * s) + Math.max(f.up, f.down));
      }
      if (2 * w > availW || 2 * h > availH) break;
      s *= 1.05;
    }
    s = Math.max(1, s / 1.05);
    for (const id of ids) {
      const p = pos.get(id)!;
      p.x = (p.x - cx) * s;
      p.y = (p.y - cy) * s;
    }
  }
  return { positions: pos, footprints: fp, view: fitView(pos, fp, opts.width, opts.height) };
}

/** Row packing for narrow canvases: left to right in rows (by current y, then x), evenly spread. */
function shelfPack(ids: string[], pos: Map<string, Point>, fp: Map<string, Footprint>, availWidth: number): void {
  const order = [...ids].sort((a, b) => pos.get(a)!.y - pos.get(b)!.y || pos.get(a)!.x - pos.get(b)!.x);
  const rows: string[][] = [];
  let row: string[] = [];
  let used = 0;
  for (const id of order) {
    const w = 2 * fp.get(id)!.hw;
    if (row.length > 0 && used + w > availWidth) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(id);
    used += w;
  }
  if (row.length) rows.push(row);
  let y = 0;
  rows.forEach((r, ri) => {
    const up = Math.max(...r.map((id) => fp.get(id)!.up));
    const down = Math.max(...r.map((id) => fp.get(id)!.down));
    const total = r.reduce((sum, id) => sum + 2 * fp.get(id)!.hw, 0);
    const gap = r.length > 1 ? (availWidth - total) / (r.length - 1) : 0;
    // stagger alternate rows slightly so it reads as a sky, not a table
    let x = r.length > 1 ? -availWidth / 2 : -fp.get(r[0]!)!.hw + (ri % 2 ? 12 : -12);
    y += up;
    for (const id of r) {
      const hw = fp.get(id)!.hw;
      pos.set(id, { x: x + hw, y });
      x += 2 * hw + gap;
    }
    y += down + 1; // boxes already carry their padding; 1 px keeps touching rows apart
  });
}
