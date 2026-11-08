import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { Button, TextField } from '../ui';

type Mode = 'sign-in' | 'sign-up';

/** `/login` — email + password with a sign-in / sign-up toggle and a plain-language privacy note. */
export function LoginScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (auth.status === 'signed-in' && !auth.mock) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await auth.signIn(email.trim(), password);
        navigate(from, { replace: true });
      } else {
        const { needsConfirmation } = await auth.signUp(email.trim(), password, name);
        if (needsConfirmation) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('sign-in');
        } else navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const signingUp = mode === 'sign-up';
  return (
    <main className="flex h-full flex-col justify-center overflow-y-auto px-6 py-10">
      <div className="mb-8 text-center">
        <p aria-hidden className="mb-3 text-3xl">
          ✦
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{signingUp ? 'Create your account' : 'Sign in'}</h1>
        <p className="text-ink-2 mt-2">A living map of your conversations.</p>
      </div>

      {auth.mock && (
        <p className="mb-4 border border-topic/40 bg-topic/10 p-3 text-sm">
          Demo mode: no account needed — any email and password signs you in as the demo user.
        </p>
      )}
      {!auth.configured && (
        <p role="alert" className="mb-4 border border-flag/50 p-3 text-sm text-flag">
          Sign-in isn’t configured on this build (missing Supabase settings).
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate={false}>
        {signingUp && (
          <TextField
            label="Your name"
            hint="Shown on your home screen. Optional."
            autoComplete="given-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          required
          minLength={signingUp ? 8 : undefined}
          hint={signingUp ? 'At least 8 characters.' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-flag">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-topic">
            {notice}
          </p>
        )}

        <Button type="submit" variant="primary" block disabled={busy || !auth.configured}>
          {busy ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <Button
        variant="ghost"
        className="mt-3 self-center"
        onClick={() => {
          setMode(signingUp ? 'sign-in' : 'sign-up');
          setError(null);
        }}
      >
        {signingUp ? 'Have an account? Sign in' : 'New here? Create an account'}
      </Button>

      <section aria-labelledby="privacy" className="mt-8 border border-line p-4 text-sm text-ink-2">
        <h2 id="privacy" className="mb-1 flex items-center gap-2 font-semibold text-ink">
          <Lock aria-hidden size={16} /> Your privacy
        </h2>
        <p>
          Conversations are private to your account. Recording only starts after everyone agrees. Speech is sent to
          Google (transcription) and Anthropic (topic mapping) for processing. You can delete any conversation, or all
          your data, at any time in Settings.
        </p>
      </section>
    </main>
  );
}
