A living map of your conversations. Constellate listens to a natural conversation and grows a map of its topics as they happen — branching into tangents, looping back to earlier ideas, and keeping track of the threads someone meant to come back to. Conversations are saved to the cloud and merged into a personal "Brain" of the ideas you keep returning to.

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

**Humans: start with `docs/START-HERE.md`** (agent assignments, worktrees, first prompts), then `docs/SETUP.md` (Supabase, keys, GitHub, hosting). Agents: start with `AGENTS.md`.
