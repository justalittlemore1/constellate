import { Link, Outlet, Route, Routes } from 'react-router';
import { LiveRoute } from '../features/live';
import { RequireAuth } from '../lib/auth';
import { HomeScreen } from './HomeScreen';
import { LoginScreen } from './LoginScreen';
import { SettingsScreen } from './SettingsScreen';

/**
 * Route table. Owner: A4. Every route except /login requires a session (mock mode signs in a
 * demo user). Placeholders name the workstream that replaces them.
 *   /login        A4  email + password
 *   /             A4  Home: starfield, Welcome, mic orb, library drawer, Generate Brain
 *   /live/:id     A6  live screen (map from A3), captions, Flag / Park a thought / Stop
 *                     `/live/new` starts a recording; `/live/new?replay=<fixture>` a transcript replay
 *   /c/:id        A3  saved map, playback, toolbar · A4 Diary sheet
 *   /brain        A4  galaxy view + concept sheet
 *   /favorites    A4  highlights and flagged moments
 *   /settings     A4  reduce motion, low-stimulation, text size, delete my data
 */
export function AppRoutes() {
  return (
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
        <Route path="/c/:id" element={<Placeholder title="Conversation" owner="A3 + A4" />} />
        <Route path="/brain" element={<Placeholder title="Brain" owner="A4" />} />
        <Route path="/favorites" element={<Placeholder title="Favourites" owner="A4" />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-ink-2">That page drifted out of the constellation.</p>
      <Link to="/" className="inline-flex min-h-11 items-center text-topic underline">
        Go home
      </Link>
    </main>
  );
}

function Placeholder({ title, owner }: { title: string; owner: string }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-ink-2 text-sm">Placeholder — built by {owner}.</p>
      <Link to="/" className="inline-flex min-h-11 items-center text-topic underline">
        Home
      </Link>
    </main>
  );
}
