import { cx } from '../ui';

/**
 * "F4: filaments ending in stars" — the Home record button art (wave 2). Geometry in a 120×120
 * box centred at 0,0: six fine filaments, each tipped with a small star, around a bright core.
 * The filament group turns once per ~26 s and the core shifts slowly between two close warm
 * whites; both stop under reduced motion (`still`, and the global reduced-motion CSS).
 */
export const FILAMENTS: readonly { from: [number, number]; to: [number, number]; tip: number }[] = [
  { from: [0, -11], to: [0, -48], tip: 1.8 },
  { from: [10, -5], to: [40, -23], tip: 1.4 },
  { from: [8, 8], to: [30, 34], tip: 1.6 },
  { from: [-3, 11], to: [-12, 50], tip: 1.3 },
  { from: [-10, 4], to: [-46, 16], tip: 1.7 },
  { from: [-8, -8], to: [-30, -36], tip: 1.5 },
];

export const RECORD_STAR_COLOURS = {
  filament: '#FFD58A',
  tip: '#FFF6E0',
  core: '#FFF3D6',
  centre: '#fff',
} as const;

export function RecordStar({ still, className }: { still: boolean; className?: string }) {
  return (
    <svg
      viewBox="-60 -60 120 120"
      aria-hidden
      focusable="false"
      data-testid="record-star"
      data-still={still ? 'true' : 'false'}
      className={cx('overflow-visible', className)}
    >
      <g data-part="filaments" className={still ? undefined : 'record-star-spin'}>
        {FILAMENTS.map((f, i) => (
          <g key={i}>
            <line
              x1={f.from[0]}
              y1={f.from[1]}
              x2={f.to[0]}
              y2={f.to[1]}
              stroke={RECORD_STAR_COLOURS.filament}
              strokeWidth={0.8}
              strokeOpacity={0.75}
              strokeLinecap="round"
            />
            <circle cx={f.to[0]} cy={f.to[1]} r={f.tip} fill={RECORD_STAR_COLOURS.tip} data-part="tip" />
          </g>
        ))}
      </g>
      <circle
        r={10}
        fill={RECORD_STAR_COLOURS.core}
        data-part="core"
        className={still ? undefined : 'record-star-core'}
      />
      <circle r={4.5} fill={RECORD_STAR_COLOURS.centre} data-part="centre" />
    </svg>
  );
}
