/**
 * How the galaxy draws one concept and one link. Kept apart from BrainCanvas so wave 2 can swap
 * the nodes for the chosen star art and the links for comet trails by passing other renderers,
 * without touching the layout, selection or reveal logic.
 */
import type { ConceptRelation } from '../../lib/api';
import { uiFlag } from '../../lib/uiFlags';
import { LABEL_GAP, RELATION_DASH } from './brainLayout';

/** Colours from the design tokens (canvas can't read Tailwind classes). */
export const BRAIN_COLOURS = {
  node: '#6FE3FF',
  selected: '#FFD84D',
  label: '#E8ECF8',
  halo: 'rgba(7,10,23,0.9)',
  link: 'rgba(163,172,200,0.45)',
  linkLit: 'rgba(111,227,255,0.85)',
};

/** canvas labels at 15 px on screen (the smallest text size) */
export const LABEL_PX = 15;
/** canvas can't read CSS variables cheaply; same face as --font-display */
export const LABEL_FONT = (px: number) => `600 ${px}px 'Fraunces Variable', Georgia, serif`;

export interface NodeDraw {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  radius: number;
  name: string;
  /** canvas zoom: divide screen-space sizes by it */
  scale: number;
  /** 0–1: fade-in while the star appears (multiplied with dimming) */
  opacity: number;
  /** another concept is selected and this one is not its neighbour */
  dimmed: boolean;
  selected: boolean;
  showLabel: boolean;
  /** 0–1 glow strength (lower in low-stimulation mode) */
  glow: number;
  /** Text size setting, 1–1.5 */
  textSize: number;
  /** performance.now() of this frame (slow colour shifts) */
  now?: number;
  /** reduced motion / low stimulation: no colour shift */
  reduced?: boolean;
}

export interface LinkDraw {
  ctx: CanvasRenderingContext2D;
  from: { x: number; y: number };
  to: { x: number; y: number };
  relation: ConceptRelation;
  /** 0–1 layout weight */
  weight: number;
  /** both ends are the selected concept or its neighbours */
  lit: boolean;
  opacity: number;
  scale: number;
  /** 0–1: how much of the link is drawn (links draw in after the stars appear); default 1 */
  progress?: number;
  /** for `broader`: `from` is the broader concept */
}

export interface BrainRenderers {
  drawNode(d: NodeDraw): void;
  drawLink(d: LinkDraw): void;
  /** how far the art reaches from the centre (labels go below it; layout keeps it clear) */
  reach?(radius: number): number;
}

/** Wave 1: glowing dots with serif labels, relation shown by dash pattern (never colour alone). */
export const dotRenderers: BrainRenderers = {
  drawNode({ ctx, x, y, radius, name, scale, opacity, dimmed, selected, showLabel, glow, textSize }) {
    ctx.save();
    ctx.globalAlpha = opacity * (dimmed ? 0.15 : 1);

    // a steady, soft glow (no pulsing)
    const g = ctx.createRadialGradient(x, y, radius * 0.4, x, y, radius * 2.2);
    g.addColorStop(0, `rgba(111,227,255,${0.35 * glow})`);
    g.addColorStop(1, 'rgba(111,227,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BRAIN_COLOURS.node;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      // gold ring + thicker outline (not colour alone)
      ctx.strokeStyle = BRAIN_COLOURS.selected;
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4 / scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (showLabel) {
      const px = (LABEL_PX * textSize) / scale;
      const ty = y + radius + LABEL_GAP / scale;
      ctx.font = LABEL_FONT(px);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // dark halo so labels stay readable over links and glow
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4 / scale;
      ctx.strokeStyle = BRAIN_COLOURS.halo;
      ctx.strokeText(name, x, ty);
      ctx.fillStyle = BRAIN_COLOURS.label;
      ctx.fillText(name, x, ty);
    }
    ctx.restore();
  },

  drawLink({ ctx, from, to, relation, weight, lit, opacity, scale }) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = lit ? BRAIN_COLOURS.linkLit : BRAIN_COLOURS.link;
    ctx.lineWidth = (0.6 + 1.6 * weight) / scale;
    const dash = RELATION_DASH[relation];
    ctx.setLineDash(dash ? dash.map((v) => v / scale) : []);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  },
};

// ── wave 2: "O1: six diffraction spikes" stars, comet trails, constellation lines, stardust ──

export const STAR_ART = {
  spike: '#DDEBFF',
  coreA: '#DCE8FF',
  coreB: '#E9E0FF',
  centre: '#fff',
  /** one full colour-shift loop between coreA and coreB */
  shiftMs: 10_000,
  /** spike half-length relative to the node radius (6 + 3·√mentions); was 2.0 (×1.65 in round 4) */
  spikeRatio: 3.3,
  /** core radius relative to the node radius; was 1.0 (60 % in round 4) */
  coreRatio: 0.6,
  /** white centre dot relative to the core */
  centreRatio: 0.4,
} as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The core colour at time `now`: a slow loop between two close blue-whites; fixed when reduced. */
export function coreColour(now: number | undefined, reduced: boolean | undefined): string {
  if (reduced || now === undefined) return STAR_ART.coreA;
  const t = (1 - Math.cos((2 * Math.PI * now) / STAR_ART.shiftMs)) / 2; // 0→1→0 over shiftMs
  const a = hexToRgb(STAR_ART.coreA);
  const b = hexToRgb(STAR_ART.coreB);
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Stars scale in as they fade in (40 % → 100 %). */
export function appearScale(opacity: number): number {
  return 0.4 + 0.6 * Math.max(0, Math.min(1, opacity));
}

/** Deterministic 0–1 jitter so stardust is static (it never drifts). */
function jitter(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export const starRenderers: BrainRenderers = {
  drawNode({ ctx, x, y, radius, name, scale, opacity, dimmed, selected, showLabel, textSize, now, reduced }) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity)) * (dimmed ? 0.15 : 1);
    const s = radius * appearScale(opacity); // scales in while appearing
    const r = s * STAR_ART.coreRatio; // core
    const spike = s * STAR_ART.spikeRatio;
    const fullSpike = radius * STAR_ART.spikeRatio; // labels stay put while the star scales in

    // diffraction spikes: one vertical (1 px), two diagonals (0.7 px), round caps
    ctx.strokeStyle = STAR_ART.spike;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(x, y - spike);
    ctx.lineTo(x, y + spike);
    ctx.stroke();
    ctx.lineWidth = 0.7 / scale;
    const d = spike * 0.72;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.stroke();

    // core (slow colour shift) and white centre
    ctx.fillStyle = coreColour(now, reduced);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = STAR_ART.centre;
    ctx.beginPath();
    ctx.arc(x, y, r * STAR_ART.centreRatio, 0, Math.PI * 2);
    ctx.fill();

    if (selected) {
      // gold ring (shape + colour, not colour alone)
      ctx.strokeStyle = BRAIN_COLOURS.selected;
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.arc(x, y, r + 5 / scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (showLabel) {
      const px = (LABEL_PX * textSize) / scale;
      const ty = y + fullSpike + LABEL_GAP / scale; // below the vertical spike
      ctx.font = LABEL_FONT(px);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4 / scale;
      ctx.strokeStyle = BRAIN_COLOURS.halo;
      ctx.strokeText(name, x, ty);
      ctx.fillStyle = BRAIN_COLOURS.label;
      ctx.fillText(name, x, ty);
    }
    ctx.restore();
  },

  reach: (radius) => radius * STAR_ART.spikeRatio,

  drawLink: (d) => (uiFlag('brainCometLinks') ? drawCometLink(d) : drawConstellationLink(d)),
};

/** Thin, even line width for every classic constellation link (screen px). */
export const CONSTELLATION_LINE_PX = 0.9;
/** Half-size of the broader → narrower chevron at a broader link's midpoint (screen px). */
export const CHEVRON_PX = 4;

/**
 * Classic constellation lines: thin, even strokes. `broader` carries a tiny chevron at its midpoint
 * pointing from the broader concept to the narrower one; `related` is a plain line; `co_discussed`
 * is evenly dotted. The shape tells the relations apart, not colour.
 */
export function drawConstellationLink({ ctx, from, to, relation, lit, opacity, scale, progress = 1 }: LinkDraw): void {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return;
  const end = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  const colour = lit ? 'rgba(221,235,255,0.9)' : 'rgba(200,212,240,0.55)';
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineWidth = CONSTELLATION_LINE_PX / scale;

  if (relation === 'co_discussed') {
    // evenly spaced dots
    const len = Math.hypot(end.x - from.x, end.y - from.y);
    const gap = 6 / scale;
    const n = Math.max(1, Math.floor(len / gap));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.beginPath();
      ctx.arc(from.x + (end.x - from.x) * t, from.y + (end.y - from.y) * t, 0.8 / scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  if (relation === 'broader' && p >= 0.5) {
    // tiny chevron at the midpoint, pointing broader → narrower
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const ux = (to.x - from.x) / len;
    const uy = (to.y - from.y) / len;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const h = CHEVRON_PX / scale;
    // the tip sits ahead of the midpoint; the arms trail back on either side
    const tipX = mx + ux * h * 0.6;
    const tipY = my + uy * h * 0.6;
    ctx.beginPath();
    ctx.moveTo(tipX - ux * h - uy * h, tipY - uy * h + ux * h);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - ux * h + uy * h, tipY - uy * h - ux * h);
    ctx.stroke();
  }
  ctx.restore();
}

/** Wave 2's links (comet trail / line / stardust), kept behind `uiFlags.brainCometLinks`. */
export function drawCometLink({ ctx, from, to, relation, weight, lit, opacity, scale, progress = 1 }: LinkDraw): void {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return;
  const end = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity)) * (lit ? 1 : 0.7);
  ctx.lineCap = 'round';

  if (relation === 'broader') {
    // comet trail: bright at the broader concept, fading toward the narrower one, tapering
    const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    g.addColorStop(0, 'rgba(221,235,255,0.95)');
    g.addColorStop(1, 'rgba(221,235,255,0)');
    ctx.strokeStyle = g;
    ctx.setLineDash([]);
    ctx.lineWidth = (1.2 + 1.2 * weight) / scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if (relation === 'related') {
    // thin classic constellation line
    ctx.strokeStyle = lit ? 'rgba(221,235,255,0.9)' : 'rgba(200,212,240,0.55)';
    ctx.setLineDash([]);
    ctx.lineWidth = 0.8 / scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else {
    // co-discussed: sparse dotted stardust, static (deterministic jitter, never drifts)
    ctx.fillStyle = lit ? 'rgba(221,235,255,0.9)' : 'rgba(200,212,240,0.6)';
    const len = Math.hypot(end.x - from.x, end.y - from.y);
    const gap = 9 / scale;
    const n = Math.max(1, Math.floor(len / gap));
    const nx = len ? -(end.y - from.y) / len : 0;
    const ny = len ? (end.x - from.x) / len : 0;
    const seed = Math.round(from.x + to.y);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (jitter(i, seed) - 0.5) * (2.4 / scale);
      ctx.beginPath();
      ctx.arc(
        from.x + (end.x - from.x) * t + nx * off,
        from.y + (end.y - from.y) * t + ny * off,
        (0.5 + 0.5 * jitter(i + 7, seed)) / scale,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

/** What BrainCanvas draws with unless told otherwise. */
export const defaultRenderers: BrainRenderers = starRenderers;
