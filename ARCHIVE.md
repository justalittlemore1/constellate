
## Quick start

```bash
corepack enable          # pnpm 10
pnpm install
cp .env.example .env     # VITE_USE_MOCKS=1 runs the web app with no server or keys
pnpm dev:web             # http://localhost:5173
pnpm dev:server          # http://localhost:8787/health
pnpm verify              # lint + typecheck + unit tests
pnpm e2e                 # Playwright on Pixel 7 and iPhone 14 viewports
```

**Humans: start with `docs/START-HERE.md`** (agent assignments, worktrees, first prompts), then `docs/SETUP.md` (Supabase, keys, GitHub, hosting). Agents: start with `AGENTS.md`.

## How it works

The browser streams 16 kHz audio to the server, which transcribes it live (Gemini Live transcription), buffers utterances, and asks an LLM for a structured decision — continue, new topic, or revisit — plus any deferred topics or promises. Deterministic code validates each decision, places the node, and emits graph operations that the server stores and pushes to the phone; both sides apply them with the same pure reducer. After the conversation, a second pass adds speaker labels, merges duplicates and writes detailed notes.
