# Start here — running the agents

Two humans (**H1** = speech/AI lead, **H2** = product/UI lead), eight agent sessions. Assignments supersede the agent table in `docs/PLAN.md`.

| Session | Tool | Workstream | Human | Starts |
| --- | --- | --- | --- | --- |
| 1 | Claude Code | A0 finish → then A1 Server + speech | H1 | now |
| 2 | Claude Code | A2 Interpreter (the hardest part) | H1 | now (fixtures only until `contracts-v1`) |
| 3 | Claude Code | R Reviewer | H1 | when the first PR opens |
| 4 | Codex (seat 1) | A4 Shell + Library + Brain UI | H2 | after `contracts-v1` |
| 5 | Codex (seat 2) | A6 Live client (mic, audio worklet, WebSocket, flags) | H2 | after `contracts-v1` |
| 6 | Cursor (Grok 4.7) | A3 Map UI | H2 | after `contracts-v1` |
| 7 | Gemini CLI | A5 QA tests | H2 | after `contracts-v1` |

## 0. One-time setup (each laptop, ~10 min)

1. Install **Node 22**, **git**, and the **GitHub CLI**, then run `corepack enable` (gives you pnpm 10) and `gh auth login`.
2. `git clone https://github.com/justalittlemore1/constellate && cd constellate`
3. Install your agent tools: Claude Code (H1), Codex CLI (H2), Cursor (H2), Gemini CLI (H2). Log each one in.
4. H2, while A0 runs: work through `docs/SETUP.md` blocks 1–3 (Supabase, `.env`, GitHub secrets, branch protection, the `contract` label). Copy the finished `.env` to the repo root on both laptops.

## 1. Each agent gets its own folder (git worktree)

From the main `constellate` folder, once per session (swap the name):

```bash
git fetch origin
git worktree add ../constellate-a2 -b ws/a2-interpreter origin/main
cd ../constellate-a2
copy ..\constellate\.env .env      # Windows   (macOS/Linux: cp ../constellate/.env .env)
pnpm install
```

Branch names: `ws/a1-server`, `ws/a2-interpreter`, `ws/a3-map`, `ws/a4-shell`, `ws/a5-qa`, `ws/a6-live`. Session 1 (A0) works in the main clone on `ws/a0-foundation`. The reviewer needs no worktree.

Open the agent **inside that folder** (Claude Code / Codex / Gemini: run it in that terminal; Cursor: File → Open Folder).

## 2. First prompts (copy-paste)

**Session 1 — Claude Code, A0 then A1** (main clone)

> You are workstream A0 on the Constellate hackathon project. Read AGENTS.md, docs/PLAN.md and docs/briefs/a0-foundation.md in full. Create branch ws/a0-foundation, then complete every task in the A0 brief: install, confirm `pnpm verify` and `pnpm e2e` pass locally (CI on main is already green), commit the lockfile, make CI strict, open a PR, and once it is merged and CI is green on main, tag and push `contracts-v1`. Tell me the moment the tag is pushed. Then become workstream A1: create a worktree for ws/a1-server and work through docs/briefs/a1-server.md phase by phase without waiting for me.

**Session 2 — Claude Code, A2** (`../constellate-a2`)

> You are workstream A2, the topic interpreter — the core of Constellate. Read AGENTS.md, docs/PLAN.md (especially "Topic interpreter" and the testing section) and docs/briefs/a2-interpreter.md in full. Until the tag `contracts-v1` exists, only write the transcript fixtures and prompt files (no dependency changes). After the tag, rebase on origin/main and work through every phase of your brief. Iterate against `pnpm eval` reports, commit a report with every change, and recommend the default LLM provider by hour 4 with numbers. Open a PR at least every 90 minutes and keep going while it is reviewed.

**Session 3 — Claude Code, Reviewer** (main clone, read-only)

> You are the Reviewer for Constellate. Read AGENTS.md, docs/PLAN.md and docs/briefs/reviewer.md. Never push code, approve or merge. Every ~10 minutes, review each open PR at its latest commit as the brief describes and post one comment headed "Ready for human approval" or "Changes requested". At hours 3, 5, 8 and 10 post the checkpoint summary issue.

**Session 4 — Codex, A4** (`../constellate-a4`)

> You are workstream A4 (app shell, library, diary and Brain UI) on Constellate. Read AGENTS.md, docs/PLAN.md (the interface/design section and "The Brain") and docs/briefs/a4-shell-library-brain.md in full. Write only inside your owned paths. Work in mock mode (VITE_USE_MOCKS=1) until real data exists. Go phase by phase without waiting for me; run `pnpm verify` before every commit; open a PR with `gh pr create` using the template at least every 90 minutes and continue with the next task while it is reviewed.

**Session 5 — Codex, A6** (`../constellate-a6`) — use the highest reasoning setting

> You are workstream A6 (live client: microphone capture, AudioWorklet PCM streaming, WebSocket client, flag triggers) on Constellate. Read AGENTS.md, docs/PLAN.md (Speech pipeline → Capture, and the interface section) and docs/briefs/a6-live-client.md in full. Build against mock mode first so you never wait for the server. Same rules: owned paths only, `pnpm verify` before each commit, a PR at least every 90 minutes, keep going while it is reviewed.

**Session 6 — Cursor, A3** (`../constellate-a3`, Agent mode)

> You are workstream A3 (the conversation map — the visual heart of Constellate). Read AGENTS.md, docs/PLAN.md (the whole "Interface and interaction design" section) and docs/briefs/a3-map-ui.md in full. Build `features/map` on React Flow against the fixture graph (`loadDemoGraph()`), with positions only from node x/y. Visual quality and accessibility matter most: follow the visual-language table exactly, never use colour alone. Run `pnpm dev:web` and check every change in the browser at a 390 px phone width. Owned paths only, `pnpm verify` before each commit, a PR at least every 90 minutes.

**Session 7 — Gemini CLI, A5** (`../constellate-a5`)

> You are workstream A5 (tests) on Constellate. Read AGENTS.md, docs/PLAN.md (Testing and quality gates) and docs/briefs/a5-qa-review.md in full. Write Playwright end-to-end, accessibility, keyboard and reduced-motion specs in mock mode first, marking steps for unbuilt features `test.fixme` with the owning workstream. Then the RLS test and the STT runner. Owned paths only, `pnpm verify` before each commit, a PR at least every 90 minutes.

## 3. Your loop as humans (every ~30 min)

1. `gh pr list` → for PRs the Reviewer marked **Ready for human approval** with green CI: skim the diff and the evidence (screenshot or eval report), then approve and squash-merge.
2. Tell the other agents "main moved, rebase" when a contract or big shared change lands.
3. H1 reads each new eval report in `packages/interpreter/eval/reports/` — the interpreter's quality is the product.
4. H2 looks at the app at phone width after each UI merge and gives the UI agents concrete visual feedback.
5. At each checkpoint (H3, H5, H8, H10 — see AGENTS.md) both of you pull `main` and run the main loop yourselves. If a gate fails, decide what to cut (Risks table in the plan).

If an agent goes quiet or loops: ask it for a status line ("what's done, what's next, what's blocking"), then either unblock it or tell it to skip that task.
