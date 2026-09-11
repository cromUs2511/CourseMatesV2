import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: /email address/i }).fill(`${name}@gmail.com`);
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await expect(page.getByRole('heading', { name: 'Add an interest' })).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Chat message' }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-message-bubble] > p').last()).toHaveText(text);
}

test('reply quotes, text, photos and reactions stay contained on mobile and desktop', async ({ browser }) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([browser.newContext({ reducedMotion: 'reduce' }), browser.newContext({ reducedMotion: 'reduce' })]);
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(a, 'bubble-a');
    await signIn(b, 'bubble-b');
    await a.locator('#start-chat-btn').click();
    await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible();
    await expect(b.locator('#chat-header')).toBeVisible();
    const quote = "ok ill follow u later! p’wede ko ba ’to i-share sa friends ko orrrrrr — let's catch up after class and compare our notes.";
    await send(b, quote);
    await a.getByRole('button', { name: 'Reply', exact: true }).last().click();
    await expect(a.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
    await send(a, 'nah');
    await b.getByRole('button', { name: 'Reply', exact: true }).last().click();
    await send(b, 'Okay, no worries! I’ll keep it between us.');
    await a.getByRole('button', { name: 'React to message', exact: true }).nth(1).click();
    await a.getByRole('button', { name: 'Love', exact: true }).click();
    await expect(a.getByLabel('Love reaction, 1')).toBeVisible();

    for (const width of [320, 375, 768, 1280]) {
      await a.setViewportSize({ width, height: 900 });
      for (const mode of ['light', 'dark']) {
        const settings = a.getByRole('button', { name: 'Account and display settings' });
        if (await settings.isVisible()) await settings.click();
        const toggle = a.getByRole('button', { name: `Switch to ${mode} mode` });
        if (await toggle.count()) await toggle.click();
        await expect(a.getByRole('button', { name: `Switch to ${mode === 'light' ? 'dark' : 'light'} mode` })).toBeVisible();
        if (await settings.isVisible()) await a.keyboard.press('Escape');
        await a.screenshot({ path: `test-results/replies-${width}-${mode}.png`, animations: 'disabled' });
        const issues = await a.locator('[data-message-bubble]').evaluateAll(bubbles => bubbles.flatMap(bubble => {
          const box = bubble.getBoundingClientRect();
          const failures: string[] = [];
          if (box.left < 0 || box.right > innerWidth) failures.push('Bubble outside viewport');
          for (const child of bubble.querySelectorAll('p, blockquote, [data-reply-preview], img')) {
            const childBox = child.getBoundingClientRect();
            if (childBox.left < box.left || childBox.right > box.right) failures.push('Content outside bubble');
          }
          if (bubble.scrollWidth > bubble.clientWidth + 1) failures.push('Bubble has horizontal overflow');
          if (getComputedStyle(bubble).textAlign !== 'left') failures.push('Message is not left aligned');
          return failures;
        }));
        expect(issues).toEqual([]);
        const badge = await a.getByLabel('Love reaction, 1').boundingBox();
        const action = await a.getByRole('button', { name: 'React to message', exact: true }).nth(1).boundingBox();
        expect(badge!.y + badge!.height).toBeLessThanOrEqual(action!.y);
      }
    }
    await a.setViewportSize({ width: 320, height: 800 });
    await send(a, 'ok');
    const shortBubble = a.locator('[data-message-bubble]').filter({ has: a.locator('p', { hasText: /^ok$/ }) });
    expect((await shortBubble.boundingBox())!.width).toBeLessThan(100);
    // Long unbroken text must wrap in both the original and its quote.
    await send(b, 'https://example.com/' + 'long-path'.repeat(200));
    await a.getByRole('button', { name: 'Reply', exact: true }).last().click();
    await expect(a.getByRole('button', { name: 'Cancel reply' })).toBeInViewport();
    await a.getByLabel('Choose photos to attach').setInputFiles({
      name: 'Notes.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    });
    await a.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(a.getByRole('img', { name: 'Notes.png', exact: true })).toBeVisible();
    await expect(a.locator('[data-reply-preview]').last()).toBeVisible();
    expect(await a.locator('[data-reply-preview] > p').last().evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
    expect(await a.locator('#chat-messages-container').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await a.getByRole('button', { name: 'View photo Notes.png' }).click();
    await expect(a.getByRole('dialog', { name: 'Photo', exact: true })).toBeVisible();
    await a.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
