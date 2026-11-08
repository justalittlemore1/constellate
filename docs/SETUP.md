# Human setup checklist (≈ 20 minutes, do in parallel with A0)

Agents can't create accounts or handle secrets. One human does each block; tick them off.

## 1. Supabase (H1)

- [ ] Create a project at supabase.com (region closest to the venue, e.g. West US).
- [ ] **SQL editor** → paste `supabase/migrations/0001_init.sql` → Run. (Or `supabase link` + `supabase db push` with the CLI.) Confirm tables appear and the `recordings` bucket exists under Storage.
- [ ] **Authentication → Providers → Email**: enabled; turn **off** "Confirm email" for the hackathon so judges can sign up instantly.
- [ ] **Authentication → Users**: create two test users (`test-a@…`, `test-b@…`) with passwords, plus a `demo@…` account for the seeded demo.
- [ ] **Project settings → API**: copy the project URL, the `anon` public key, and the `service_role` key.

## 2. Keys and `.env` (H1)

- [ ] `cp .env.example .env` at the repo root on each laptop; fill `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Keep `VITE_USE_MOCKS=1` until the H5 checkpoint.
- [ ] **Anthropic key:** link the Ultra plan's monthly API credit (claude.ai → Settings → Billing → API credits → Link organization), then create the key in that organization at platform.claude.com.
- [ ] **Gemini key (free tier):** used only for live transcription (unlimited) and embeddings (1,000/day). Set `INTERPRETER_PROVIDER=anthropic`. Turning on billing for the Gemini project raises every limit and stops unpaid-tier data use; recommended before recording real people.
- [ ] Optional: a Deepgram key (free credit, no card) for speaker labels on recordings, `DEEPGRAM_API_KEY`.
- [ ] Never paste keys into an agent chat or commit them.

## 3. GitHub (H1)

- [ ] **Settings → Secrets and variables → Actions**: add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD` (for A5's RLS test).
- [ ] **Settings → Branches / Rules**: protect `main` — require a pull request and require both CI checks to pass ("lint · typecheck · unit tests" and "e2e"). Set **required approvals to 0**: agents open PRs under your GitHub login and GitHub won't let an author approve their own PR. Humans still merge only when the Reviewer says "Ready for human approval".
- [ ] Create the label `contract`.
- [ ] Install `gh` and log in on each laptop (`gh auth login`) so agents can open PRs.

## 4. Hosting (by H5)

- [ ] **Render** → New Web Service from this repo: runtime Node, build `corepack enable && pnpm install --frozen-lockfile`, start `pnpm --filter @constellate/server start`, Node 22. Env: the server-only values from `.env` plus `CORS_ORIGIN=<your Vercel URL>`. Health check path `/health`.
- [ ] **Vercel** → import the repo, root directory `apps/web`, framework Vite, install `pnpm install`, build `pnpm build`. Env: all `VITE_*` values with `VITE_SERVER_WS_URL=wss://<render-host>/live`, `VITE_SERVER_HTTP_URL=https://<render-host>`, `VITE_USE_MOCKS=0`.
- [ ] Before presenting: open `https://<render-host>/health` to wake the server.

## 5. Agent sessions (after A0 tags `contracts-v1`)

For each workstream, on the laptop of its human:

```bash
git fetch && git worktree add ../constellate-a1 -b ws/a1-server origin/main
cd ../constellate-a1 && pnpm install
```

Then start the agent in that folder with: *"You are workstream A1. Read AGENTS.md, docs/PLAN.md and docs/briefs/a1-server.md, then start Phase 1."* (Swap the number and brief per agent.)
