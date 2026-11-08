import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import type { BrainPayload } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import {
  aspectPull,
  footprint,
  LABEL_GAP,
  pullToCentreLine,
  linkDistance,
  RELATION_DASH,
  separateFootprints,
  toGalaxy,
  topConceptIds,
  type Footprint,
  type GalaxyLink,
  type GalaxyNode,
} from './brainLayout';

type N = NodeObject<GalaxyNode>;
type L = LinkObject<GalaxyNode, GalaxyLink>;

/** Colours from the design tokens (canvas can't read Tailwind classes). */
const C = {
  node: '#6FE3FF',
  selected: '#FFD84D',
  label: '#E8ECF8',
  link: 'rgba(163,172,200,0.45)',
  linkLit: 'rgba(111,227,255,0.85)',
};

export interface BrainCanvasProps {
  payload: BrainPayload;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** still the layout instantly (reduced motion / low stimulation) */
  reduced: boolean;
}

/** force-graph replaces link ends with node objects once the simulation starts */
/** Label width at `px` font size, measured when a canvas is available (estimated otherwise). */
function labelWidth(name: string, px: number): number {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return name.length * px * 0.58;
  ctx.font = `600 ${px}px Inter, system-ui, sans-serif`;
  return ctx.measureText(name).width;
}

const LABEL_PX = 12;

function endId(end: unknown): string {
  return typeof end === 'object' && end !== null ? String((end as { id: unknown }).id) : String(end);
}

/** The canvas is one picture to assistive tech; the List view carries the content. */
export function galaxyLabel(concepts: number): string {
  return `Brain galaxy of ${concepts} ${concepts === 1 ? 'concept' : 'concepts'}. Switch to the List view to explore them with a keyboard or screen reader.`;
}

/**
 * The galaxy: `react-force-graph-2d` with link distance 40 + 160·(1 − w) and radius 6 + 3·√mentions.
 * Labels for the 15 largest concepts, the hovered one and the selected one with its neighbours;
 * selecting dims everything else. Mouse/touch only — the list view is the keyboard path.
 */
export function BrainCanvas({ payload, selectedId, onSelect, reduced }: BrainCanvasProps) {
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
      m.set(n.id, footprint(n.radius, labelled.has(n.id) ? labelWidth(n.name, LABEL_PX * textSize) : null));
    }
    return m;
  }, [data, labelled, textSize]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const link = g.d3Force('link') as { distance?: (fn: (l: L) => number) => unknown } | undefined;
    link?.distance?.((l) => linkDistance(l.weight ?? 0));
    const charge = g.d3Force('charge') as { strength?: (v: number) => unknown } | undefined;
    charge?.strength?.(-60);
    let nodes: N[] = [];
    const collide = Object.assign(
      (alpha: number) => separateFootprints(nodes, (n) => footprints.get(String(n.id))!, Math.min(1, alpha * 4)),
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
          linkColor={(l) => (lit && lit.has(endId(l.source)) && lit.has(endId(l.target)) ? C.linkLit : C.link)}
          linkWidth={(l) => 0.6 + 1.6 * (l.weight ?? 0)}
          linkLineDash={(l) => RELATION_DASH[l.relation]}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, Math.max(n.radius, 12), 0, Math.PI * 2);
            ctx.fill();
          }}
          nodeCanvasObject={(n, ctx, scale) => {
            const id = String(n.id);
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const dim = lit !== null && !lit.has(id);
            const selected = id === selectedId;
            ctx.globalAlpha = dim ? 0.15 : 1;

            // glow
            const g = ctx.createRadialGradient(x, y, n.radius * 0.4, x, y, n.radius * 2.2);
            g.addColorStop(0, `rgba(111,227,255,${0.35 * glow})`);
            g.addColorStop(1, 'rgba(111,227,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, n.radius * 2.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = C.node;
            ctx.beginPath();
            ctx.arc(x, y, n.radius, 0, Math.PI * 2);
            ctx.fill();
            if (selected) {
              // gold ring + thicker outline (not colour alone)
              ctx.strokeStyle = C.selected;
              ctx.lineWidth = 3 / scale;
              ctx.beginPath();
              ctx.arc(x, y, n.radius + 4 / scale, 0, Math.PI * 2);
              ctx.stroke();
            }

            const showLabel = labelled.has(id) || id === hoverId || (lit?.has(id) ?? false);
            if (showLabel) {
              const px = (LABEL_PX * textSize) / scale;
              const ty = y + n.radius + LABEL_GAP / scale;
              ctx.font = `600 ${px}px Inter, system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              // dark halo so labels stay readable over links and glow
              ctx.lineJoin = 'round';
              ctx.lineWidth = 4 / scale;
              ctx.strokeStyle = 'rgba(7,10,23,0.9)';
              ctx.strokeText(n.name, x, ty);
              ctx.fillStyle = C.label;
              ctx.fillText(n.name, x, ty);
            }
            ctx.globalAlpha = 1;
          }}
        />
      )}
    </div>
  );
}
