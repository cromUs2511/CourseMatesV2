import { test, expect } from '@playwright/test';

test('main menu color picker keeps every label inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.getByRole('button', { name: 'Choose chat color theme' }).click();
  const colors = page.getByRole('dialog', { name: 'Chat color themes' });
  const box = (await colors.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(363);
  for (const button of await colors.getByRole('button').all()) {
    const label = button.locator('span').last();
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 360 });
  const resized = (await colors.boundingBox())!;
  expect(resized.x).toBeGreaterThanOrEqual(12);
  expect(resized.x + resized.width).toBeLessThanOrEqual(308);
});

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
  await page
    .getByRole('dialog', { name: 'Chat color themes' })
    .getByRole('button', { name: 'Ocean blue' })
    .click();
  await expect(colorsButton).toHaveAttribute('title', 'Chat theme: Ocean blue');
  await expect(page.locator('.ambient-grid')).toHaveCSS('background-color', 'rgb(242, 248, 252)');
  await expect(page.getByRole('button', { name: 'Shuffle default name' })).toHaveCSS(
    'color',
    'rgb(18, 103, 130)',
  );
  const headerBackground = await page
    .locator('#main-header')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  // Tailwind emits color-mix(in oklab, ...) in dev; the production CSS minifier
  // resolves the same colour to rgba. Both are the Ocean header surface.
  expect(['rgba(255, 253, 250, 0.82)', 'oklab(0.994737 0.000958711 0.00442898 / 0.82)']).toContain(
    headerBackground,
  );
  await expect(page.locator('.ui-surface').first()).toHaveCSS(
    'background-color',
    'rgba(255, 255, 255, 0.94)',
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('coursemates_chat_theme')))
    .toBe('ocean');
});

test('main header switch, leave button, and handle indicator use the smaller scale', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();

  const switchButton = page.getByRole('button', { name: 'Switch to dark mode' });
  const leaveButton = page.locator('#logout-btn');
  const handle = page.locator('#main-header span[title]').first();
  await expect(switchButton).toBeVisible();
  await expect(leaveButton).toBeVisible();
  await expect(handle).toBeVisible();
  const switchBox = (await switchButton.boundingBox())!;
  const leaveBox = (await leaveButton.boundingBox())!;
  const handleHeight = await handle.evaluate(
    (element) => element.parentElement!.getBoundingClientRect().height,
  );
  expect(switchBox.height).toBeLessThanOrEqual(28);
  expect(leaveBox.height).toBeLessThanOrEqual(28);
  expect(handleHeight).toBeLessThanOrEqual(26);
});

test('chat color picker stays inside mobile settings and the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();

  for (const { width, height } of [
    { width: 320, height: 600 },
    { width: 375, height: 667 },
    { width: 768, height: 600 },
    { width: 980, height: 600 },
    { width: 1280, height: 600 },
    { width: 320, height: 360 },
  ]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['dark', 'light']) {
      const settings = page.getByRole('button', { name: 'Account and display settings' });
      const mobile = await settings.isVisible();
      if (mobile) await settings.click();
      const toggle = page.getByRole('button', { name: `Switch to ${mode} mode` });
      if (await toggle.isVisible()) await toggle.click();
      const colorButton = page.getByRole('button', { name: 'Choose chat color theme' });
      if (mobile && !(await colorButton.isVisible())) await settings.click();
      await colorButton.click();
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
        expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      } else {
        expect(colorBox.y + colorBox.height).toBeLessThanOrEqual(height);
      }
      await page.screenshot({
        path: `test-results/header-colors-${width}-${height}-${mode}.png`,
        animations: 'disabled',
      });
      await colors.getByRole('button', { name: 'Slate graphite' }).click();
      await expect(colors).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Choose chat color theme' })).toHaveAttribute(
        'title',
        'Chat theme: Slate graphite',
      );
      if (mobile) await page.keyboard.press('Escape');
    }
  }
});

test('chat header groups sound, color, music, and fullscreen controls in one compact strip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();

  const controls = page.getByRole('group', { name: 'Chat display controls' });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Disable chat sound' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Choose chat color theme' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Open music controls' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Enter Fullscreen' })).toBeVisible();
});

test('music modal groups playback controls separately from its library', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  await page.getByRole('button', { name: 'Open music controls' }).click();
  const modal = page.getByRole('region', { name: 'Choose music' });
  const playback = modal.getByRole('group', { name: 'Music playback controls' });
  await expect(playback).toBeVisible();
  await expect(playback.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
  await expect(playback.getByRole('slider', { name: 'Music volume' })).toBeVisible();
});

test('mobile chat theme picker keeps its full grid width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await page.getByRole('button', { name: 'Account and display settings' }).click();
  await page.getByRole('button', { name: 'Choose chat color theme' }).click();

  const picker = page.getByRole('dialog', { name: 'Chat color themes' });
  await expect(picker).toBeVisible();
  expect((await picker.boundingBox())!.width).toBeGreaterThanOrEqual(240);
  await expect(picker.getByRole('button', { name: 'Graphite neon' })).toBeVisible();
});

test('chat theme grid anchors to the settings panel instead of clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();
  await page.getByRole('button', { name: 'Account and display settings' }).click();
  await page.getByRole('button', { name: 'Choose chat color theme' }).click();

  const picker = page.getByRole('dialog', { name: 'Chat color themes' });
  await expect(picker).toBeVisible();
  const panel = page.locator('#header-settings');
  const pickerBox = (await picker.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  const pickerRight = pickerBox.x + pickerBox.width;
  const pickerBottom = pickerBox.y + pickerBox.height;
  const panelRight = panelBox.x + panelBox.width;
  // Right-aligned with the panel and fully inside the viewport.
  expect(pickerRight).toBeLessThanOrEqual(panelRight + 1);
  expect(pickerBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
  expect(pickerBottom).toBeLessThanOrEqual(720);
  // The grid overlays instead of hiding inside the panel scroll area.
  expect(await panel.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await picker.getByRole('button', { name: 'Ocean blue' }).click();
  await expect(page.getByRole('button', { name: 'Choose chat color theme' })).toHaveAttribute(
    'title',
    'Chat theme: Ocean blue',
  );
});

test('selected chat theme colors every chat display control', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const controls = page.getByRole('group', { name: 'Chat display controls' });
  await controls.getByRole('button', { name: 'Choose chat color theme' }).click();
  await page
    .getByRole('dialog', { name: 'Chat color themes' })
    .getByRole('button', { name: 'Violet dusk' })
    .click();

  await expect(controls.getByRole('button', { name: 'Disable chat sound' })).toHaveCSS(
    'color',
    'rgb(112, 75, 155)',
  );
  await expect(controls.getByRole('button', { name: 'Open music controls' })).toHaveCSS(
    'color',
    'rgb(112, 75, 155)',
  );
  await expect(controls.getByRole('button', { name: 'Enter Fullscreen' })).toHaveCSS(
    'color',
    'rgb(112, 75, 155)',
  );
});

test('chat display icons have no shared control-shell chrome and fit mobile settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const controls = page.getByRole('group', { name: 'Chat display controls' });
  await expect(controls).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(controls).toHaveCSS('border-top-style', 'none');

  await page.setViewportSize({ width: 320, height: 600 });
  await page.getByRole('button', { name: 'Account and display settings' }).click();
  await expect(controls).toBeVisible();
  expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
});

test('chat header icons are transparent at rest and glow on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const controls = page.getByRole('group', { name: 'Chat display controls' });
  const music = controls.getByRole('button', { name: 'Open music controls' });
  await expect(music).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(music).toHaveCSS('border-top-style', 'none');
  await music.hover();
  await expect(music).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('main menu keeps its sound icon chrome-free', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();

  const sound = page.getByRole('button', { name: 'Disable chat sound' });
  await expect(sound).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(sound).toHaveCSS('border-top-style', 'none');
});

test('send appears after focusing the composer and the theme control remains a light-dark switch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();

  const siteToggle = page.getByRole('button', { name: 'Switch to dark mode' });
  await expect(siteToggle).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect((await siteToggle.boundingBox())!.width).toBeGreaterThanOrEqual(48);
  await expect(siteToggle.locator('> span').first()).toHaveCSS(
    'border-top-color',
    'rgb(153, 27, 27)',
  );
  await expect(siteToggle.locator('> span').first()).toHaveCSS('border-top-width', '2px');
  await expect(siteToggle.locator('> span').first()).toHaveCSS('box-shadow', 'none');
  await siteToggle.click();
  await expect(page.locator('#dark-mode-toggle-btn')).toHaveCSS(
    'background-color',
    'rgb(42, 42, 42)',
  );
  await expect(page.locator('#dark-mode-toggle-btn')).toHaveAttribute(
    'aria-label',
    'Switch to light mode',
  );
  await expect(page.locator('#dark-mode-toggle-btn').locator('> span').first()).toHaveCSS(
    'background-color',
    'rgb(20, 19, 18)',
  );

  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  const send = page.locator('#send-message-btn');
  await expect(send).toBeHidden();
  await expect(page.getByRole('button', { name: 'Attach photos' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Record with microphone' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Send music snippet' })).toBeHidden();
  await page.getByRole('textbox', { name: 'Chat message' }).click();
  await expect(send).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach photos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record with microphone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send music snippet' })).toBeVisible();
  const sendBox = (await send.boundingBox())!;
  expect(sendBox.width).toBe(40);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(375);

  const mobileToggle = page.locator('#mobile-dark-mode-toggle-btn');
  await expect(mobileToggle).toBeVisible();
  expect((await mobileToggle.boundingBox())!.width).toBe(48);
  expect((await mobileToggle.boundingBox())!.height).toBe(28);
  await page.locator('#chat-messages-container').click({ position: { x: 8, y: 8 } });
  await expect(send).toBeHidden();
  await expect(page.getByRole('button', { name: 'Attach photos' })).toBeHidden();
});

test('chat bubbles leave breathing room below metadata while keeping compact readable text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await page
    .getByRole('textbox', { name: 'Chat message' })
    .fill('A compact message should remain comfortable to read.');
  await page.locator('#send-message-btn').click();

  const row = page.locator('.chat-message-row').last();
  const metadata = row.locator(':scope > div').first();
  const bubble = row.locator('[data-message-bubble]');
  await expect(bubble).toHaveCSS('font-size', '14px');
  await expect(bubble).toHaveCSS('line-height', '21px');
  const metadataBox = (await metadata.boundingBox())!;
  const bubbleBox = (await bubble.boundingBox())!;
  expect(bubbleBox.y - (metadataBox.y + metadataBox.height)).toBeGreaterThanOrEqual(8);
});

test('profile card shows the anonymous-session detail only once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByText('Anonymous community session', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Private session', { exact: true })).toBeVisible();
});

test('a custom name can be changed back to a random default handle', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.getByTitle('Change name').click();
  await page.getByRole('textbox', { name: 'Custom name' }).fill('Custom Study Name');
  await page.getByRole('button', { name: 'Save' }).click();
  const profileName = page.getByRole('main').getByText('Custom Study Name', { exact: true });
  await expect(profileName).toBeVisible();
  await page.getByRole('button', { name: 'Use random name' }).click();
  await expect(profileName).toHaveCount(0);
  await expect(page.getByTitle('Shuffle default name')).toBeVisible();
});

test('mobile chat header shows a compact centered identity without the matching topic', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const header = page.locator('#chat-header');
  const name = header.locator('.chat-header-peer-name');
  const status = header.locator('.chat-header-status');
  await expect(name).toBeVisible();
  // The peer/chatbot type chip is gone; only the presence label stays.
  await expect(header.getByText('AI', { exact: true })).toHaveCount(0);
  await expect(header.getByText('Peer', { exact: true })).toHaveCount(0);
  await expect(header.getByText('Active', { exact: true })).toBeVisible();
  await expect(header.getByText('General Peer Discovery')).toHaveCount(0);
  const headerBox = (await header.boundingBox())!;
  const nameBox = (await name.boundingBox())!;
  const statusBox = (await status.boundingBox())!;
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
  expect(statusBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
  expect(
    Math.abs(nameBox.x + nameBox.width / 2 - (statusBox.x + statusBox.width / 2)),
  ).toBeLessThanOrEqual(2);
  expect(headerBox.height).toBeLessThanOrEqual(68);
});

test('narrow chat header keeps the assistant name and status in one column', async ({ page }) => {
  await page.setViewportSize({ width: 286, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const header = page.locator('#chat-header');
  const name = header.locator('.chat-header-peer-name');
  await expect(header.getByText('Active', { exact: true })).toBeVisible();
  await expect(header.getByText('AI', { exact: true })).toHaveCount(0);
  const badge = header.locator('.chat-header-status');
  const nameBox = (await name.boundingBox())!;
  const badgeBox = (await badge.boundingBox())!;
  const headerBox = (await header.boundingBox())!;

  await expect(name).toHaveCSS('text-align', 'center');
  expect(badgeBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
  expect(badgeBox.x).toBeGreaterThanOrEqual(headerBox.x);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
});

test('narrow chat header keeps one theme switch outside settings', async ({ page }) => {
  await page.setViewportSize({ width: 286, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const header = page.locator('#chat-header');
  const themeToggle = page.locator('#mobile-dark-mode-toggle-btn');
  await expect(themeToggle).toBeVisible();

  await page.getByRole('button', { name: 'Account and display settings' }).click();
  await expect(
    page.locator('#header-settings').getByRole('button', { name: 'Switch to dark mode' }),
  ).toHaveCount(0);

  const headerBox = (await header.boundingBox())!;
  const nameBox = (await header.locator('.chat-header-peer-name').boundingBox())!;
  expect(nameBox.width).toBeGreaterThanOrEqual(120);
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
});
test('the mobile chat header slides up while composing and settles back when dismissed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();

  const header = page.locator('#chat-header');
  await expect(header).toBeVisible();

  await page.getByRole('textbox', { name: 'Chat message' }).click();
  await expect(header).toBeHidden();

  // Dismissing the composer restores the header and its working theme switch.
  await page.locator('#chat-messages-container').click({ position: { x: 8, y: 8 } });
  await expect(header).toBeVisible();
  const themeToggle = page.locator('#mobile-dark-mode-toggle-btn');
  await expect(themeToggle).toBeVisible();
  await themeToggle.click();
  await expect(page.locator('html')).toHaveClass('dark');
  await expect(themeToggle).toHaveAttribute('aria-pressed', 'true');
});
