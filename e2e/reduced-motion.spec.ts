/// <reference lib="dom" />

import { expect, test } from '@playwright/test';

/**
 * Reduced-Motion Spec (owner: A5)
 *
 * Scope (docs/briefs/a5-qa-review.md):
 *   page.emulateMedia({ reducedMotion: 'reduce' }): no running animations.
 *
 * Requirements:
 *   - CSS variable `--motion: 0` is active under prefers-reduced-motion: reduce
 *   - document.getAnimations() has zero active/running animations
 *   - Canvas animations (starfield, edge particle flows) render static frames
 */

const ROUTES = [
  '/',
  '/login',
  '/live/8d13b192-38d0-4ba3-a3c8-7834f6573947',
  '/c/8d13b192-38d0-4ba3-a3c8-7834f6573947',
  '/brain',
  '/favorites',
  '/settings',
];

test.describe('Reduced-Motion Compliance', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('prefers-reduced-motion media query and --motion token evaluate correctly', async ({ page }) => {
    await page.goto('/');

    const mediaMatches = await page.evaluate(() => {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });
    expect(mediaMatches).toBe(true);

    const motionToken = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).getPropertyValue('--motion').trim();
    });
    expect(motionToken).toBe('0');
  });

  for (const route of ROUTES) {
    test(`zero running CSS or Web Animations on route "${route}" when reduced-motion is active`, async ({
      page,
    }) => {
      await page.goto(route);
      await expect(page.locator('main, [role="main"], [data-testid="live-screen"]')).toBeVisible();

      // Give 200ms for any potential animations to start
      await page.waitForTimeout(200);

      const runningAnimations = await page.evaluate(() => {
        const anims = document.getAnimations();
        return anims
          .filter((a) => {
            if (a.playState !== 'running') return false;
            if (a.playbackRate === 0) return false;
            const effect = a.effect;
            if (effect && 'getTiming' in effect) {
              const timing = effect.getTiming();
              if (timing.duration === 0) return false;
            }
            return true;
          })
          .map((a) => {
            const cssAnim = a instanceof CSSAnimation ? a.animationName : 'WebAnimation';
            return {
              name: cssAnim,
              playState: a.playState,
              playbackRate: a.playbackRate,
            };
          });
      });

      expect(runningAnimations, `Active running animations found on ${route}`).toEqual([]);
    });
  }

  test('starfield canvas renders a static frame without continuous animation loops', async ({ page }) => {
    await page.goto('/');

    const canvas = page.locator('canvas[data-testid="starfield"]');
    const hasCanvas = await canvas.isVisible().catch(() => false);

    test.fixme(!hasCanvas, 'Owned by A4: Starfield canvas component not yet mounted on Home');

    // Once A4 starfield canvas lands:
    // Sample canvas pixel data across two animation frames to ensure static rendering
    const isStatic = await page.evaluate(async () => {
      const el = document.querySelector('canvas[data-testid="starfield"]') as HTMLCanvasElement | null;
      if (!el) return true;
      const ctx = el.getContext('2d');
      if (!ctx) return true;

      const frame1 = ctx.getImageData(0, 0, el.width, el.height).data.toString();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const frame2 = ctx.getImageData(0, 0, el.width, el.height).data.toString();

      return frame1 === frame2;
    });

    expect(isStatic, 'Canvas starfield should be a static frame when reduced-motion is requested').toBe(true);
  });
});
