import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiProvider, createMockApi } from '../lib/api';
import { AuthProvider } from '../lib/auth';
import { env } from '../lib/env';
import { ToastProvider } from '../ui';
import { AppRoutes } from './AppRoutes';

/** The app as mock mode mounts it: no `mockStartSignedIn` prop, so the env default applies. */
function mockModeApp(props: { mockStartSignedIn?: boolean } = {}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider client={null} mock {...props}>
        <ApiProvider api={createMockApi()}>
          <MemoryRouter initialEntries={['/']}>
            <ToastProvider>
              <AppRoutes />
            </ToastProvider>
          </MemoryRouter>
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('mock mode starts signed out (rehearsals and filming begin at sign-in)', () => {
  it('without VITE_MOCK_SIGNED_IN, opens on the sign-in screen with labelled fields and the heading focused', async () => {
    expect(env.mockSignedIn).toBe(false);
    render(mockModeApp());
    const heading = await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(heading).toHaveFocus(); // announced first; no phone keyboard pops up on camera
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('any email and password signs in and reaches Home', async () => {
    const user = userEvent.setup();
    render(mockModeApp());
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    await user.tab(); // from the heading, Tab goes straight to Email
    expect(screen.getByLabelText('Email')).toHaveFocus();
    await user.keyboard('anyone@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Demo' })).toBeInTheDocument();
  });

  it('a reload starts signed out again (kept in memory only)', async () => {
    const user = userEvent.setup();
    const first = render(mockModeApp());
    await user.type(await screen.findByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Welcome, Demo' });
    first.unmount();
    render(mockModeApp());
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('opting in (mockStartSignedIn, i.e. VITE_MOCK_SIGNED_IN=1) starts at Home as the demo user', async () => {
    render(mockModeApp({ mockStartSignedIn: true }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Demo' })).toBeInTheDocument();
  });
});
