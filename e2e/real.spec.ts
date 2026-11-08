import { expect, test } from '@playwright/test';

/**
 * E2E Real Deployment Suite (Render backend + Vercel frontend)
 *
 * Scope (docs/briefs/a5-qa-review.md):
 *   E2E_REAL=1 runs of the main loop against the deployed server and Supabase.
 *   Skipped without E2E_REAL=1; NEVER run in CI.
 *
 * Usage:
 *   E2E_REAL=1 pnpm e2e e2e/real.spec.ts
 *   DEPLOYED_URL=https://constellate.vercel.app E2E_REAL=1 pnpm e2e e2e/real.spec.ts
 */

const TARGET_URL = process.env.DEPLOYED_URL || process.env.VERCEL_URL || '';

test.describe('Real Deployment E2E (Render + Vercel)', () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.E2E_REAL || Boolean(process.env.CI),
      'E2E_REAL=1 required to run real deployment specs; never run in CI',
    );
  });

  test('Full unbroken main loop against live deployed environment', async ({ page }) => {
    const email = process.env.TEST_USER_A_EMAIL || 'test-user-a@constellate.app';
    const password = process.env.TEST_USER_A_PASSWORD || 'test-password-123';

    // 1. Visit Login on target URL (or baseURL)
    if (TARGET_URL) {
      await page.goto(`${TARGET_URL}/login`);
    } else {
      await page.goto('/login');
    }

    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible({ timeout: 15_000 });
    await emailInput.fill(email);

    const passwordInput = page.getByLabel(/password/i);
    await passwordInput.fill(password);

    const signInBtn = page.getByRole('button', { name: /sign in/i });
    await signInBtn.click();

    // 2. Authenticated Home
    await page.waitForURL(/\/(#.*)?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible({ timeout: 10_000 });

    // 3. Start conversation
    const startBtn = page.getByRole('button', { name: 'Start a conversation' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    await page.waitForURL(/\/live/, { timeout: 10_000 });

    // 4. Consent sheet
    const consentBtn = page.getByRole('button', { name: /(start the demo|everyone agrees)/i });
    await expect(consentBtn).toBeVisible({ timeout: 10_000 });
    await consentBtn.click();

    // 5. Verify live recording indicator
    const liveScreen = page.locator('[data-testid="live-screen"]');
    await expect(liveScreen).toBeVisible({ timeout: 10_000 });

    // 6. Stop live session
    const stopBtn = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });
    await stopBtn.click();

    // 7. Saved conversation map
    const openMapBtn = page.getByRole('button', { name: /open the map|leave/i });
    if (await openMapBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await openMapBtn.click();
    }
    await page.waitForURL(/\/c\//, { timeout: 20_000 });

    // 8. Brain galaxy view
    await page.goto('/brain');
    await expect(page.locator('canvas, [data-testid="brain-canvas"]')).toBeVisible({ timeout: 15_000 });
  });
});
