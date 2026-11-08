/** Public, browser-safe configuration. Never add secrets here. */
type PublicEnv = Partial<
  Record<
    | 'VITE_SUPABASE_URL'
    | 'VITE_SUPABASE_ANON_KEY'
    | 'VITE_SERVER_WS_URL'
    | 'VITE_SERVER_HTTP_URL'
    | 'VITE_USE_MOCKS'
    | 'VITE_MOCK_SIGNED_IN',
    string
  >
> & {
  PROD?: boolean;
};

const raw = import.meta.env as PublicEnv;

/** Settings a real (non-mock) production build cannot run without. */
export const REQUIRED_IN_PRODUCTION = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SERVER_WS_URL',
  'VITE_SERVER_HTTP_URL',
] as const;

/**
 * Names of required settings that are missing. Empty in mock mode and in development (where the
 * localhost defaults apply); in a production build they must be set explicitly, so a missing
 * server URL can't quietly point phones at `localhost`.
 */
export function missingConfig(e: PublicEnv = raw): string[] {
  if (e.VITE_USE_MOCKS === '1' || !e.PROD) return [];
  return REQUIRED_IN_PRODUCTION.filter((k) => !e[k]?.trim());
}

const devDefault = (v: string | undefined, fallback: string) => v || (raw.PROD ? '' : fallback);

export const env = {
  supabaseUrl: raw.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: raw.VITE_SUPABASE_ANON_KEY ?? '',
  serverWsUrl: devDefault(raw.VITE_SERVER_WS_URL, 'ws://localhost:8787/live'),
  serverHttpUrl: devDefault(raw.VITE_SERVER_HTTP_URL, 'http://localhost:8787'),
  /** run against fixtures and recorded op streams, with no server or Supabase */
  useMocks: raw.VITE_USE_MOCKS === '1',
  /**
   * mock mode only: start signed in as the demo user (e2e sets it). Without it mock mode starts
   * signed out on every load, so rehearsals and filming begin at the sign-in screen.
   */
  mockSignedIn: raw.VITE_MOCK_SIGNED_IN === '1',
} as const;
