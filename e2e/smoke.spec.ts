import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home renders on a phone viewport with no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a conversation' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});

test('no phone frame on phone-sized viewports', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByTestId('phone-frame').boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
});
