/**
 * Star art (humans' redesign, wave 2). Pure decoration (aria-hidden): meaning is carried by the
 * shape, the label / sub-line and the accessible name, never by colour alone.
 *
 *  Y3 compass star   — conversation topics (default): an eight-point compass, a main four-point star
 *                      with a smaller one rotated 45° behind it. "young" gold for topics, orange
 *                      "rekindled" for a deferred thread that was picked up later.
 *  Y4 faceted star   — (flag `facetedStars`) conversation topics: four points, light + dark facets so it reads as 3D.
 *                      "young" palette for topics, "rekindled" (more orange) for a deferred thread
 *                      that was picked up later.
 *  E2 broken shell   — a deferred / unexplored thread: a small dashed ring with a dim core, like an
 *                      ember. Different shape from a star, so no colour is needed to tell them apart.
 *
 * The only motion is a very slow colour shift between two close colours (8–12 s). Callers pass
 * `motion={false}` under prefers-reduced-motion / Reduce motion, and then everything is static.
 */

/** Unit geometry: drawn at radius 24 and scaled to the node's radius. */
export const Y4_UNIT = 24;
export const Y4_LIGHT = 'M0,-24 L5,-5 L0,0Z M24,0 L5,5 L0,0Z M0,24 L-5,5 L0,0Z M-24,0 L-5,-5 L0,0Z';
export const Y4_DARK = 'M0,-24 L-5,-5 L0,0Z M24,0 L5,-5 L0,0Z M0,24 L5,5 L0,0Z M-24,0 L-5,5 L0,0Z';

export const PALETTES = {
  young: { light: '#FFDD8A', lightShift: '#FFD27A', dark: '#E89A3A', glow: 'rgba(255,214,130,0.55)' },
  rekindled: { light: '#FFB36B', lightShift: '#FFA65C', dark: '#E0682A', glow: 'rgba(255,150,80,0.55)' },
} as const;
export type StarPalette = keyof typeof PALETTES;

/** Y3 eight-point compass, unit radius 24 (the secondary star is drawn rotated 45°). */
export const Y3_MAIN = 'M0,-24 L4,-4 L24,0 L4,4 L0,24 L-4,4 L-24,0 L-4,-4Z';
export const Y3_SECONDARY = 'M0,-14 L2.5,-2.5 L14,0 L2.5,2.5 L0,14 L-2.5,2.5 L-14,0 L-2.5,-2.5Z';

export const Y3_PALETTES = {
  young: { main: '#FFC857', mainShift: '#FFB04A', secondary: '#FFE2A0', glow: 'rgba(255,200,87,0.5)' },
  rekindled: { main: '#F28C3A', mainShift: '#E67E2E', secondary: '#FFC08A', glow: 'rgba(242,140,58,0.5)' },
} as const;

export function Y3Star({
  cx,
  cy,
  r,
  palette = 'young',
  motion,
}: {
  cx: number;
  cy: number;
  r: number;
  palette?: StarPalette;
  motion: boolean;
}) {
  const p = Y3_PALETTES[palette];
  const k = r / Y4_UNIT;
  return (
    <g
      data-testid="y3-star"
      data-palette={palette}
      transform={`translate(${cx} ${cy}) scale(${k})`}
      style={{ filter: `drop-shadow(0 0 calc(${4 / k}px * var(--glow)) ${p.glow})` }}
    >
      <path d={Y3_SECONDARY} transform="rotate(45)" fill={p.secondary} data-testid="y3-secondary" />
      <path
        d={Y3_MAIN}
        fill={p.main}
        data-testid="y3-main"
        className={motion ? 'cmap-shift-fill' : undefined}
        style={motion ? ({ '--shift-from': p.main, '--shift-to': p.mainShift } as React.CSSProperties) : undefined}
      />
    </g>
  );
}

export const EMBER = { radius: 10, stroke: '#B9472C', core: '#B9472C', coreShift: '#D0602F', coreRadius: 2.2 } as const;

export function Y4Star({
  cx,
  cy,
  r,
  palette = 'young',
  motion,
}: {
  cx: number;
  cy: number;
  r: number;
  palette?: StarPalette;
  motion: boolean;
}) {
  const p = PALETTES[palette];
  const k = r / Y4_UNIT;
  return (
    <g
      data-testid="y4-star"
      data-palette={palette}
      transform={`translate(${cx} ${cy}) scale(${k})`}
      style={{ filter: `drop-shadow(0 0 calc(${4 / k}px * var(--glow)) ${p.glow})` }}
    >
      <path
        d={Y4_LIGHT}
        fill={p.light}
        data-testid="y4-light"
        className={motion ? 'cmap-shift-fill' : undefined}
        style={motion ? ({ '--shift-from': p.light, '--shift-to': p.lightShift } as React.CSSProperties) : undefined}
      />
      <path d={Y4_DARK} fill={p.dark} data-testid="y4-dark" />
    </g>
  );
}

export function EmberArt({ cx, cy, motion }: { cx: number; cy: number; motion: boolean }) {
  return (
    <g data-testid="ember">
      <circle
        cx={cx}
        cy={cy}
        r={EMBER.radius}
        fill="none"
        stroke={EMBER.stroke}
        strokeWidth={1}
        strokeDasharray="2 3"
        data-testid="ember-shell"
      />
      <circle
        cx={cx}
        cy={cy}
        r={EMBER.coreRadius}
        fill={EMBER.core}
        data-testid="ember-core"
        className={motion ? 'cmap-shift-fill' : undefined}
        style={
          motion ? ({ '--shift-from': EMBER.core, '--shift-to': EMBER.coreShift } as React.CSSProperties) : undefined
        }
      />
    </g>
  );
}

/** Thin hairline rings for state: selected / focused (white) and highlighted (gold). */
export function StateRings({
  cx,
  cy,
  r,
  selected,
  highlighted,
}: {
  cx: number;
  cy: number;
  r: number;
  selected: boolean;
  highlighted: boolean;
}) {
  return (
    <>
      {/* keyboard focus ring (shown via .react-flow__node:focus-visible) */}
      <circle className="cmap-focus" cx={cx} cy={cy} r={r + 7} fill="none" stroke="var(--text)" strokeWidth={1} />
      {highlighted && (
        <circle
          cx={cx}
          cy={cy}
          r={r + 5}
          fill="none"
          stroke="var(--highlight)"
          strokeWidth={1}
          data-testid="highlight-ring"
        />
      )}
      {selected && (
        <circle
          cx={cx}
          cy={cy}
          r={r + 3}
          fill="none"
          stroke="var(--text)"
          strokeWidth={1}
          data-testid="selected-ring"
        />
      )}
    </>
  );
}
