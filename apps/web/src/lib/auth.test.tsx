import type { Session } from '@supabase/supabase-js';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { nameFromEmail, type AuthClient } from './auth';

function fakeSession(meta: Record<string, unknown> = {}): Session {
  return {
    access_token: 'token-123',
    refresh_token: 'r',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email: 'ada.lovelace@example.com',
      app_metadata: {},
      user_metadata: meta,
      aud: 'authenticated',
      created_at: '2026-11-08T00:00:00Z',
    },
  } as Session;
}

/** A small stand-in for `supabase.auth`. */
function fakeAuth(initial: Session | null = null) {
  let listener: ((event: string, s: Session | null) => void) | null = null;
  const client = {
    getSession: vi.fn(async () => ({ data: { session: initial }, error: null })),
    onAuthStateChange: vi.fn((cb: (event: string, s: Session | null) => void) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn(async ({ password }: { email: string; password: string }) =>
      password === 'correct horse'
        ? { data: { session: fakeSession(), user: fakeSession().user }, error: null }
        : { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } },
    ),
    signUp: vi.fn(async () => ({ data: { session: null, user: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return {
    client: client as unknown as AuthClient,
    raw: client,
    emit: (s: Session | null) => listener?.('SIGNED_IN', s),
  };
}

describe('auth flow (mocked Supabase client)', () => {
  it('redirects a signed-out visitor to /login, then back to where they were going after sign-in', async () => {
    const { client, raw } = fakeAuth(null);
    renderApp({ route: '/settings', authClient: client });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'ada.lovelace@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(raw.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada.lovelace@example.com',
      password: 'correct horse',
    });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('shows the Supabase error and stays on /login when the password is wrong', async () => {
    const { client } = fakeAuth(null);
    renderApp({ route: '/login', authClient: client });
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('sign-up sends the display name and asks for email confirmation when Supabase requires it', async () => {
    const { client, raw } = fakeAuth(null);
    renderApp({ route: '/login', authClient: client });
    await userEvent.click(await screen.findByRole('button', { name: /create an account/i }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Your name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long enough pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(raw.signUp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'long enough pw',
      options: { data: { display_name: 'Ada' } },
    });
    expect(await screen.findByText(/check your email to confirm/i)).toBeInTheDocument();
  });

  it('greets a restored session by display name, falling back to the email', async () => {
    const { client } = fakeAuth(fakeSession({ display_name: 'Ada' }));
    renderApp({ route: '/', authClient: client });
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeInTheDocument();
    expect(nameFromEmail('sam.rivera@example.com')).toBe('Sam');
  });

  it('follows auth state changes (e.g. sign-out in another tab)', async () => {
    const { client, emit } = fakeAuth(fakeSession());
    renderApp({ route: '/', authClient: client });
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
    emit(null);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });

  it('mock mode bypasses auth with a demo user', () => {
    renderApp({ route: '/settings' });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('demo@constellate.local')).toBeInTheDocument();
  });
});
