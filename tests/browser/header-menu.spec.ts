import { test, expect } from '@playwright/test';

test('chat color picker stays inside mobile settings and the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: /student email/i }).fill('header-menu@mymail.mapua.edu.ph');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();

  for (const { width, height } of [
    { width: 320, height: 600 }, { width: 375, height: 667 },
    { width: 768, height: 600 }, { width: 980, height: 600 },
    { width: 1280, height: 600 }, { width: 320, height: 360 },
  ]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['dark', 'light']) {
      const settings = page.getByRole('button', { name: 'Account and display settings' });
      const mobile = await settings.isVisible();
      if (mobile) await settings.click();
      const toggle = page.getByRole('button', { name: `Switch to ${mode} mode` });
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole('button', { name: 'Choose chat color theme' }).click();
      const colors = page.getByRole('dialog', { name: 'Chat color themes' });
      await expect(colors).toBeVisible();
      const colorBox = (await colors.boundingBox())!;
      expect(colorBox.x).toBeGreaterThanOrEqual(0);
      expect(colorBox.x + colorBox.width).toBeLessThanOrEqual(width);
      if (mobile) {
        const panel = page.locator('#header-settings');
        const panelBox = (await panel.boundingBox())!;
        expect(colorBox.x).toBeGreaterThanOrEqual(panelBox.x);
        expect(colorBox.x + colorBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
        expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(height);
        expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      } else {
        expect(colorBox.y + colorBox.height).toBeLessThanOrEqual(height);
      }
      await page.screenshot({ path: `test-results/header-colors-${width}-${height}-${mode}.png`, animations: 'disabled' });
      await colors.getByRole('button', { name: 'Slate graphite' }).click();
      await expect(colors).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Choose chat color theme' })).toHaveAttribute('title', 'Chat theme: Slate graphite');
      if (mobile) await page.keyboard.press('Escape');
    }
  }
});
