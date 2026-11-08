import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import type { BrainPayload } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import {
  aspectPull,
  footprint,
  pullToCentreLine,
  linkDistance,
  separateFootprints,
  toGalaxy,
  topConceptIds,
  type Footprint,
  type GalaxyLink,
  type GalaxyNode,
} from './brainLayout';

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
  if (!ctx) return name.length * px * 0.5;
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

  // force-graph mutates its data (x, y, vx…); give it a fresh copy per payload
  const data = useMemo(() => toGalaxy(payload), [payload]);
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

  // Labels are drawn at a constant on-screen size; their footprints are sized for zoom 1 and
  // the fit never zooms out below 1 for a small Brain, so separated labels stay separated.
  const footprints = useMemo(() => {
    const m = new Map<string, Footprint>();
    for (const n of data.nodes) {
      const reach = renderers.reach?.(n.radius) ?? n.radius; // spikes, rays… (label goes below)
      m.set(n.id, footprint(reach, labelled.has(n.id) ? labelWidth(n.name, LABEL_PX * textSize) : null));
    }
    return m;
  }, [data, labelled, textSize, renderers]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const link = g.d3Force('link') as { distance?: (fn: (l: L) => number) => unknown } | undefined;
    link?.distance?.((l) => linkDistance(l.weight ?? 0));
    const charge = g.d3Force('charge') as { strength?: (v: number) => unknown } | undefined;
    charge?.strength?.(-60);
    let nodes: N[] = [];
    const collide = Object.assign(
      (alpha: number) =>
        // keep a floor so labels still separate as the simulation cools
        separateFootprints(nodes, (n) => footprints.get(String(n.id))!, Math.max(0.35, Math.min(1, alpha * 4))),
      { initialize: (ns: N[]) => void (nodes = ns) },
    );
    g.d3Force('collide', collide);
    const k = aspectPull(size.w, size.h);
    let pulled: N[] = [];
    g.d3Force(
      'portrait',
      Object.assign((alpha: number) => pullToCentreLine(pulled, k, alpha), {
        initialize: (ns: N[]) => void (pulled = ns),
      }),
    );
    g.d3ReheatSimulation();
  }, [data, footprints, size.w, size.h]);

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
          warmupTicks={reduced ? 300 : 0}
          cooldownTicks={reduced ? 0 : 200}
          enableNodeDrag={!reduced}
          minZoom={0.3}
          maxZoom={3}
          // fill the view: padding leaves room for the labels drawn under the outermost nodes
          onEngineStop={() => fg.current?.zoomToFit(reduced ? 0 : 400, 64)}
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
