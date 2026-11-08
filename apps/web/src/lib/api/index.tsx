import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAuth } from '../auth';
import { env } from '../env';
import { loadDemoGraph, loadMockDemos } from '../fixtures';
import { supabase } from '../supabase';
import { createMockApi } from './mockApi';
import { createRealApi } from './realApi';
import type { Api } from './types';

export * from './types';
export { createMockApi } from './mockApi';
export { createRealApi, ApiError } from './realApi';
export { mockBrainFromGraphs } from './mockBrain';

/**
 * Mock mode (VITE_USE_MOCKS=1): the contract demo graph plus the three exported demo conversations,
 * with their transcripts. `createMockApi()`'s own default stays the demo graph alone, for unit tests.
 */
export function createMockModeApi(): Api {
  const demos = loadMockDemos();
  return createMockApi([loadDemoGraph(), ...demos.map((d) => d.graph)], {
    utterances: Object.fromEntries(demos.map((d) => [d.graph.conversation.id, d.utterances])),
  });
}

let mockSingleton: Api | null = null;
function sharedMockApi(): Api {
  return (mockSingleton ??= createMockModeApi());
}

const ApiContext = createContext<Api | null>(null);

/**
 * Provides the data API for the signed-in user: the in-memory fixture API in mock mode, otherwise
 * Supabase + the server REST API with the user's access token. Tests pass `api` directly.
 */
export function ApiProvider({ children, api }: { children: ReactNode; api?: Api }) {
  const auth = useAuth();
  const value = useMemo<Api | null>(() => {
    if (api) return api;
    if (auth.mock) return sharedMockApi();
    if (!supabase || !auth.user || !auth.accessToken) return null;
    return createRealApi({
      supabase,
      serverHttpUrl: env.serverHttpUrl,
      userId: auth.user.id,
      accessToken: auth.accessToken,
    });
  }, [api, auth.mock, auth.user, auth.accessToken]);

  // never show one account's cached rows to the next one
  const qc = useQueryClient();
  const userId = auth.user?.id ?? null;
  const lastUser = useRef(userId);
  useEffect(() => {
    if (lastUser.current !== userId) qc.clear();
    lastUser.current = userId;
  }, [qc, userId]);

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi needs a signed-in user inside <ApiProvider>');
  return api;
}
