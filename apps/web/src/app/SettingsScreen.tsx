import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN, usePrefs } from '../lib/prefs';
import { routes } from '../lib/routes';
import { Button, ScreenHeader, Sheet, TextField, Toggle, useToast } from '../ui';

const CONFIRM_WORD = 'DELETE';

/** `/settings` — reduce motion, low-stimulation mode, text size, sign out, delete my data. */
export function SettingsScreen() {
  const prefs = usePrefs();
  const auth = useAuth();
  const navigate = useNavigate();
  const sizeId = useId();
  const [confirming, setConfirming] = useState(false);

  return (
    <main className="flex h-full flex-col">
      <ScreenHeader title="Settings" />
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <section aria-labelledby="display-h" className="mb-8">
          <h2 id="display-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
            Display
          </h2>
          <Toggle
            label="Reduce motion"
            description="Stops pulses, moving particles and the twinkling starfield."
            checked={prefs.reduceMotion}
            onChange={(v) => prefs.set({ reduceMotion: v })}
          />
          <Toggle
            label="Low-stimulation mode"
            description="Hides the starfield, softens glow and stills animation."
            checked={prefs.lowStimulation}
            onChange={(v) => prefs.set({ lowStimulation: v })}
          />
          <div className="py-3">
            <div className="flex items-center justify-between">
              <label htmlFor={sizeId} className="font-semibold">
                Text size
              </label>
              <output htmlFor={sizeId} className="text-ink-2">
                {Math.round(prefs.textSize * 100)} %
              </output>
            </div>
            <input
              id={sizeId}
              type="range"
              min={TEXT_SIZE_MIN}
              max={TEXT_SIZE_MAX}
              step={0.05}
              value={prefs.textSize}
              aria-valuetext={`${Math.round(prefs.textSize * 100)} percent`}
              onChange={(e) => prefs.set({ textSize: Number(e.target.value) })}
              className="h-11 w-full accent-[var(--topic)]"
            />
            <p className="text-sm text-ink-2">Applies everywhere, including labels on the map.</p>
          </div>
        </section>

        <section aria-labelledby="account-h" className="mb-8">
          <h2 id="account-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
            Account
          </h2>
          {auth.user && (
            <p className="mb-3 text-sm text-ink-2">
              Signed in as <span className="text-ink">{auth.user.email}</span>
              {auth.mock && ' (demo mode)'}
            </p>
          )}
          <Button
            icon={<LogOut aria-hidden size={18} />}
            onClick={async () => {
              await auth.signOut();
              navigate(routes.login);
            }}
          >
            Sign out
          </Button>
        </section>

        <section aria-labelledby="privacy-h">
          <h2 id="privacy-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
            Privacy
          </h2>
          <p className="mb-3 text-sm text-ink-2">
            Permanently deletes every conversation, recording, transcript, map, folder and Brain concept in your
            account. This can’t be undone.
          </p>
          <Button variant="danger" icon={<Trash2 aria-hidden size={18} />} onClick={() => setConfirming(true)}>
            Delete my data
          </Button>
        </section>
      </div>

      <DeleteDataSheet open={confirming} onClose={() => setConfirming(false)} />
    </main>
  );
}

function DeleteDataSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const auth = useAuth();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMyData();
      qc.clear();
      toast('All your data was deleted.', 'success');
      onClose();
      if (!auth.mock) {
        await auth.signOut();
        navigate(routes.login);
      } else navigate(routes.home);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed. Nothing more was removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Delete all your data?">
      <p className="mb-4 text-sm">
        Every conversation, recording, transcript, map, folder and Brain concept will be permanently deleted. Type{' '}
        <strong>{CONFIRM_WORD}</strong> to confirm.
      </p>
      <TextField
        label={`Type ${CONFIRM_WORD} to confirm`}
        autoCapitalize="characters"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-flag">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="danger" disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || busy} onClick={confirm}>
          {busy ? 'Deleting…' : 'Delete everything'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
