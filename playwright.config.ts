import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * End-to-end tests (owner: A5). CI runs them in mock mode (no server, no Supabase).
 * Against the real stack: E2E_REAL=1 pnpm e2e  (needs .env and a running server).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: `pnpm --filter @constellate/web exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_MOCKS: process.env.E2E_REAL ? '0' : '1' },
    timeout: 60_000,
  },
});
