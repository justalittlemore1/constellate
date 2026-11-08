import { Link, Outlet, Route, Routes } from 'react-router';
import { BrainScreen } from '../features/brain/BrainScreen';
import { FavoritesScreen } from '../features/library/FavoritesScreen';
import { LiveRoute } from '../features/live';
import { RequireAuth } from '../lib/auth';
import { ConversationScreen } from './ConversationScreen';
import { HomeScreen } from './HomeScreen';
import { LoginScreen } from './LoginScreen';
import { NowPlayingBar } from './NowPlayingBar';
import { SettingsScreen } from './SettingsScreen';

/**
 * Route table. Owner: A4. Every route except /login requires a session (mock mode signs in a
 * demo user).
 *   /login        A4  email + password
 *   /             A4  Home: starfield, Welcome, mic orb, library drawer, Generate Brain
 *   /live/:id     A6  live screen (map from A3), captions, Flag / Park a thought / Stop
 *                     `/live/new` records; `/live/demo?fixture=<id>` replays a transcript fixture
 *   /c/:id        A3  saved map, playback, toolbar · A4 Diary sheet
 *   /brain        A4  galaxy view + concept sheet
 *   /favorites    A4  highlights and flagged moments
 *   /settings     A4  reduce motion, low-stimulation, text size, delete my data
 */
export function AppRoutes() {
  return (
    <>
      {/* the one now-playing bar (transcript playback when there's no recording) */}
      <NowPlayingBar />
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route
          element={
            <RequireAuth>
              <Outlet />
            </RequireAuth>
          }
        >
          <Route path="/" element={<HomeScreen />} />
          <Route path="/live/:id" element={<LiveRoute />} />
          <Route path="/c/:id" element={<ConversationScreen />} />
          <Route path="/brain" element={<BrainScreen />} />
          <Route path="/favorites" element={<FavoritesScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-ink-2">That page drifted out of the constellation.</p>
      <Link to="/" className="hover-wash inline-flex min-h-11 items-center px-2 text-topic underline">
        Go home
      </Link>
    </main>
  );
}
