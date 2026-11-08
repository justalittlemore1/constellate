# A5 QA (tests)

**Agent:** Gemini CLI · **Human:** H2 · **Branch:** `ws/a5-qa` · **Owns:** `e2e/`, `playwright.config.ts`, added test files anywhere

Read first: `docs/PLAN.md` → Testing and quality gates (all tables), Risks. PR review is a separate Claude session (`docs/briefs/reviewer.md`); you write and run tests.

## Phase 1 (H2–H6): mock mode

- [ ] E2E main loop in mock mode on Pixel 7 + iPhone 14: sign in (mock) → demo conversation → nodes appear → flag → stop → reopen → open a node → highlight persists → Brain renders. Extend specs as features land; mark not-yet-built steps `test.fixme` with the owning workstream.
- [ ] `@axe-core/playwright` on every route: zero serious/critical violations.
- [ ] Keyboard-only spec: record → stop → open a node → play, without a mouse.
- [ ] Reduced-motion spec (`page.emulateMedia({ reducedMotion: 'reduce' })`): no running animations.
- [ ] RLS test (Vitest + supabase-js, CI secrets `TEST_USER_A_*`, `TEST_USER_B_*`): user B cannot read or write any of A's rows or recordings.

## Phase 2 (H6–H10): real stack

- [ ] `E2E_REAL=1` runs of the main loop against the deployed server and Supabase.
- [ ] STT runner (`scripts/stt-runner.ts`): stream each WAV in `packages/shared/fixtures/audio/` (supplied by the humans: their own recordings, ElevenLabs renders or podcast clips; git-ignored) through `/live` at real time. A WAV named after a transcript fixture (e.g. `03-return-revisit.wav`) has an answer key: report WER against that fixture's text (a `.json` sidecar with timings is optional). A WAV with no matching fixture (podcasts) has no key: report only time-to-first-final-caption and caption stability. Never commit or upload audio. Targets: WER < 15 % clean, < 25 % noisy; first final ≤ 2.5 s after a pause. Run at H3 (if audio exists), H6, H10; post the report in a PR.
- [ ] Before H10: a written bug list ordered by demo impact, posted as a GitHub issue.
