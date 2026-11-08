import fs from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Visual Snapshot Specs for ConversationMap (owner: A5)
 *
 * Scope:
 *   Captures visual snapshot of the fixture map (demo-religion) in its
 *   single default view across Pixel 7 and iPhone 14 viewports.
 *
 * Safety:
 *   - Skips when baseline snapshots are missing (unless UPDATE_VISUALS=1 is set),
 *     preventing CI breakages.
 *   - Emulates reduced-motion, disables animations, and masks dynamic time displays.
 */

const DEMO_CONVERSATION_ID = '8d13b192-38d0-4ba3-a3c8-7834f6573947';

test.describe('Fixture Map Visual Snapshot', () => {
  test('capture visual snapshot of default map view', async ({ page }, testInfo) => {
    // 1. Skip if visual baselines do not exist and not explicitly recording via UPDATE_VISUALS
    const baselineSnapshot = testInfo.snapshotPath('fixture-map.png');
    const hasBaseline = fs.existsSync(baselineSnapshot);
    test.skip(
      !process.env.UPDATE_VISUALS && !hasBaseline,
      'Visual snapshot baselines not yet committed (must be generated on Linux CI). Run with UPDATE_VISUALS=1 to record.',
    );

    // 2. Freeze moving parts: reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const isPlaceholder = await page
      .getByText(/Placeholder — built by A3 \+ A4/i)
      .isVisible()
      .catch(() => false);
    test.fixme(isPlaceholder, 'Owned by A4: ConversationMap/SavedMap not yet mounted on /c/:id');

    // Dismiss Diary sheet if opened (?diary=1)
    if (page.url().includes('diary')) {
      const diaryCloseBtn = page.getByRole('dialog', { name: 'Diary' }).getByRole('button', { name: 'Close' });
      await diaryCloseBtn.click({ timeout: 5000 }).catch(() => {});
    }

    // Wait for the React Flow canvas to render nodes and wait for layout to settle
    const map = page.locator('.react-flow');
    await expect(map).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);

    // Dynamic text/moving parts to mask (timestamps, clock format, relative times)
    const timeMask = page.locator('.cmap-sub, [role="timer"], [data-testid="captions"], time');

    const snapshotOptions = {
      animations: 'disabled' as const,
      maxDiffPixelRatio: 0.05,
      mask: [timeMask],
    };

    // Snapshot the single default view (no zoom bar or +/- level buttons required)
    await expect(page).toHaveScreenshot('fixture-map.png', snapshotOptions);
  });
});
