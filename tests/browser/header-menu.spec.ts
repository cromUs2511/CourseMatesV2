import { test, expect } from '@playwright/test';

test('main menu logout confirmation is centered in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.getByRole('button', { name: 'Disconnect and log out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log out?' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(320);
});

test('main menu exposes light-dark and chat color controls together', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  const colorsButton = page.getByRole('button', { name: 'Choose chat color theme' });
  await expect(colorsButton).toBeVisible();
  await colorsButton.click();
  await page.getByRole('dialog', { name: 'Chat color themes' }).getByRole('button', { name: 'Ocean blue' }).click();
  await expect(colorsButton).toHaveAttribute('title', 'Chat theme: Ocean blue');
  await expect(page.locator('.ambient-grid')).toHaveCSS('background-color', 'rgb(242, 248, 252)');
  await expect(page.getByRole('button', { name: 'Use a custom name' })).toHaveCSS('color', 'rgb(18, 103, 130)');
  await expect(page.getByText('Anonymous community session').first()).toHaveCSS('color', 'rgb(18, 103, 130)');
  await expect(page.locator('#main-header')).toHaveCSS('background-color', 'rgba(255, 253, 250, 0.82)');
  await expect(page.locator('.ui-surface').first()).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.94)');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('coursemates_chat_theme'))).toBe('ocean');
});

test('chat color picker stays inside mobile settings and the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
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
