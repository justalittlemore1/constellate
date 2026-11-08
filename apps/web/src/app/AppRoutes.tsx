import { Mic } from 'lucide-react';
import { Link, Route, Routes } from 'react-router';

/**
 * Route table. Owner: A4. Each placeholder names the workstream that replaces it.
 *   /login        A4  email + password
 *   /             A4  Home: starfield, Welcome, mic orb, library drawer, Generate Brain
 *   /live/:id     A3  live map, captions, Flag / Park a thought / Stop
 *   /c/:id        A3  saved map, playback, toolbar · A4 Diary sheet
 *   /brain        A4  galaxy view + concept sheet
 *   /favorites    A4  highlights and flagged moments
 *   /settings     A4  reduce motion, low-stimulation, text size, delete my data
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Placeholder title="Sign in" owner="A4" />} />
      <Route path="/live/:id" element={<Placeholder title="Live map" owner="A3" />} />
      <Route path="/c/:id" element={<Placeholder title="Conversation" owner="A3 + A4" />} />
      <Route path="/brain" element={<Placeholder title="Brain" owner="A4" />} />
      <Route path="/favorites" element={<Placeholder title="Favourites" owner="A4" />} />
      <Route path="/settings" element={<Placeholder title="Settings" owner="A4" />} />
      <Route path="*" element={<Placeholder title="Not found" owner="A4" />} />
    </Routes>
  );
}

function Home() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-10 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Welcome</h1>
      <button
        type="button"
        aria-label="Start a conversation"
        className="flex size-28 items-center justify-center rounded-full border border-topic/40 bg-topic/10 text-topic"
      >
        <Mic aria-hidden size={40} />
      </button>
      <p className="text-ink-2 text-sm">Where will your conversations take you?</p>
    </main>
  );
}

function Placeholder({ title, owner }: { title: string; owner: string }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-ink-2 text-sm">Placeholder — built by {owner}.</p>
      <Link to="/" className="text-topic underline">
        Home
      </Link>
    </main>
  );
}
