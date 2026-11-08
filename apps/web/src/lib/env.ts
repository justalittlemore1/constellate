/** Public, browser-safe configuration. Never add secrets here. */
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  serverWsUrl: import.meta.env.VITE_SERVER_WS_URL ?? 'ws://localhost:8787/live',
  serverHttpUrl: import.meta.env.VITE_SERVER_HTTP_URL ?? 'http://localhost:8787',
  /** run against fixtures and recorded op streams, with no server or Supabase */
  useMocks: import.meta.env.VITE_USE_MOCKS === '1',
} as const;
