import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { ApiProvider } from '../lib/api';
import { AuthProvider } from '../lib/auth';
import { usePrefsEffect } from '../lib/prefs';
import { ToastProvider } from '../ui';
import { AppRoutes } from './AppRoutes';
import { PhoneFrame } from './PhoneFrame';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  usePrefsEffect();
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
