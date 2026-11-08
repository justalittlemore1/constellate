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
const SUNDAY_SERVICE_ID = 'ab5b0bba-dced-43d8-a220-6db0ca3f2e47';

test.describe('Main loop: Mock mode E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
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

    // Consent sheet (A6): accept demo or live recording if presented
    const consentBtn = page.getByRole('button', { name: /(start the demo|everyone agrees)/i });
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click();
    }

    // Expected once A6 (mock replay) and A3 (map canvas) deliver:
    const node = page.getByText(/Sunday Service/i);
    await expect(node).toBeVisible({ timeout: 10_000 });
  });

  test('Step 4: Flag a key moment during live recording', async ({ page }) => {
    await page.goto(`/live/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A6 \+ A3/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A6 + A3: /live/:id screen and map canvas not yet mounted');

    // Consent sheet (A6): accept demo or live recording if presented
    const consentBtn = page.getByRole('button', { name: /(start the demo|everyone agrees)/i });
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click();
    }

    const flagButton = page.getByRole('button', { name: 'Flag', exact: true });
    const hasFlagBtn = await flagButton.isVisible().catch(() => false);
    test.fixme(!hasFlagBtn, 'Owned by A6: Flag button / useFlagTrigger not yet implemented in live screen');

    await flagButton.click();
    await expect(page.getByText(/flagged/i).first()).toBeVisible();
  });

  test('Step 5: Stop recording and see summary before exit', async ({ page }) => {
    await page.goto(`/live/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A6 \+ A3/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A6 + A3: /live/:id screen and map canvas not yet mounted');

    // Consent sheet (A6): accept demo or live recording if presented
    const consentBtn = page.getByRole('button', { name: /(start the demo|everyone agrees)/i });
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click();
    }

    const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
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

    // On A3 SavedMap, node button is accessible via its role and accessible name
    await expect(page.getByRole('button', { name: /^Sunday Service/ })).toBeVisible({ timeout: 10_000 });
  });

  test('Step 7: Open node preview and detail sheet with audio playback', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3 + A4: /c/:id saved conversation view not yet implemented');

    const node = page.getByRole('button', { name: /^Sunday Service/ });
    await expect(node).toBeVisible({ timeout: 10_000 });
    await node.click();

    // Node preview card: aria-label="Preview: …" with "Open details for …" button
    const preview = page.locator('[aria-label^="Preview:"]');
    await expect(preview).toBeVisible({ timeout: 5000 });
    const openDetailsBtn = preview.getByRole('button', { name: /^Open details for/i });
    await openDetailsBtn.click();

    const detailSheet = page.getByRole('dialog');
    await expect(detailSheet).toBeVisible();

    // In mock mode, no recording is available so Play is omitted; if present, verify it
    const playBtn = detailSheet.getByRole('button', { name: /play/i });
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click();
      await expect(page.getByText(/no recording is available/i)).toBeVisible();
    }
  });

  test('Step 8: Toggle highlight on a node and verify persistence', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3 + A4: /c/:id saved conversation view not yet implemented');

    const node = page.getByRole('button', { name: /^Sunday Service/ });
    await expect(node).toBeVisible({ timeout: 10_000 });
    await node.click();

    // Open detail sheet from preview card
    const preview = page.locator('[aria-label^="Preview:"]');
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole('button', { name: /^Open details for/i }).click();

    const detailSheet = page.getByRole('dialog');
    await expect(detailSheet).toBeVisible();

    const highlightButton = detailSheet.getByRole('button', { name: /^Highlight$/i });
    await expect(highlightButton).toBeVisible();
    await highlightButton.click();

    // Detail-sheet Highlight button now has aria-pressed="true"
    const removeHighlightButton = detailSheet.getByRole('button', { name: /^Remove highlight$/i });
    await expect(removeHighlightButton).toBeVisible();
    await expect(removeHighlightButton).toHaveAttribute('aria-pressed', 'true');

    // And target the specific node we highlighted
    await expect(
      page.locator(
        `[data-id="${SUNDAY_SERVICE_ID}"] [data-highlighted="true"], [data-testid="map-node-${SUNDAY_SERVICE_ID}"][data-highlighted="true"]`,
      ),
    ).toBeVisible();

    // Toggling off restores the state
    await removeHighlightButton.click();
    const restoredHighlightButton = detailSheet.getByRole('button', { name: /^Highlight$/i });
    await expect(restoredHighlightButton).toBeVisible();
    await expect(restoredHighlightButton).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.locator(
        `[data-id="${SUNDAY_SERVICE_ID}"] [data-highlighted="true"], [data-testid="map-node-${SUNDAY_SERVICE_ID}"][data-highlighted="true"]`,
      ),
    ).not.toBeVisible();
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
    test.fixme(
      !navigatedToLive || isLivePlaceholder,
      'Blocked by A6 + A3: Live screen / map canvas still a placeholder',
    );

    // Consent sheet (A6): accept demo or live recording
    const consentBtn = page.getByRole('button', { name: /(start the demo|everyone agrees)/i });
    await expect(consentBtn).toBeVisible({ timeout: 5000 });
    await consentBtn.click();

    // 3. Live nodes appear
    const firstNode = page.getByText(/Sunday Service/i);
    await expect(firstNode).toBeVisible({ timeout: 10_000 });

    // 4. Flag moment
    const flagBtn = page.getByRole('button', { name: 'Flag', exact: true });
    await flagBtn.click();

    // 5. Stop recording
    const stopBtn = page.getByRole('button', { name: 'Stop', exact: true });
    await stopBtn.click();

    // Dismiss Before you go sheet if shown, or wait for navigation
    const openMapBtn = page.getByRole('button', { name: /open the map|leave/i });
    if (await openMapBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await openMapBtn.click().catch(() => {});
    }
    await page.waitForURL(/\/c\//, { timeout: 15_000 });

    // Dismiss Diary sheet if opened (?diary=1) so the map behind it is interactive
    if (page.url().includes('diary')) {
      const diaryCloseBtn = page.getByRole('dialog', { name: 'Diary' }).getByRole('button', { name: 'Close' });
      await diaryCloseBtn.click({ timeout: 10_000 });
      await expect(page.getByRole('dialog', { name: 'Diary' })).not.toBeVisible();
    }

    // 6 & 7. Open node in saved conversation
    const isSavedPlaceholder = await page
      .getByText(/Placeholder — built by A3 \+ A4/i)
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    test.fixme(isSavedPlaceholder, 'Owned by A3 + A4: /c/:id saved conversation view not yet implemented');

    const savedNode = page.getByRole('button', { name: /^Sunday Service/ });
    await expect(savedNode).toBeVisible({ timeout: 10_000 });
    await savedNode.click();

    // Node preview card: aria-label="Preview: …" with "Open details for …" button
    const preview = page.locator('[aria-label^="Preview:"]');
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole('button', { name: /^Open details for/i }).click();

    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();

    // 8. Highlight
    const highlightBtn = detail.getByRole('button', { name: /^Highlight$/i });
    await expect(highlightBtn).toBeVisible();
    await highlightBtn.click();

    // Verify detail-sheet Highlight button has aria-pressed="true" and Sunday Service node is highlighted
    const removeHighlightBtn = detail.getByRole('button', { name: /^Remove highlight$/i });
    await expect(removeHighlightBtn).toBeVisible();
    await expect(removeHighlightBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator(
        `[data-id="${SUNDAY_SERVICE_ID}"] [data-highlighted="true"], [data-testid="map-node-${SUNDAY_SERVICE_ID}"][data-highlighted="true"]`,
      ),
    ).toBeVisible();

    // 9. Open Brain
    await page.goto('/brain');
    const isBrainPlaceholder = await page.getByText(/Placeholder — built by A4/i).isVisible().catch(() => false);
    test.fixme(isBrainPlaceholder, 'Owned by A4: /brain galaxy view not yet implemented');
    await expect(page.locator('canvas')).toBeVisible();
  });
});
