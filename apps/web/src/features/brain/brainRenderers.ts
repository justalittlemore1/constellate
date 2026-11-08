/**
 * How the galaxy draws one concept and one link. Kept apart from BrainCanvas so wave 2 can swap
 * the nodes for the chosen star art and the links for comet trails by passing other renderers,
 * without touching the layout, selection or reveal logic.
 */
import type { ConceptRelation } from '../../lib/api';
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

export const LABEL_PX = 12;
/** canvas can't read CSS variables cheaply; same face as --font-display */
export const LABEL_FONT = (px: number) => `600 ${px}px 'Cormorant Garamond', Georgia, serif`;

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
}

export interface BrainRenderers {
  drawNode(d: NodeDraw): void;
  drawLink(d: LinkDraw): void;
}

/** Wave 1: glowing dots with serif labels, relation shown by dash pattern (never colour alone). */
export const defaultRenderers: BrainRenderers = {
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
