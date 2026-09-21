import { test, expect } from '@playwright/test';

test('a chosen music slice reaches the peer with its caption, playback window, and actions', async ({ browser }) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) await context.addInitScript(() => {
      (window as any).snippetLoads = [];
      (window as any).YT = { Player: class {
        private options: any;
        constructor(host: HTMLElement, options: any) {
          this.options = options;
          const iframe = document.createElement('iframe');
          iframe.title = 'YouTube snippet';
          iframe.width = String(options.width);
          iframe.height = String(options.height);
          host.replaceWith(iframe);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        loadVideoById(value: any) { (window as any).snippetLoads.push(value); this.options.events.onStateChange({ target: this, data: 1 }); }
        cueVideoById() {}
        playVideo() { this.options.events.onStateChange({ target: this, data: 1 }); }
        pauseVideo() { this.options.events.onStateChange({ target: this, data: 2 }); }
        getCurrentTime() { return 45; }
        destroy() {}
      } };
    });
    const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [a, b]) {
      await page.goto('/');
      await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
      await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
    }
    await a.locator('#start-chat-btn').click();
    await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible();
    await expect(b.locator('#chat-header')).toBeVisible();

    await a.getByRole('button', { name: 'Send music snippet' }).click();
    const picker = a.getByRole('dialog', { name: 'Send music snippet' });
    await picker.getByRole('button', { name: 'Select Loser by Tame Impala' }).click();
    await picker.getByRole('slider', { name: 'Snippet start' }).fill('45');
    await picker.getByRole('combobox', { name: 'Snippet length' }).selectOption('30');
    await picker.getByRole('textbox', { name: 'Add a note' }).fill('Listening to this vibe right now');
    await picker.getByRole('button', { name: 'Preview snippet' }).click();
    await expect.poll(() => a.evaluate(() => (window as any).snippetLoads.at(-1))).toMatchObject({ videoId: 's3a4OQR-10M', startSeconds: 45, endSeconds: 75 });
    await picker.getByRole('button', { name: 'Send snippet' }).click();
    await expect(picker).toHaveCount(0);

    const card = b.getByRole('group', { name: 'Music snippet: Loser by Tame Impala' });
    await expect(card).toBeVisible();
    await expect(b.getByText('Listening to this vibe right now', { exact: true })).toBeVisible();
    await expect(card.getByText('0:45–1:15')).toBeVisible();
    await card.getByRole('button', { name: 'Play music snippet' }).click();
    await expect.poll(() => b.evaluate(() => (window as any).snippetLoads.at(-1))).toMatchObject({ videoId: 's3a4OQR-10M', startSeconds: 45, endSeconds: 75 });
    await expect(card.getByRole('button', { name: 'Pause music snippet' })).toBeVisible();
    await expect(card.locator('iframe')).toBeHidden();
    await expect(b.getByLabel('Visible YouTube snippet player')).toHaveCount(0);
    await expect(b.getByLabel('Music snippet reactions').getByRole('button', { name: 'Love' })).toBeVisible();
    await b.getByLabel('Music snippet reactions').getByRole('button', { name: 'Love' }).click();
    await expect(a.getByRole('button', { name: 'Love reaction, 1' })).toBeVisible();
    await b.getByRole('button', { name: 'More message actions' }).click();
    await expect(b.getByRole('dialog', { name: 'Message actions' }).getByRole('button', { name: 'Copy' })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
