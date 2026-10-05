import { test, expect } from '@playwright/test';

test('aurora follows music and glow preferences and respects reduced motion', async ({ page }) => {
  await page.addInitScript(() => {
    // Exercise music state without depending on the external YouTube service.
    (window as any).YT = {
      Player: class {
        constructor(
          _element: HTMLElement,
          private options: any,
        ) {
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        loadVideoById() {
          this.playVideo();
        }
        cueVideoById() {}
        playVideo() {
          this.options.events.onStateChange({ target: this, data: 1 });
        }
        pauseVideo() {
          this.options.events.onStateChange({ target: this, data: 2 });
        }
        setVolume() {}
        mute() {}
        unMute() {}
        destroy() {}
      },
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();
  const aurora = page.locator('.ambient-aurora');
  await expect(aurora).toHaveCount(0);
  await page.getByRole('button', { name: 'Open music controls' }).click();
  await page.getByRole('button', { name: 'Play Study Music' }).click();
  await expect(aurora).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .getByRole('textbox', { name: 'Chat message' })
    .fill('A little music makes this study session better.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  // Restrained refinement: curtains stay behind chat, stay non-interactive,
  // shimmer gently inside the slow layer drift, and share one custom color.
  await expect(aurora).toHaveCSS('pointer-events', 'none');
  const distantFilter = await page
    .locator('.aurora-curtain-distant')
    .evaluate((el) => getComputedStyle(el).filter);
  expect(distantFilter).not.toContain('hue-rotate');
  const rayShimmerCount = await page
    .locator('.aurora-curtain img')
    .evaluateAll((els) =>
      els.flatMap((el) =>
        el.getAnimations().filter((animation) => animation.playState === 'running'),
      ),
    )
    .then((animations) => animations.length);
  expect(rayShimmerCount).toBeGreaterThan(0);
  const auroraZ = await aurora.evaluate((el) => getComputedStyle(el).zIndex);
  const chatZ = await page.locator('.chat-content').evaluate((el) => getComputedStyle(el).zIndex);
  expect(Number(chatZ)).toBeGreaterThan(Number(auroraZ));

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const mode of ['dark', 'light']) {
      const settings = page.getByRole('button', { name: 'Account and display settings' });
      if (await settings.isVisible()) await settings.click();
      const toggle = page.getByRole('button', { name: `Switch to ${mode} mode` });
      if (await toggle.isVisible()) await toggle.click();
      if (await settings.isVisible()) await page.keyboard.press('Escape');
      // Capture settled colors and a repeatable point in the slow curtain motion.
      await aurora.evaluate((el) =>
        el.getAnimations({ subtree: true }).forEach((animation) => {
          animation.pause();
          animation.currentTime = 12000;
        }),
      );
      await page.screenshot({
        path: `test-results/aurora-${width}-${mode}.png`,
        animations: 'disabled',
      });
      await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeInViewport();
      expect(
        await page.locator('.chat-theme-scope').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await aurora.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  // Reduced motion also freezes the inner ray shimmer, not just the layers.
  expect(
    await page
      .locator('.aurora-curtain img')
      .evaluateAll((els) => els.flatMap((el) => el.getAnimations())),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Open music controls' }).click();
  await page.getByLabel('Ambient glow color').fill('#a78bfa');
  await expect(aurora).toHaveCSS('--aurora-color', '#a78bfa');
  // The custom color tints the shared atmosphere, not just the SVG curtains.
  const atmosphereBefore = await page
    .locator('.aurora-atmosphere')
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  await page.getByLabel('Ambient glow color').fill('#22d3ee');
  await expect(aurora).toHaveCSS('--aurora-color', '#22d3ee');
  const atmosphereAfter = await page
    .locator('.aurora-atmosphere')
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(atmosphereAfter).not.toBe(atmosphereBefore);
  await page.getByLabel('Ambient glow', { exact: true }).uncheck();
  await expect(aurora).toHaveCount(0);
  await page.getByLabel('Ambient glow', { exact: true }).check();
  await expect(aurora).toBeVisible();
  await page.getByRole('button', { name: 'Pause Study Music' }).click();
  await expect(aurora).toHaveCount(0);
  expect(errors).toEqual([]);
});
