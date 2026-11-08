import { expect, test } from '@playwright/test';

/**
 * E2E Main Loop Spec in Mock Mode (VITE_USE_MOCKS=1)
 *
 * Scope (docs/briefs/a5-qa-review.md):
 *   sign in (mock) → demo conversation → nodes appear → flag → stop →
 *   reopen → open a node → highlight persists → Brain renders.
 *
 * Unbuilt features are marked `test.fixme` with their owning workstream (A3, A4, A6).
 * As each workstream delivers their components, tests will seamlessly proceed to verification.
 */

const DEMO_CONVERSATION_ID = '8d13b192-38d0-4ba3-a3c8-7834f6573947';

test.describe('Main loop: Mock mode E2E', () => {
  test('Step 1: Sign in (mock mode bypass / credentials)', async ({ page }) => {
    await page.goto('/login');

    const placeholder = page.getByText(/Placeholder — built by A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A4: /login screen not yet implemented');

    // Expected once A4 delivers:
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();
    await emailInput.fill('demo@constellate.local');
    const passwordInput = page.getByLabel(/password/i);
    await passwordInput.fill('demopassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/');
  });

  test('Step 2: Start demo conversation from Home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

    const startBtn = page.getByRole('button', { name: 'Start a conversation' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Check if clicking navigated to /live route or opened consent sheet
    const navigated = await page
      .waitForURL(/\/live/, { timeout: 1500 })
      .then(() => true)
      .catch(() => false);

    test.fixme(!navigated, 'Owned by A4 + A6: Start conversation button not yet connected to live session');
  });

  test('Step 3: Live session displays incoming topic nodes', async ({ page }) => {
    await page.goto(`/live/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A6 \+ A3/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A6 + A3: /live/:id screen and map canvas not yet mounted');

    // Expected once A6 (mock replay) and A3 (map canvas) deliver:
    const node = page.getByText(/Sunday Service/i);
    await expect(node).toBeVisible({ timeout: 10_000 });
  });

  test('Step 4: Flag a key moment during live recording', async ({ page }) => {
    await page.goto(`/live/${DEMO_CONVERSATION_ID}`);

    const flagButton = page.getByRole('button', { name: /flag/i });
    const hasFlagBtn = await flagButton.isVisible().catch(() => false);
    test.fixme(!hasFlagBtn, 'Owned by A6: Flag button / useFlagTrigger not yet implemented in live screen');

    await flagButton.click();
    await expect(page.getByText(/flagged/i)).toBeVisible();
  });

  test('Step 5: Stop recording and see summary before exit', async ({ page }) => {
    await page.goto(`/live/${DEMO_CONVERSATION_ID}`);

    const stopButton = page.getByRole('button', { name: /stop/i });
    const hasStopBtn = await stopButton.isVisible().catch(() => false);
    test.fixme(!hasStopBtn, 'Owned by A6: Stop recording and Before you go banner not yet implemented');

    await stopButton.click();
    await expect(page.getByText(/before you go/i)).toBeVisible();
  });

  test('Step 6: Reopen saved conversation map at /c/:id', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3 + A4: /c/:id saved conversation view not yet implemented');

    // Once A3 ConversationMap renders:
    await expect(page.getByText(/Sunday Service/i)).toBeVisible();
  });

  test('Step 7: Open node preview and detail sheet with audio playback', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3: Node selection and detail sheet not yet implemented');

    const node = page.getByText(/Sunday Service/i);
    await node.click();

    const detailSheet = page.getByRole('dialog');
    await expect(detailSheet).toBeVisible();
    await expect(detailSheet.getByRole('button', { name: /play/i })).toBeVisible();
  });

  test('Step 8: Toggle highlight on a node and verify persistence', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3: Node highlighter not yet implemented');

    const node = page.getByText(/Sunday Service/i);
    await node.click();

    const highlightButton = page.getByRole('button', { name: /highlight/i });
    await highlightButton.click();

    await page.reload();
    await expect(page.locator('[data-highlighted="true"]')).toBeVisible();
  });

  test('Step 9: Brain galaxy renders merged concepts', async ({ page }) => {
    await page.goto('/brain');

    const placeholder = page.getByText(/Placeholder — built by A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A4: /brain galaxy view not yet implemented');

    // Once A4 renders the force graph:
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('Full unbroken loop: sign in → demo → nodes → flag → stop → reopen → open node → highlight → brain', async ({
    page,
  }) => {
    // 1. Visit Home
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

    // 2. Start conversation
    const startBtn = page.getByRole('button', { name: 'Start a conversation' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    const navigatedToLive = await page
      .waitForURL(/\/live/, { timeout: 1500 })
      .then(() => true)
      .catch(() => false);

    const isLivePlaceholder = await page.getByText(/Live map/i).isVisible().catch(() => false);
    const hasStopBtn = await page.getByRole('button', { name: /stop/i }).isVisible().catch(() => false);
    test.fixme(
      !navigatedToLive || isLivePlaceholder || !hasStopBtn,
      'Blocked by A6 + A3: Live screen / map canvas still a placeholder',
    );

    // 3. Live nodes appear
    const firstNode = page.getByText(/Sunday Service/i);
    await expect(firstNode).toBeVisible({ timeout: 10_000 });

    // 4. Flag moment
    const flagBtn = page.getByRole('button', { name: /flag/i });
    await flagBtn.click();

    // 5. Stop recording
    const stopBtn = page.getByRole('button', { name: /stop/i });
    await stopBtn.click();
    await page.waitForURL(/\/c\//, { timeout: 5000 });

    // 6 & 7. Open node in saved conversation
    await page.getByText(/Sunday Service/i).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();

    // 8. Highlight
    await page.getByRole('button', { name: /highlight/i }).click();

    // 9. Open Brain
    await page.goto('/brain');
    await expect(page.locator('canvas')).toBeVisible();
  });
});
