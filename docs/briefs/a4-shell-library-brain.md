# A4 Shell + Library + Brain UI

**Agent:** Codex · **Human:** H2 · **Branch:** `ws/a4-shell` · **Owns:** everything in `apps/web/` except `features/map/` and `features/live/`

Read first: `docs/PLAN.md` → Interface and interaction design (tokens, screens and routes, accessibility, phone simulation), The Brain → View. Current scaffold: `src/app/{App,AppRoutes,PhoneFrame}.tsx`, `src/ui/tokens.css`, `src/lib/{env,supabase,fixtures}.ts`.

## Phase 1 (H1–H4): shell

- [ ] `src/ui/`: primitives (Button, IconButton, Sheet/bottom sheet with focus trap, Chip, Toast, Toggle) on the tokens; 44 px targets; visible focus.
- [ ] Auth: `/login` email + password (sign up / sign in toggle, privacy note), Supabase session provider, protected routes; mock mode bypasses auth with a demo user.
- [ ] Home: starfield canvas (static when reduced motion or low-stimulation), "Welcome, {name}", pulsing mic orb → consent → `/live/new`, "Try a demo conversation" (transcript replay), hamburger → library drawer.
- [ ] PWA: `vite-plugin-pwa` manifest (name, icons, `display: standalone`, theme `#070A17`), installable on phones.
- [ ] Deploy to Vercel (root `apps/web`, build `pnpm --filter @constellate/web build`, env `VITE_*`). Share the URL.

## Phase 2 (H4–H7): library and diary

- [ ] Library drawer: Generate Brain button pinned at top, search by title, Favourites, folders (create/rename/delete, move conversation), recent conversations with Solo / Group tags. TanStack Query on Supabase tables directly (RLS protects them).
- [ ] Diary sheet on `/c/:id`: title, date, duration, participants (add names), place, reflection prompt "What do you want to remember from this?", Open threads, Promises (if-then phrasing "When ___, I will ___"), Recall cards (answer first, then reveal node + audio).
- [ ] `/favorites`: highlighted nodes/branches and flagged moments, each playable.
- [ ] `/settings`: reduce motion, low-stimulation mode, text size 100–150 % (sets `--text-size`), delete my data.

## Phase 3 (H7–H10): Brain

- [ ] `/brain`: `react-force-graph-2d`; link distance `40 + 160·(1 − w)`, radius `6 + 3·√mentionCount`, labels for the 15 largest + on focus; tap → dim non-neighbours + concept sheet (occurrences: date, title, participants, summary, play at `startMs`, "Open in map"); concept search. Data from `GET /brain`; "Generate Brain" calls `POST /brain/rebuild` with progress.

## Tests (required)

Auth flow with a mocked Supabase client; drawer CRUD; diary edits persist; settings toggle reduced motion; Brain renders the fixture payload and opens the sheet by keyboard.
