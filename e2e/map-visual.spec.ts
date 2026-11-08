import { expect, test } from '@playwright/test';

/**
 * Visual Snapshot Specs for ConversationMap (owner: A5)
 *
 * Scope:
 *   Captures visual snapshots of the fixture map (demo-religion) at the three
 *   semantic zoom levels: Broad, Balanced, and Detailed across Pixel 7 and iPhone 14.
 *
 * Runs for real once A4 mounts ConversationMap on /c/:id.
 */

const DEMO_CONVERSATION_ID = '8d13b192-38d0-4ba3-a3c8-7834f6573947';

test.describe('Fixture Map Visual Snapshots (Broad, Balanced, Detailed)', () => {
  test('capture visual snapshots across semantic zoom detail levels', async ({ page }) => {
    await page.goto(`/c/${DEMO_CONVERSATION_ID}`);

    const isPlaceholder = await page
      .getByText(/Placeholder — built by A3 \+ A4/i)
      .isVisible()
      .catch(() => false);
    test.fixme(isPlaceholder, 'Owned by A4: ConversationMap not yet mounted on /c/:id');

    // Wait for the React Flow canvas to render nodes
    const map = page.locator('.react-flow');
    await expect(map).toBeVisible({ timeout: 10_000 });

    // Allow initial viewport and node layout transitions to settle
    await page.waitForTimeout(500);

    // 1. Broad view
    const broadBtn = page.getByRole('button', { name: 'Broad', exact: true });
    await broadBtn.click();
    await expect(broadBtn).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('fixture-map-broad.png', {
      maxDiffPixelRatio: 0.05,
    });

    // 2. Balanced view
    const balancedBtn = page.getByRole('button', { name: 'Balanced', exact: true });
    await balancedBtn.click();
    await expect(balancedBtn).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('fixture-map-balanced.png', {
      maxDiffPixelRatio: 0.05,
    });

    // 3. Detailed view
    const detailedBtn = page.getByRole('button', { name: 'Detailed', exact: true });
    await detailedBtn.click();
    await expect(detailedBtn).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('fixture-map-detailed.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
