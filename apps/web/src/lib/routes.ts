/**
 * Route builders shared across workstreams. The live screen (A6) reads `?replay=<fixture id>` to
 * start a transcript replay (`hello` with `source: 'replay-transcript'`) instead of the microphone.
 */
export const DEMO_REPLAY_FIXTURE = 'demo-religion';

export const routes = {
  home: '/',
  login: '/login',
  newLive: () => '/live/new',
  demoLive: (fixture: string = DEMO_REPLAY_FIXTURE) => `/live/new?replay=${encodeURIComponent(fixture)}`,
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
