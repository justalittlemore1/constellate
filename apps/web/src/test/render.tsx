import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AppRoutes } from '../app/AppRoutes';
import { ApiProvider, createMockApi, type Api } from '../lib/api';
import { AuthProvider, type AuthClient } from '../lib/auth';
import { ToastProvider } from '../ui';

export interface RenderOptions {
  route?: string;
  api?: Api;
  /** omit for mock mode (demo user signed in) */
  authClient?: AuthClient;
  /** defaults to true when no `authClient` is given */
  mock?: boolean;
  /** render this element instead of the full route table */
  element?: ReactElement;
  /** path pattern for `element` (default: matches anything) */
  path?: string;
}

/** Shows the current location so tests can assert navigation. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

export function renderApp({
  route = '/',
  api = createMockApi(),
  authClient,
  mock,
  element,
  path = '*',
}: RenderOptions = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider client={authClient ?? null} mock={mock ?? !authClient}>
        <ApiProvider api={api}>
          <MemoryRouter initialEntries={[route]}>
            <ToastProvider>
              {element ? (
                <Routes>
                  <Route path={path} element={element} />
                </Routes>
              ) : (
                <AppRoutes />
              )}
              <LocationProbe />
            </ToastProvider>
          </MemoryRouter>
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, api, qc };
}
