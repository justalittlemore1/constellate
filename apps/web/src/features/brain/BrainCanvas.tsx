import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import type { BrainPayload } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { layoutGalaxy, toGalaxy, topConceptIds, type GalaxyLink, type GalaxyNode } from './brainLayout';

import { defaultRenderers, LABEL_FONT, LABEL_PX, type BrainRenderers } from './brainRenderers';
import { linkProgress, starOpacity } from './starReveal';

type N = NodeObject<GalaxyNode>;
type L = LinkObject<GalaxyNode, GalaxyLink>;

export interface BrainCanvasProps {
  payload: BrainPayload;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** still the layout instantly (reduced motion / low stimulation) */
  reduced: boolean;
  /** while stars are appearing: when each revealed concept appeared; null = all visible */
  revealedAt?: Map<string, number> | null;
  /** while revealing: when the links start drawing in (null = after the stars) */
  linksFrom?: number | null;
  /** how nodes and links are drawn (wave 2 swaps in star art and comet trails) */
  renderers?: BrainRenderers;
}

/** Label width at `px` font size, measured when a canvas is available (estimated otherwise). */
function labelWidth(name: string, px: number): number {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return name.length * px * 0.6; // Fraunces 600 measures ≤ 0.58 em per character
  ctx.font = LABEL_FONT(px);
  return ctx.measureText(name).width;
}

/** The canvas is one picture to assistive tech; the List view carries the content. */
export function galaxyLabel(concepts: number): string {
  return `Brain galaxy of ${concepts} ${concepts === 1 ? 'concept' : 'concepts'}. Use the Text view to explore them with a keyboard or screen reader.`;
}

/**
 * The galaxy: `react-force-graph-2d` with link distance 40 + 160·(1 − w) and radius 6 + 3·√mentions.
 * Labels for the 15 largest concepts, the hovered one and the selected one with its neighbours;
 * selecting dims everything else. Mouse/touch only — the list view is the keyboard path.
 */
export function BrainCanvas({
  payload,
  selectedId,
  onSelect,
  reduced,
  revealedAt = null,
  linksFrom = null,
  renderers = defaultRenderers,
}: BrainCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const textSize = usePrefs((s) => s.textSize);
  const lowStim = usePrefs((s) => s.lowStimulation);

  const labelled = useMemo(() => topConceptIds(payload.concepts), [payload.concepts]);
  const lit = useMemo(() => {
    if (!selectedId) return null;
    const s = new Set([selectedId]);
    for (const l of payload.links) {
      if (l.sourceId === selectedId) s.add(l.targetId);
      if (l.targetId === selectedId) s.add(l.sourceId);
    }
    return s;
  }, [payload.links, selectedId]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // The galaxy is laid out once per payload and canvas size (brainLayout.layoutGalaxy): spread out,
  // star and label boxes never overlapping, scaled to fill the canvas. Nodes are pinned there
  // (fx / fy), so force-graph doesn't move them and every visit's reveal looks the same.
  // A fresh copy per layout, because force-graph mutates its data.
  const data = useMemo(() => {
    const galaxy = toGalaxy(payload);
    if (size.w === 0) return { ...galaxy, view: null };
    const { positions, view } = layoutGalaxy(payload, {
      width: size.w,
      height: size.h,
      reach: (r) => renderers.reach?.(r) ?? r,
      labelWidth: (n) => (labelled.has(n.id) ? labelWidth(n.name, LABEL_PX * textSize) : null),
    });
    const nodes = galaxy.nodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return { ...n, x: p.x, y: p.y, fx: p.x, fy: p.y };
    });
    return { nodes, links: galaxy.links, view };
  }, [payload, size.w, size.h, labelled, textSize, renderers]);

  // Fit to view once the (pinned) layout is in, using the star-and-label boxes (force-graph's own
  // zoomToFit only sees star centres and cut labels off at the edges). Never below zoom 1, where the
  // constant-size labels would start to crowd each other (a very large Brain pans instead).
  const fit = () => {
    const g = fg.current;
    const view = data.view;
    if (!g || !view) return;
    g.centerAt(view.cx, view.cy, 0);
    g.zoom(view.zoom, 0);
  };

  const glow = lowStim ? 0.35 : 1;

  return (
    <div
      ref={wrap}
      role="img"
      aria-label={galaxyLabel(payload.concepts.length)}
      className="absolute inset-0"
      data-testid="brain-canvas"
    >
      {size.w > 0 && (
        <ForceGraph2D<GalaxyNode, GalaxyLink>
          ref={fg}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={(n) => n.name}
          nodeVal={(n) => n.radius}
          // pinned layout: one tick is enough, then fit
          warmupTicks={0}
          cooldownTicks={1}
          enableNodeDrag={false}
          minZoom={0.3}
          maxZoom={3}
          onEngineStop={fit}
          onNodeClick={(n) => onSelect(String(n.id))}
          onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
          onBackgroundClick={() => onSelect(null)}
          // stars still to appear are hidden; links wait until every star is out, then draw in.
          // The canvas keeps redrawing for the slow colour shift (paused under reduced motion).
          nodeVisibility={(n) => !revealedAt || revealedAt.has(String(n.id))}
          linkVisibility={() => !revealedAt || linksFrom !== null}
          autoPauseRedraw={reduced && !revealedAt}
          linkCanvasObjectMode={() => 'replace'}
          linkCanvasObject={(l, ctx, scale) => {
            const a = l.source as N;
            const b = l.target as N;
            if (typeof a !== 'object' || typeof b !== 'object') return;
            const now = performance.now();
            renderers.drawLink({
              ctx,
              from: { x: a.x ?? 0, y: a.y ?? 0 },
              to: { x: b.x ?? 0, y: b.y ?? 0 },
              relation: l.relation,
              weight: l.weight ?? 0,
              lit: Boolean(lit && lit.has(String(a.id)) && lit.has(String(b.id))),
              opacity: 1,
              progress: revealedAt ? linkProgress(linksFrom, now) : 1,
              scale,
            });
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, Math.max(n.radius, 12), 0, Math.PI * 2);
            ctx.fill();
          }}
          nodeCanvasObject={(n, ctx, scale) => {
            const id = String(n.id);
            renderers.drawNode({
              ctx,
              x: n.x ?? 0,
              y: n.y ?? 0,
              radius: n.radius,
              name: n.name,
              scale,
              opacity: revealedAt ? starOpacity(revealedAt.get(id), performance.now()) : 1,
              dimmed: lit !== null && !lit.has(id),
              selected: id === selectedId,
              showLabel: labelled.has(id) || id === hoverId || (lit?.has(id) ?? false),
              glow,
              textSize,
              now: performance.now(),
              reduced,
            });
          }}
        />
      )}
    </div>
  );
}
