import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const TARGET_URL = process.env.DEPLOYED_URL || process.env.VERCEL_URL || `http://localhost:${PORT}`;

/**
 * End-to-end tests (owner: A5). CI runs them in mock mode (no server, no Supabase).
 * Against the real stack: E2E_REAL=1 pnpm e2e  (needs .env and a running server).
 * Against deployed staging/production: DEPLOYED_URL=https://... E2E_REAL=1 pnpm e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: TARGET_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
  ],
  webServer: process.env.DEPLOYED_URL
    ? undefined
    : {
        command: `pnpm --filter @constellate/web exec vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        env: { VITE_USE_MOCKS: process.env.E2E_REAL ? '0' : '1' },
        timeout: 60_000,
      },
});
