import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { ApiProvider } from '../lib/api';
import { AuthProvider } from '../lib/auth';
import { missingConfig } from '../lib/env';
import { usePrefsEffect } from '../lib/prefs';
import { ToastProvider } from '../ui';
import { AppRoutes } from './AppRoutes';
import { PhoneFrame } from './PhoneFrame';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  usePrefsEffect();
  const missing = missingConfig();
  if (missing.length > 0) return <ConfigError missing={missing} />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiProvider>
          <BrowserRouter>
            <PhoneFrame>
              <ToastProvider>
                <AppRoutes />
              </ToastProvider>
            </PhoneFrame>
          </BrowserRouter>
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** A real build without its public settings must say so, not run against localhost. */
export function ConfigError({ missing }: { missing: string[] }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">Constellate isn’t configured</h1>
      <p className="text-ink-2">This build is missing settings it needs to reach its server:</p>
      <ul className="font-mono text-sm">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </main>
  );
}
