# AGENTS.md — rules for every coding agent (Claude, Codex, Gemini)

Read this file, then `docs/PLAN.md`, then your brief in `docs/briefs/`. These rules beat anything else you infer.

## The product in one paragraph

Constellate is a phone-first web app that listens to a conversation and grows a live map of its topics: branches, returns to earlier topics (revisits), and threads someone deferred but never picked up. Conversations are saved to the cloud and merged into a cross-conversation "Brain". **The structure of the conversation is the product** — order, branches, returns, loose ends — not a summary. Judging criteria: problem research, technical implementation, design (UI/UX, accessibility), innovation, pitch.

## Workstreams and ownership

You may READ anything. You may WRITE only inside your workstream's paths. Each agent session belongs to exactly one workstream.

| Workstream | Agent | Brief | Owns (write access) |
| --- | --- | --- | --- |
| A0 Foundation | Claude Code | `docs/briefs/a0-foundation.md` | root configs, `.github/workflows/`, `packages/shared` until the contracts freeze, `scripts/build-fixtures.ts`, `supabase/migrations/0001_init.sql` |
| A1 Server + speech | Claude Code | `docs/briefs/a1-server.md` | `apps/server/`, `packages/brain/` (except prompts), `supabase/migrations/` (new files only) |
| A2 Interpreter | Claude Code | `docs/briefs/a2-interpreter.md` | `packages/interpreter/`, `packages/shared/fixtures/transcripts/` and `audio/`, `packages/brain/prompts/`, `scripts/` (except build-fixtures.ts and stt-runner.ts) |
| A3 Map UI | Cursor | `docs/briefs/a3-map-ui.md` | `apps/web/src/features/map/` |
| A4 Shell + Library + Brain UI | Codex | `docs/briefs/a4-shell-library-brain.md` | `apps/web/` except `features/map/` and `features/live/` (i.e. `src/app`, `src/ui`, `src/lib`, `features/library`, `features/brain`, `index.html`, `vite.config.ts`, web `package.json`) |
| A5 QA (tests) | Gemini CLI | `docs/briefs/a5-qa-review.md` | `e2e/`, `playwright.config.ts`, `scripts/stt-runner.ts`, test-only files anywhere when adding coverage for others |
| A6 Live client | Codex | `docs/briefs/a6-live-client.md` | `apps/web/src/features/live/` |
| R Reviewer | Claude Code | `docs/briefs/reviewer.md` | nothing — PR review comments only |

Every agent writes unit tests next to its own code. Need a change in someone else's path? Describe it in your PR under "Deviations / open questions" and the owning workstream makes it.

## Contracts are frozen

`packages/shared/src` (types, zod schemas, the `applyOps` reducer, `placeNode`, the WebSocket protocol, `MODELS`, interpreter interfaces) and the fixtures in `packages/shared/fixtures/{graphs,ops}` are the contract every workstream builds against. After the H1 checkpoint:

- Change them only in a **separate PR labelled `contract`**, containing nothing else.
- **Additive only**: new optional fields, new union members, new helpers. Never rename or remove.
- Both humans approve; afterwards every agent rebases.
- If you need a contract change to proceed, keep working against the current contract with a local adapter and note it in your PR.

Database: never edit an applied migration. Add `supabase/migrations/000N_description.sql` (A1 only).

## Hard rules

1. **No secrets in the browser.** `apps/web` must never import AI SDKs or server packages (ESLint enforces this) and never reads non-`VITE_` env vars. Never commit `.env`, keys, tokens or real recordings.
2. **Model ids live only in `MODELS`** (`packages/shared/src/config.ts`). Never type a model id anywhere else, never invent one.
3. **Never fake data in the product.** Demo data comes from running fixtures through the real pipeline (`scripts/seed-demo.ts`). Fixtures are for tests and mock mode.
4. **The replay path must keep working**: transcript replay and WAV replay exercise the same code as the microphone. Don't build a feature the replay path can't exercise.
5. **Every behaviour change has a test that fails without it.** A feature without a test is not done.
6. **Accessibility is a requirement**, not polish: labelled controls, visible focus, 44 px targets, `prefers-reduced-motion`, never colour alone for meaning (see the design section of the plan).
7. **Ambiguity**: choose the simpler option, write the question in your PR, keep moving. Stuck 20 minutes on one thing? Write the blocker in the PR and move to your next task.

## API budget (read before any API call)

Real limits on our keys, checked in AI Studio on 2026-11-07:

| Need | Model | Our limit | Rule |
| --- | --- | --- | --- |
| All reasoning: live interpreter, finalisation, Brain merge | Claude via `MODELS.interpreter.anthropic`, `MODELS.refine`, `MODELS.brain` | $200/month credit | **The only reasoning provider.** `INTERPRETER_PROVIDER=anthropic` everywhere, including the eval. |
| Live speech-to-text | `MODELS.sttLive` (`gemini-3.5-transcribe-live`) | Unlimited requests | Use freely for speech tests (never in CI). |
| Embeddings | `MODELS.embed` (`gemini-embedding-2`) | 100/min, 30K tokens/min, **1,000/day** | Batch, cache by text hash, embed a node only when created or relabelled. Optional: on 429 or quota, skip and degrade. |
| Gemini text models | `gemini-3.8-flash` and every other Gemini text model | **20/day** (5/min) | **Never call them.** Not in the eval, not as a fallback, not in tests. |
| File transcription with speaker labels | `MODELS.sttFile` (`gemini-3.5-transcribe`) | Not available on our key | Finalisation keeps the live transcript with empty `speakers`. Check with `models.list` before relying on it. |
| Text-to-speech | `MODELS.tts` | Not available; other TTS models are 10/day | **Don't render test audio.** Humans supply WAVs in `packages/shared/fixtures/audio/`. |

- **Unit tests and CI never call any real API.** Use fakes or recorded responses (`eval:replay`).
- **Cache every Gemini response** by a hash of its input (`eval/recordings` for the eval; memory + disk on the server), so repeat runs cost nothing.
- **Develop with transcript replay.** Use the microphone or WAV replay for deliberate speech tests only.
- **On HTTP 429 or quota errors, back off and degrade, never crash**: keep captions flowing, skip revisit candidates for that window, and log it.
- Every Gemini call goes through one shared client that counts requests per model and logs running totals, so the humans can see usage.

## Commands

```bash
pnpm install                 # once (Node 22, pnpm 10 via corepack)
pnpm verify                  # lint + typecheck + unit tests — run before EVERY commit
pnpm dev:web                 # http://localhost:5173 (VITE_USE_MOCKS=1 → no server needed)
pnpm dev:server              # http://localhost:8787/health
pnpm e2e                     # Playwright, mock mode, Pixel 7 + iPhone 14
pnpm fixtures                # regenerate graph/op fixtures (A0 only)
pnpm eval / pnpm eval:replay # interpreter evaluation (A2)
pnpm --filter @constellate/<pkg> test   # one package
```

Environment: copy `.env.example` to `.env` at the repo root. Humans fill in keys; agents never ask for or print them.

## Git workflow

- One **git worktree and branch per agent**: `git worktree add ../constellate-a1 -b ws/a1-server origin/main` (names: `ws/a1-server`, `ws/a2-interpreter`, `ws/a3-map`, `ws/a4-shell`, `ws/a5-qa`, `ws/a6-live`).
- Small commits with clear messages: `a3: revisit edge component with dashed arc`.
- Open a PR to `main` at least every **90 minutes** (`gh pr create --fill`), using the PR template. Rebase on `origin/main` before opening (`git fetch && git rebase origin/main`).
- Merge needs: CI green + one human approval. Squash merge. Delete the branch, keep the worktree, rebase it on `main`, continue.
- **Dependencies and the lockfile**: add a dependency only to your own package's `package.json` (`pnpm --filter @constellate/<pkg> add <dep>`). If `pnpm-lock.yaml` conflicts on rebase, never hand-merge it: take `main`'s version (`git checkout --theirs pnpm-lock.yaml` during a rebase), run `pnpm install`, and commit the regenerated lockfile.
- Never force-push `main`. Never merge your own PR without approval.

## Definition of done (any task)

- [ ] Matches the brief and the contracts; only owned paths changed
- [ ] Tests added; `pnpm verify` green
- [ ] PR description has evidence: screenshot (UI), eval report path (interpreter), or test names
- [ ] Deviations from `docs/PLAN.md` stated

## Checkpoints (both humans merge and run the main loop on `main`)

| Hour | Gate |
| --- | --- |
| H1 | Contracts frozen: `pnpm verify` green, both apps start, fixtures load |
| H3 | Replay → map: web renders the fixture map in mock mode; server streams a transcript fixture to a test client; first eval report |
| H5 | Live mic → nodes on the deployed app within ~25 s; reload from the database works |
| H8 | Feature complete on the real stack; interpreter release gate met (≥ 8/10 scenarios, median latency < 3 s) |
| H10 | Code freeze: bug fixes, copy, polish, tests only; seed demo data; record the backup video |
