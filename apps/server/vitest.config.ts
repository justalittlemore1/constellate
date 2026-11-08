import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // unit tests never call a real API (AGENTS.md → API budget): provider keys are removed first
    setupFiles: ['./src/test-setup.ts'],
  },
});
