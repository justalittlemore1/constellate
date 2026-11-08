import { Menu, Mic, Play, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LibraryDrawer } from '../features/library/LibraryDrawer';
import { useUser } from '../lib/auth';
import { useMotionReduced, usePrefs } from '../lib/prefs';
import { routes } from '../lib/routes';
import { uiFlag } from '../lib/uiFlags';
import { Button, IconButton, cx } from '../ui';
import { RecordStar } from './RecordStar';
import { Starfield } from './Starfield';

/** `/` — starfield, welcome, the microphone orb, a demo replay, and the library drawer. */
export function HomeScreen() {
  const user = useUser();
  const navigate = useNavigate();
  const lowStim = usePrefs((s) => s.lowStimulation);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const showHint = uiFlag('homeOrbHint');
  const reduced = useMotionReduced();

  return (
    <main className="relative flex h-full flex-col overflow-hidden">
      {!lowStim && <Starfield />}

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-10 px-6 pt-14 text-center">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Welcome, {user.name}</h1>
          {uiFlag('homeTagline') && <p className="text-ink-2 mt-3">Where will your conversation take you?</p>}
        </div>

        <div className="flex flex-col items-center gap-4">
          {/* A6's live screen asks everyone for consent before any audio is captured */}
          {uiFlag('homeMicOrb') ? (
            <button
              type="button"
              aria-label="Start a conversation"
              aria-describedby={showHint ? 'orb-hint' : undefined}
              onClick={() => navigate(routes.newLive())}
              className={cx(
                'flex size-32 items-center justify-center rounded-full border border-topic/50 bg-topic/10 text-topic hover:bg-topic/20',
                uiFlag('homeOrbPulse') ? 'orb' : 'orb-still',
              )}
            >
              <Mic aria-hidden size={48} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Start recording"
              aria-describedby={showHint ? 'orb-hint' : undefined}
              onClick={() => navigate(routes.newLive())}
              className="flex size-36 items-center justify-center rounded-full"
            >
              <RecordStar still={reduced} className="size-36" />
            </button>
          )}
          {showHint && (
            <p id="orb-hint" className="text-ink-2 text-sm">
              Tap to start. Everyone is asked to agree first.
            </p>
          )}
        </div>

        <Button variant="secondary" icon={<Play aria-hidden size={18} />} onClick={() => navigate(routes.demoLive())}>
          Try a demo conversation
        </Button>
      </div>

      {/* after the main content in the DOM so the first Tab lands on the primary action; drawn on top */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <IconButton label="Open menu" aria-haspopup="dialog" onClick={() => setLibraryOpen(true)}>
          <Menu aria-hidden size={24} />
        </IconButton>
        {uiFlag('homeSettingsButton') && (
          <IconButton label="Settings" onClick={() => navigate(routes.settings)}>
            <Settings aria-hidden size={22} />
          </IconButton>
        )}
      </header>

      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </main>
  );
}
