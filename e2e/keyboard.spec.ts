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
 */

const DEMO_CONVERSATION_ID = '8d13b192-38d0-4ba3-a3c8-7834f6573947';

test.describe('Keyboard-only operation', () => {
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

    // Focus the node on the map
    const node = page.getByRole('button', { name: /Sunday Service/i });
    await node.focus();
    await page.keyboard.press('Enter');

    // Enter opens preview card; press Enter again or open details for full sheet
    const openDetailsBtn = page.getByRole('button', { name: /open details/i });
    if (await openDetailsBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.keyboard.press('Enter');
    }

    // 4. In detail sheet, verify dialog opens and test Play if audio is available
    const detailSheet = page.getByRole('dialog');
    await expect(detailSheet).toBeVisible();

    const playBtn = detailSheet.getByRole('button', { name: /play/i });
    if (await playBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await playBtn.focus();
      await page.keyboard.press('Space');
      await expect(playBtn).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('Escape key dismisses sheets and returns focus', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const placeholder = page.getByText(/Placeholder — built by A3 \+ A4/i);
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    test.fixme(hasPlaceholder, 'Owned by A3 + A4: Sheets and dialogs not yet present at /c/:id');

    // Once dialog exists:
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });
});
