import { test, expect } from '@playwright/test';

test('aurora follows music and glow preferences and respects reduced motion', async ({ page }) => {
  await page.addInitScript(() => {
    // Exercise music state without depending on the external YouTube service.
    (window as any).YT = { Player: class {
      constructor(_element: HTMLElement, private options: any) {
        setTimeout(() => options.events.onReady({ target: this }), 0);
      }
      loadVideoById() { this.playVideo(); }
      cueVideoById() {}
      playVideo() { this.options.events.onStateChange({ target: this, data: 1 }); }
      pauseVideo() { this.options.events.onStateChange({ target: this, data: 2 }); }
      setVolume() {}
      mute() {}
      unMute() {}
      destroy() {}
    } };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('textbox', { name: /student email/i }).fill('aurora-review@mymail.mapua.edu.ph');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();
  const aurora = page.locator('.ambient-aurora');
  await expect(aurora).toHaveCount(0);
  await page.getByRole('button', { name: 'Open music controls' }).click();
  await page.getByRole('button', { name: 'Play Study Music' }).click();
  await expect(aurora).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Chat message' }).fill('A little music makes this study session better.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const mode of ['dark', 'light']) {
      const settings = page.getByRole('button', { name: 'Account and display settings' });
      if (await settings.isVisible()) await settings.click();
      const toggle = page.getByRole('button', { name: `Switch to ${mode} mode` });
      if (await toggle.isVisible()) await toggle.click();
      if (await settings.isVisible()) await page.keyboard.press('Escape');
      // Capture settled colors and a repeatable point in the slow curtain motion.
      await aurora.evaluate(el => el.getAnimations({ subtree: true }).forEach(animation => {
        animation.pause();
        animation.currentTime = 12000;
      }));
      await page.screenshot({ path: `test-results/aurora-${width}-${mode}.png`, animations: 'disabled' });
      await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeInViewport();
      expect(await page.locator('.chat-theme-scope').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await aurora.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.getByRole('button', { name: 'Open music controls' }).click();
  await page.getByLabel('Ambient glow color').fill('#a78bfa');
  await expect(aurora).toHaveCSS('--aurora-color', '#a78bfa');
  await page.getByLabel('Ambient glow', { exact: true }).uncheck();
  await expect(aurora).toHaveCount(0);
  await page.getByLabel('Ambient glow', { exact: true }).check();
  await expect(aurora).toBeVisible();
  await page.getByRole('button', { name: 'Pause Study Music' }).click();
  await expect(aurora).toHaveCount(0);
  expect(errors).toEqual([]);
});
