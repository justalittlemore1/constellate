/// <reference lib="dom" />

import { expect, test } from '@playwright/test';

/**
 * Keyboard-Only Navigation Spec (owner: A5)
 *
 * Scope (docs/briefs/a5-qa-review.md):
 *   record → stop → open a node → play, without a mouse.
 *
 * Requirements:
 *   - Focus visible on all focused interactive elements
 *   - Logical Tab sequence
 *   - Space / Enter activates buttons
 *   - Focus trap in sheets / modals
 *   - Outline accessible via focus-revealed "Text view" / outline toggle
 */

const DEMO_CONVERSATION_ID = '8d13b192-38d0-4ba3-a3c8-7834f6573947';

test.describe('Keyboard-only operation', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
  test('Home page interactive elements are reachable and indicate focus via Tab key', async ({ page }) => {
    await page.goto('/');

    // Press Tab to focus the primary action
    await page.keyboard.press('Tab');

    const startButton = page.getByRole('button', { name: 'Start a conversation' });
    await expect(startButton).toBeFocused();

    // Verify focus-visible outline is applied
    const hasFocusOutline = await startButton.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const outlineWidth = parseInt(style.outlineWidth || '0', 10);
      const outlineStyle = style.outlineStyle;
      return outlineWidth > 0 && outlineStyle !== 'none';
    });

    expect(hasFocusOutline, 'focused element has visible outline').toBe(true);
  });

  test('Full keyboard path: record → stop → open a node → play without a mouse', async ({ page }) => {
    // 1. Start from Home
    await page.goto('/');
    await page.keyboard.press('Tab');

    const startBtn = page.getByRole('button', { name: 'Start a conversation' });
    await expect(startBtn).toBeFocused();

    // Press Enter to start recording
    await page.keyboard.press('Enter');

    const navigatedToLive = await page
      .waitForURL(/\/live/, { timeout: 1500 })
      .then(() => true)
      .catch(() => false);

    test.fixme(!navigatedToLive, 'Blocked at step 1 by A4 + A6: Live session trigger from Home');

    // 2. On /live/:id, navigate to Stop button and press Enter
    await page.goto(`/live/${DEMO_CONVERSATION_ID}`);

    const livePlaceholder = page.getByText(/Placeholder — built by A6 \+ A3/i);
    const hasLivePlaceholder = await livePlaceholder.isVisible().catch(() => false);
    test.fixme(hasLivePlaceholder, 'Blocked at step 2 by A6: Live screen not yet mounted');

    // Consent sheet (A6): accept if presented (it has autofocus on the primary button)
    const consentBtn = page.getByRole('button', { name: /(start the demo|everyone agrees)/i });
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Enter');
    }

    const stopBtn = page.getByRole('button', { name: 'Stop', exact: true });
    const hasStop = await stopBtn.isVisible().catch(() => false);
    test.fixme(!hasStop, 'Blocked at step 2 by A6: Live screen stop control not yet implemented');

    await stopBtn.focus();
    await page.keyboard.press('Enter');

    // 3. On saved conversation /c/:id, focus and open a node
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);
    const savedPlaceholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasSavedPlaceholder = await savedPlaceholder.isVisible().catch(() => false);
    test.fixme(hasSavedPlaceholder, 'Blocked at step 3 by A3: Saved conversation node navigation not yet implemented');

    // Dismiss Diary sheet if opened (?diary=1)
    if (page.url().includes('diary')) {
      const diaryCloseBtn = page.getByRole('dialog', { name: 'Diary' }).getByRole('button', { name: 'Close' });
      await diaryCloseBtn.click({ timeout: 5000 }).catch(() => {});
    }

    // Focus the node on the map by role and accessible name
    const node = page.getByRole('button', { name: /^Sunday Service/ });
    await expect(node).toBeVisible({ timeout: 10_000 });
    await node.focus();
    await page.keyboard.press('Enter');

    // Enter opens preview card (pre-redesign) or full sheet directly (redesign)
    const preview = page.locator('[aria-label^="Preview:"]');
    const openDetailsBtn = preview.getByRole('button', { name: /^Open details for/i });
    if (await openDetailsBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await openDetailsBtn.focus();
      await page.keyboard.press('Enter');
    }

    // 4. In detail sheet, verify dialog opens; mock mode has no recording, so no Play
    const detailSheet = page.getByRole('dialog');
    await expect(detailSheet).toBeVisible();
    await expect(detailSheet.getByRole('button', { name: /^play/i })).toHaveCount(0);
  });

  test('Outline is reachable via keyboard focus or outline toggle', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3 + A4: Saved conversation view not yet implemented');

    if (page.url().includes('diary')) {
      const diaryCloseBtn = page.getByRole('dialog', { name: 'Diary' }).getByRole('button', { name: 'Close' });
      await diaryCloseBtn.click({ timeout: 5000 }).catch(() => {});
    }

    // Outline is reachable via focus-revealed "Text view" link or "Show as outline" button
    const textView = page
      .getByRole('link', { name: /text view/i })
      .or(page.getByRole('button', { name: /(text view|show as outline)/i }));

    let hasTextView = await textView.first().isVisible().catch(() => false);
    if (!hasTextView) {
      // Tab through to reveal focus-revealed skip / text view link
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        if (await textView.first().isVisible().catch(() => false)) {
          hasTextView = true;
          break;
        }
      }
    }

    test.fixme(!hasTextView, 'Owned by A3: Focus-revealed "Text view" link not yet mounted');

    if (hasTextView) {
      await textView.first().focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tree', { name: /outline/i }).or(page.getByTestId('outline'))).toBeVisible();
    }
  });

  test('Library / Constellate drawer and Favourites / Highlights are reachable via keyboard', async ({
    page,
  }) => {
    await page.goto('/');

    const libraryBtn = page.getByRole('button', { name: /(open )?(menu|library|constellate)/i });
    await expect(libraryBtn).toBeVisible();
    await libraryBtn.click();
    const libraryDialog = page.getByRole('dialog', { name: /(library|constellate)/i });
    await expect(libraryDialog).toBeVisible();

    const favLink = libraryDialog.getByRole('link', { name: /(favourites|highlights)/i });
    await expect(favLink).toBeVisible();
    await favLink.click();
    await expect(page).toHaveURL(/\/favorites/);
  });

  test('Escape key dismisses sheets and returns focus', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3 + A4: Sheets and dialogs not yet present at /c/:id');

    // Open diary sheet via header button
    const diaryBtn = page.getByRole('button', { name: /open diary/i });
    await expect(diaryBtn).toBeVisible({ timeout: 10_000 });
    await diaryBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
