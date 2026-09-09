import { test, expect, type Page } from '@playwright/test';
async function signIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: /student email/i }).fill(name + '@mymail.mapua.edu.ph');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await expect(page.getByRole('heading', { name: 'Add an interest' })).toBeVisible();
}
test('two browser sessions match, exchange once, preserve drafts on failure and rematch', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage(), b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', error => errors.push(error.message));
  b.on('pageerror', error => errors.push(error.message));
  await signIn(a, 'first');
  await signIn(b, 'second');
  await a.locator('#start-chat-btn').click();
  await b.locator('#start-chat-btn').click();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();
  await a.getByRole('textbox', { name: 'Chat message' }).fill('Hello from the first student');
  await expect(b.getByText(/is typing/)).toBeVisible();
  await a.locator('#send-message-btn').click();
  await expect(b.getByText('Hello from the first student', { exact: true })).toHaveCount(1);
  await expect(a.getByText('Hello from the first student', { exact: true })).toHaveCount(1);
  await b.getByRole('textbox', { name: 'Chat message' }).fill('Hello back');
  await b.locator('#send-message-btn').click();
  await expect(a.getByText('Hello back', { exact: true })).toHaveCount(1);
  await a.route('**/api/chat/send', route => route.fulfill({ status: 503, json: { error: 'Test delivery failure' } }));
  await a.getByRole('textbox', { name: 'Chat message' }).fill('Keep this draft');
  await a.locator('#send-message-btn').click();
  await expect(a.getByRole('alert')).toHaveText('Test delivery failure');
  await expect(a.getByRole('textbox', { name: 'Chat message' })).toHaveValue('Keep this draft');
  await a.unroute('**/api/chat/send');
  await b.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await expect(b.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
  await a.locator('#leave-chat-btn').click();
  await expect(b.getByRole('button', { name: 'Cancel reply' })).toHaveCount(0);
  await expect(b.getByText('Peer disconnected from this session')).toBeVisible();
  await expect(b.getByText('Hello back', { exact: true })).toHaveCount(0);
  await b.locator('#next-match-btn').click();
  await expect(b.getByText(/Finding active Mapúa study peers/)).toBeVisible();
  await a.locator('#start-chat-btn').click();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();
  await a.locator('#logout-btn').click();
  await b.locator('#logout-btn').click();
  expect(errors).toEqual([]);
  await first.close(); await second.close();
});
test('HTTP fallback matches and delivers when WebSockets are unavailable', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  for (const context of contexts) await context.addInitScript(() => {
    window.WebSocket = class { constructor() { throw new Error('Blocked for fallback test'); } } as any;
  });
  const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
  await signIn(a, 'fallback-a'); await signIn(b, 'fallback-b');
  await a.locator('#start-chat-btn').click(); await b.locator('#start-chat-btn').click();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();
  await a.getByRole('textbox', { name: 'Chat message' }).fill('HTTP fallback works');
  await a.locator('#send-message-btn').click();
  await expect(b.getByText('HTTP fallback works', { exact: true })).toHaveCount(1);
  await a.locator('#logout-btn').click(); await b.locator('#logout-btn').click();
  await Promise.all(contexts.map(c => c.close()));
});
test('mobile layout, theme persistence, demo chat and music controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass('dark');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass('dark');
  await signIn(page, 'mobile');
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.getByText('Demo conversation with a simulated study partner.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeInViewport();
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
    const style = getComputedStyle(el); const box = el.getBoundingClientRect();
    return style.position === 'fixed' && box.right > innerWidth + 1;
  }).length);
  expect(overflow).toBe(0);
  await page.screenshot({ path: 'test-results/mobile-chat.png' });
  await expect(page.getByRole('region', { name: 'Study music player' })).toHaveCount(0);
  await page.locator('#music-play-toggle-btn').click();
  await expect(page.getByRole('region', { name: 'Study music player' })).toBeVisible();
  await page.getByRole('button', { name: 'Close music player' }).click();
  await expect(page.getByRole('region', { name: 'Study music player' })).toHaveCount(0);
  await page.locator('#logout-btn').click();
});
test('session restores after refresh and invalid emails show a readable error', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue in demo mode' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verify your account' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/desktop-login.png' });
  await signIn(page, 'restore');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Add an interest' })).toBeVisible();
  await page.locator('#logout-btn').click();
  await page.getByRole('textbox', { name: /student email/i }).fill('student@example.com');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await expect(page.getByText('Enter a valid Mapúa school email address.')).toBeVisible();
});


test('production does not expose the server bundle or source map', async ({ request }) => {
  test.skip(process.env.TEST_DEV === 'true');
  for (const path of ['/server.cjs', '/server.cjs.map', '/.server/server.cjs', '/.server/server.cjs.map']) {
    const response = await request.get(path);
    const body = await response.text();
    expect(body).not.toContain('sourcesContent');
    expect(body).not.toContain('MICROSOFT_CLIENT_SECRET');
    expect(response.headers()['content-type']).toContain('text/html');
  }
});


test('sign-in configuration failures remain visible without the demo form', async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ status: 503, json: { error: 'Sign-in configuration unavailable' } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('Sign-in configuration unavailable');
});

for (const source of ['directory', 'pasted link']) test(`shared ${source} music plays on both peers without restarting on volume changes`, async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) await context.addInitScript(() => {
      (window as any).musicLoads = [];
      (window as any).YT = { Player: class {
        constructor(_element: HTMLElement, private options: any) {
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        loadVideoById(id: string) { (window as any).musicLoads.push(id); this.playVideo(); }
        cueVideoById() {}
        playVideo() { this.options.events.onStateChange({ target: this, data: 1 }); }
        pauseVideo() { this.options.events.onStateChange({ target: this, data: 2 }); }
        setVolume() {}
        mute() {}
        unMute() {}
        destroy() {}
      } };
    });
    const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
    await signIn(a, 'music-a'); await signIn(b, 'music-b');
    await a.locator('#start-chat-btn').click(); await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible();
    await expect(b.locator('#chat-header')).toBeVisible();
    if (source === 'pasted link') {
      await a.locator('#top-music-bar button[aria-controls="music-tracks-dropdown"]').click();
      await a.getByRole('textbox', { name: 'Add YouTube link' }).fill('https://youtu.be/dQw4w9WgXcQ?si=shared');
      await a.getByRole('button', { name: 'Add YouTube link', exact: true }).click();
      for (const page of [a, b]) {
        await expect.poll(() => page.evaluate(() => (window as any).musicLoads)).toEqual(['dQw4w9WgXcQ']);
      }
    } else {
      await a.locator('#music-play-toggle-btn').click();
    }
    await expect(b.getByRole('region', { name: 'Study music player' })).toBeVisible();
    await expect(a.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
    await expect(b.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
    await a.getByRole('slider', { name: 'Music volume' }).fill('40');
    await expect(b.getByRole('slider', { name: 'Music volume' })).toHaveValue('40');
    expect(await a.evaluate(() => (window as any).musicLoads.length)).toBe(1);
    expect(await b.evaluate(() => (window as any).musicLoads.length)).toBe(1);
    await a.getByRole('slider', { name: 'Music volume' }).fill('0');
    await a.getByRole('slider', { name: 'Music volume' }).fill('55');
    await expect(b.getByRole('slider', { name: 'Music volume' })).toHaveValue('55');
    expect(await a.evaluate(() => (window as any).musicLoads.length)).toBe(1);
    expect(await b.evaluate(() => (window as any).musicLoads.length)).toBe(1);
    // The receiving peer can select a new custom track with both players already mounted.
    await b.getByRole('region', { name: 'Study music player' }).locator('button[aria-controls="music-tracks-dropdown"]').click();
    await b.getByRole('textbox', { name: 'Add YouTube link' }).fill('https://www.youtube.com/watch?v=jfKfPfyJRdk&list=example');
    await b.getByRole('button', { name: 'Add YouTube link', exact: true }).click();
    for (const page of [a, b]) {
      await expect.poll(() => page.evaluate(() => (window as any).musicLoads.at(-1))).toBe('jfKfPfyJRdk');
      await expect(page.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
    }
    await a.getByRole('button', { name: 'Pause Study Music' }).click();
    await expect(b.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
    await b.getByRole('button', { name: 'Play Study Music' }).click();
    await expect(a.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
    await a.locator('#logout-btn').click(); await b.locator('#logout-btn').click();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
