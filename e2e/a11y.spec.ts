import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility Specs (owner: A5)
 *
 * Rules:
 *   - Zero serious or critical violations on every route (axe-core)
 *   - Labelled controls, 44px minimum touch targets, visible focus
 *   - Runs across mobile viewports: Pixel 7 and iPhone 14
 */

const ROUTES_TO_AUDIT = [
  { path: '/', label: 'Home' },
  { path: '/login', label: 'Sign in' },
  { path: '/live/8d13b192-38d0-4ba3-a3c8-7834f6573947', label: 'Live screen' },
  { path: '/c/8d13b192-38d0-4ba3-a3c8-7834f6573947', label: 'Saved conversation' },
  { path: '/brain', label: 'Brain galaxy view' },
  { path: '/favorites', label: 'Favourites / Highlights' },
  { path: '/settings', label: 'Settings' },
  { path: '/nonexistent-route-check', label: '404 route' },
];

test.describe('Accessibility audits with Axe', () => {
  for (const { path, label } of ROUTES_TO_AUDIT) {
    test(`zero serious/critical violations on ${label} (${path})`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .exclude('.react-flow__attribution')
        .analyze();

      const violations = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

      const failureMessage = violations
        .map(
          (v) =>
            `[${v.impact?.toUpperCase()}] ${v.id}: ${v.help}\n  Help URL: ${v.helpUrl}\n  Nodes affected (${v.nodes.length}):\n${v.nodes
              .map((n) => `    - Target: ${n.target.join(' ')}\n      HTML: ${n.html}`)
              .join('\n')}`,
        )
        .join('\n\n');

      expect(violations, failureMessage).toEqual([]);
    });
  }

  test('interactive controls meet minimum 44px touch target guideline on Home', async ({ page }) => {
    await page.goto('/');

    // Check all buttons have at least 44x44 px touch bounding box
    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, 'button bounding box').not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('all interactive buttons have accessible names', async ({ page }) => {
    await page.goto('/');

    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const accessibleName = await button.evaluate((el) => {
        return el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || '';
      });
      expect(accessibleName.length).toBeGreaterThan(0);
    }
  });
});
