# A0 Foundation — finish and freeze (H0–H1, blocks everyone)

**Agent:** Claude Code · **Human:** H1 · **Branch:** `ws/a0-foundation`

Most of A0 was written before the hackathon session started: the monorepo, `packages/shared` (types, zod schemas, `applyOps` with invariant tests, `placeNode`, WebSocket protocol, `MODELS`, interpreter interfaces, db mapping), generated fixtures, migration `0001_init.sql`, stub apps, CI, AGENTS.md and the briefs.

What was verified before push: `applyOps`/`placeNode` tests (22) pass, the op stream replays exactly into the graph fixture, the zod-free modules typecheck in strict mode, and the migration applies to Postgres 16 with RLS isolating two users (pgvector stubbed). **Not yet verified: anything that needs `node_modules`** (dependencies could not be installed in the authoring sandbox). Your job is to close that gap fast.

## Tasks

- [ ] `pnpm install`. Commit `pnpm-lock.yaml`.
- [ ] `pnpm verify` — fix every lint, type and test failure. Likely spots: zod schema annotations in `packages/shared/src/schemas.ts`, ESLint flat-config plugin wiring, `@testing-library/jest-dom` types, Vite JSON/`?raw` imports in `apps/web/src/lib/fixtures.ts`. Fix forward; do not weaken the reducer invariants or delete tests.
- [ ] `pnpm exec playwright install chromium webkit && pnpm e2e` — the smoke test must pass on both viewports, including axe.
- [ ] `pnpm dev:web` shows Welcome; `pnpm dev:server` → `GET /health` returns `ok: true`.
- [ ] In `.github/workflows/ci.yml`: switch to `pnpm install --frozen-lockfile` and add `cache: pnpm` to both `setup-node` steps (remove the TODOs).
- [ ] Merge to `main`, confirm CI is green on GitHub, then tag `contracts-v1` (`git tag contracts-v1 && git push --tags`). That is the H1 freeze.
- [ ] Tell the humans: "H1 done, agents can branch."

## After H1

Stay available for `contract` PRs (additive only) and for fixture regeneration (`pnpm fixtures`). Do not take feature work.

## Done when

CI green on `main`, lockfile committed, tag pushed, both apps start locally.
