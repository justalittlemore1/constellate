# A5 QA + Review

**Agent:** Claude Code · **Human:** H2, then H1 · **Branch:** `ws/a5-qa` · **Owns:** `e2e/`, `playwright.config.ts`, added test files anywhere

Read first: `docs/PLAN.md` → Testing and quality gates (all tables), Risks. You are also the reviewer: on every open PR, check it against AGENTS.md (ownership, contracts, secrets, model ids, tests) and the relevant brief, and comment with file + line. Approve nothing yourself; humans approve.

## Phase 1 (H2–H6): mock mode

- [ ] E2E main loop in mock mode on Pixel 7 + iPhone 14: sign in (mock) → demo conversation → nodes appear → flag → stop → reopen → open a node → highlight persists → Brain renders. Extend specs as features land; mark not-yet-built steps `test.fixme` with the owning workstream.
- [ ] `@axe-core/playwright` on every route: zero serious/critical violations.
- [ ] Keyboard-only spec: record → stop → open a node → play, without a mouse.
- [ ] Reduced-motion spec (`page.emulateMedia({ reducedMotion: 'reduce' })`): no running animations.
- [ ] RLS test (Vitest + supabase-js, CI secrets `TEST_USER_A_*`, `TEST_USER_B_*`): user B cannot read or write any of A's rows or recordings.

## Phase 2 (H6–H10): real stack

- [ ] `E2E_REAL=1` runs of the main loop against the deployed server and Supabase.
- [ ] STT runner (`scripts/stt-runner.ts`, coordinate path with A2): stream each synthetic WAV through `/live` at real time; report WER vs script and time-to-first-final-caption. Targets: WER < 15 % clean, < 25 % noisy; first final ≤ 2.5 s after a pause. Run at H3 (if audio exists), H6, H10; post the report in a PR.
- [ ] Before H10: a written bug list ordered by demo impact, posted as a GitHub issue.

## Review checklist (paste into PR comments)

Owned paths only? Contracts untouched (or `contract` PR)? Tests fail without the change? Interpreter report not worse? Readable at 390 px in both motion modes? Anything secret reachable from the browser?
