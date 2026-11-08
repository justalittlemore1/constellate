/**
 * Route builders shared across workstreams. Live routes follow A6's `LiveRoute`:
 * `/live/new` records from the microphone; `/live/demo?fixture=<id>` replays a transcript fixture
 * on the server (`hello` with `source: 'replay-transcript'`).
 */
export const DEMO_REPLAY_FIXTURE = 'demo-religion';

export const routes = {
  home: '/',
  login: '/login',
  newLive: () => '/live/new',
  demoLive: (fixture: string = DEMO_REPLAY_FIXTURE) => `/live/demo?fixture=${encodeURIComponent(fixture)}`,
  conversation: (id: string, opts: { node?: string; at?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.node) q.set('node', opts.node);
    if (opts.at !== undefined) q.set('t', String(Math.max(0, Math.round(opts.at))));
    const s = q.toString();
    return `/c/${id}${s ? `?${s}` : ''}`;
  },
  brain: '/brain',
  favorites: '/favorites',
  settings: '/settings',
} as const;
