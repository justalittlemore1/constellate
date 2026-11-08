# Constellate

A living map of your conversations. Constellate listens to a natural conversation and grows a map of its topics as they happen — branching into tangents, looping back to earlier ideas, and keeping track of the threads someone meant to come back to. Conversations are saved to the cloud and merged into a personal "Brain" of the ideas you keep returning to.

Built for HackCamp 2026 (nwPlus, UBC).

## Repository

| Path | What |
| --- | --- |
| `apps/web` | Phone-first React PWA (Vite, React Flow, Tailwind) |
| `apps/server` | Fastify + WebSocket gateway: live speech-to-text, interpreter, persistence |
| `packages/shared` | Contracts: domain types, zod schemas, the `applyOps` reducer, layout, WebSocket protocol, model config, fixtures |
| `packages/interpreter` | Turns utterances into graph operations; evaluation harness |
| `packages/brain` | Cross-conversation concept graph |
| `supabase/migrations` | Postgres schema with pgvector and row-level security |
| `docs/PLAN.md` | The full implementation plan |
| `docs/briefs/` | One brief per agent workstream |
| `AGENTS.md` | Rules every coding agent follows |

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

Humans: see `docs/SETUP.md` for Supabase, keys, GitHub and hosting. Agents: start with `AGENTS.md`.

## How it works

The browser streams 16 kHz audio to the server, which transcribes it live (Gemini Live transcription), buffers utterances, and asks an LLM for a structured decision — continue, new topic, or revisit — plus any deferred topics or promises. Deterministic code validates each decision, places the node, and emits graph operations that the server stores and pushes to the phone; both sides apply them with the same pure reducer. After the conversation, a second pass adds speaker labels, merges duplicates and writes detailed notes.
