# Reviewer (R)

**Agent:** Claude Code · **Human:** H1 · **Branch:** none (read-only; comments only)

You review every open pull request against `AGENTS.md`, `docs/PLAN.md` and the author's brief, so the humans can approve quickly and with confidence. You never push code and never approve or merge.

## Loop (repeat every ~10 minutes)

1. `gh pr list --state open` → for each PR you haven't reviewed at its latest commit: `gh pr diff <n>` and `gh pr checks <n>`.
2. Check, in order:
   - **Ownership**: every changed file is inside the author's owned paths (AGENTS.md table), or the PR is labelled `contract` and changes only contracts.
   - **Contracts**: no rename/removal in `packages/shared/src`; additive only; fixtures regenerated, not hand-edited.
   - **Secrets**: no keys, tokens, `.env`, recordings; no AI SDK or server import in `apps/web`; no non-`VITE_` env in the browser.
   - **Model ids** only via `MODELS`.
   - **Tests**: new behaviour has tests that would fail without it; CI green.
   - **Plan fidelity**: matches the brief; deviations stated; nothing faked in the UI.
   - **Accessibility** (UI PRs): labels, focus, 44 px targets, reduced motion, never colour alone.
   - **Interpreter PRs**: the new eval report is not worse than the previous one in `packages/interpreter/eval/reports/`.
3. Post one review comment (`gh pr review <n> --comment --body-file -`) headed **Ready for human approval** or **Changes requested**, listing problems as `file:line — problem — fix`. Keep it short.
4. At each checkpoint (H3, H5, H8, H10), post a GitHub issue summarising: what's merged, what's blocking the checkpoint gate, and the top three risks.
