import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { env } from './env';
import { loadDemoGraph } from './fixtures';
import { supabase } from './supabase';

/** The slice of `supabase.auth` the app uses (lets tests pass a small fake). */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithPassword' | 'signUp' | 'signOut'
>;

export interface AuthUser {
  id: string;
  email: string;
  /** display name for "Welcome, {name}" */
  name: string;
}

export interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  user: AuthUser | null;
  /** Supabase access token for the server REST API (null in mock mode) */
  accessToken: string | null;
  /** mock mode: no Supabase; any email and password signs in as the demo user */
  mock: boolean;
  /** false when neither mock mode nor Supabase settings are available */
  configured: boolean;
  signIn(email: string, password: string): Promise<void>;
  /** resolves `needsConfirmation: true` when Supabase requires an email confirmation first */
  signUp(email: string, password: string, name: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

/** Mock mode signs in as the owner of the fixture conversations. */
export function demoUser(): AuthUser {
  return { id: loadDemoGraph().conversation.userId, email: 'demo@constellate.local', name: 'Demo' };
}

export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const word = local.split(/[._+-]/)[0] ?? '';
  return word ? word[0]!.toUpperCase() + word.slice(1) : 'there';
}

function userFromSession(session: Session): AuthUser {
  const u = session.user;
  const email = u.email ?? '';
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    typeof meta.display_name === 'string' && meta.display_name.trim() ? meta.display_name.trim() : nameFromEmail(email);
  return { id: u.id, email, name };
}

const AuthContext = createContext<AuthState | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** defaults to the app's Supabase client (null in mock mode) */
  client?: AuthClient | null;
  /** defaults to `VITE_USE_MOCKS=1` */
  mock?: boolean;
  /** mock mode: start signed in (default `VITE_MOCK_SIGNED_IN=1`); otherwise every load starts signed out */
  mockStartSignedIn?: boolean;
}

export function AuthProvider({
  children,
  client = supabase?.auth ?? null,
  mock = env.useMocks,
  mockStartSignedIn = env.mockSignedIn,
}: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  // kept in memory only, so a reload in mock mode returns to /login
  const [mockSignedIn, setMockSignedIn] = useState(mockStartSignedIn);
  const [loading, setLoading] = useState(!mock && client !== null);

  useEffect(() => {
    if (mock || !client) return;
    let alive = true;
    void client.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = client.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client, mock]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (mock) {
        setMockSignedIn(true);
        return;
      }
      if (!client) throw new Error('Sign-in is not configured.');
      const { data, error } = await client.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      setSession(data.session);
    },
    [client, mock],
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      if (mock) {
        setMockSignedIn(true);
        return { needsConfirmation: false };
      }
      if (!client) throw new Error('Sign-up is not configured.');
      const { data, error } = await client.signUp({
        email,
        password,
        options: { data: { display_name: name.trim() || undefined } },
      });
      if (error) throw new Error(error.message);
      if (data.session) setSession(data.session);
      return { needsConfirmation: !data.session };
    },
    [client, mock],
  );

  const signOut = useCallback(async () => {
    if (mock) {
      setMockSignedIn(false);
      return;
    }
    await client?.signOut();
    setSession(null);
  }, [client, mock]);

  const value = useMemo<AuthState>(() => {
    const base = { mock, configured: mock || client !== null, signIn, signUp, signOut };
    if (mock) {
      return mockSignedIn
        ? { ...base, status: 'signed-in', user: demoUser(), accessToken: null }
        : { ...base, status: 'signed-out', user: null, accessToken: null };
    }
    if (loading) return { ...base, status: 'loading', user: null, accessToken: null };
    if (!session) return { ...base, status: 'signed-out', user: null, accessToken: null };
    return { ...base, status: 'signed-in', user: userFromSession(session), accessToken: session.access_token };
  }, [mock, client, signIn, signUp, signOut, mockSignedIn, loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Signed-in user (only call below <RequireAuth>). */
export function useUser(): AuthUser {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called while signed out');
  return user;
}

/** Route guard: redirects to /login (remembering where the user was going). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') {
    return (
      <main className="flex h-full items-center justify-center">
        <p role="status" className="text-ink-2">
          Loading…
        </p>
      </main>
    );
  }
  if (auth.status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
