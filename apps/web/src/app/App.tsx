import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './AppRoutes';
import { PhoneFrame } from './PhoneFrame';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PhoneFrame>
          <AppRoutes />
        </PhoneFrame>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
