import { test, expect, type Page } from '@playwright/test';
async function signIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: /email address/i }).fill(name + '@gmail.com');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await expect(page.getByRole('heading', { name: 'Add an interest' })).toBeVisible();
}
async function logout(page: Page) {
  if (await page.getByRole('region', { name: 'Choose music' }).isVisible()) await page.keyboard.press('Escape');
  if (!await page.locator('#logout-btn').isVisible()) await page.getByRole('button', { name: 'Account and display settings' }).click();
  await page.locator('#logout-btn').click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
}
async function openMusic(page: Page) {
  if (!await page.getByRole('region', { name: 'Choose music' }).isVisible()) await page.getByRole('button', { name: 'Open music controls' }).click();
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
  await b.getByRole('button', { name: 'React to message', exact: true }).click();
  await b.getByRole('button', { name: 'Love', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Love reaction, 1' })).toBeVisible();
  await b.getByRole('button', { name: 'Love reaction, 1' }).click();
  await expect(a.getByRole('button', { name: 'Love reaction, 1' })).toHaveCount(0);
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
  await a.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(b.getByRole('button', { name: 'Cancel reply' })).toHaveCount(0);
  await expect(b.getByText('Peer disconnected from this session')).toBeVisible();
  await expect(b.getByText('Hello back', { exact: true })).toHaveCount(0);
  await b.locator('#next-match-btn').click();
  await b.getByRole('dialog').getByRole('button', { name: 'Find next peer' }).click();
  await expect(b.getByText(/Finding active study peers/)).toBeVisible();
  await a.locator('#start-chat-btn').click();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();
  await logout(a);
  await logout(b);
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
  await logout(a); await logout(b);
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
  await expect(page.getByText('Conversation with the Student Chatbot Assistant.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeInViewport();
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
    const style = getComputedStyle(el); const box = el.getBoundingClientRect();
    return style.position === 'fixed' && box.right > innerWidth + 1;
  }).length);
  expect(overflow).toBe(0);
  await page.screenshot({ path: 'test-results/mobile-chat.png' });
  await openMusic(page);
  await expect(page.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Music volume' })).toBeVisible();
  await logout(page);
});

test('mobile long press opens reactions and scrolling cancels the gesture', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await signIn(page, 'reactions');
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  const bubble = page.locator('[data-message-bubble]').last();
  await expect(bubble).toBeVisible();
  await bubble.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 100, clientY: 200 }] });
  await expect(page.getByRole('dialog', { name: 'React to message' })).toBeVisible();
  await bubble.dispatchEvent('touchend', { touches: [] });
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Like reaction, 1' })).toHaveAttribute('aria-pressed', 'true');
  await bubble.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 100, clientY: 200 }] });
  await bubble.dispatchEvent('touchmove', { touches: [{ identifier: 0, clientX: 100, clientY: 240 }] });
  await page.waitForTimeout(550);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await bubble.dispatchEvent('touchend', { touches: [] });
  await logout(page);
});
test('session restores after refresh and invalid emails show a readable error', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue in demo mode' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verify your account' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/desktop-login.png' });
  await signIn(page, 'restore');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Add an interest' })).toBeVisible();
  await logout(page);
  await page.getByRole('textbox', { name: /email address/i }).fill('student@localhost');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
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

for (const source of ['desktop', 'mobile', 'HTTP fallback', 'mobile autoplay']) test(`shared ${source} audio controls play, pause and change volume without exposing video`, async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const [index, context] of contexts.entries()) await context.addInitScript(({ fallback, blocked }) => {
      if (fallback) window.WebSocket = class { constructor() { throw new Error('Offline WebSocket'); } } as any;
      (window as any).musicUnlocked = !blocked;
      (window as any).musicLoads = [];
      document.addEventListener('click', event => {
        if ((event.target as Element).closest('#music-play-toggle-btn')) (window as any).musicUnlocked = true;
      }, true);
      (window as any).YT = { Player: class {
        constructor(element: HTMLElement, private options: any) {
          const iframe = document.createElement('iframe');
          iframe.title = 'Music video';
          element.replaceWith(iframe);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        loadVideoById(id: string) { (window as any).musicLoads.push(id); this.playVideo(); }
        cueVideoById() {}
        playVideo() {
          if (!(window as any).musicUnlocked) { this.options.events.onAutoplayBlocked({ target: this }); return; }
          this.options.events.onStateChange({ target: this, data: 1 });
        }
        pauseVideo() { this.options.events.onStateChange({ target: this, data: 2 }); }
        setVolume(volume: number) { (window as any).musicVolume = volume; }
        mute() { (window as any).musicMuted = true; }
        unMute() { (window as any).musicMuted = false; }
        destroy() {}
      } };
    }, { fallback: source === 'HTTP fallback', blocked: source === 'mobile autoplay' && index === 1 });
    const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
    if (source.includes('mobile')) for (const page of [a, b]) await page.setViewportSize({ width: 375, height: 667 });
    await signIn(a, 'music-a'); await signIn(b, 'music-b');
    await a.locator('#start-chat-btn').click(); await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible();
    await expect(b.locator('#chat-header')).toBeVisible();
    await openMusic(a);
    await a.getByRole('slider', { name: 'Music volume' }).fill('45');
    await expect(a.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
    await a.getByRole('button', { name: 'Play Study Music' }).click();
    if (source === 'mobile autoplay') {
      await expect(b.getByText('Press Play to enable sound on this device.')).toBeVisible();
      await openMusic(b);
      await b.getByRole('button', { name: 'Play Study Music' }).click();
      await expect(b.getByRole('status')).toHaveCount(0);
    }
    for (const page of [a, b]) {
      if (page === b && source !== 'mobile autoplay') {
        await openMusic(page);
      }
      await expect(page.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
      await expect(page.locator('#top-music-bar')).toHaveAttribute('data-playing', 'true');
      await expect(page.getByTestId('music-engine')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.getByTestId('music-engine')).toHaveCSS('opacity', '0');
      await expect(page.getByTestId('music-engine')).toHaveAttribute('inert', '');
      await expect(page.getByTestId('music-engine').locator('iframe')).toHaveCount(1);
      expect((await page.locator('#top-music-bar').boundingBox())!.height).toBeLessThanOrEqual(44);
    }
    await openMusic(a);
    await a.getByRole('button', { name: /lofi hip hop radio/ }).click();
    for (const page of [a, b]) await expect.poll(() => page.evaluate(() => (window as any).musicLoads.at(-1))).toBe('jfKfPfyJRdk');
    await a.route('**/api/music/search?q=*', route => route.fulfill({ json: { tracks: [{ id: 'custom-dQw4w9WgXcQ', title: 'Search result music', artist: 'Test artist', youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeVideoId: 'dQw4w9WgXcQ', category: 'custom' }] } }));
    await openMusic(a);
    await a.getByRole('searchbox', { name: 'Search music or paste a YouTube link' }).fill('test music');
    await a.getByRole('button', { name: 'Go', exact: true }).click();
    await a.getByRole('button', { name: /Search result music/ }).click();
    for (const page of [a, b]) await expect.poll(() => page.evaluate(() => (window as any).musicLoads.at(-1))).toBe('dQw4w9WgXcQ');
    await openMusic(b);
    await b.getByRole('searchbox', { name: 'Search music or paste a YouTube link' }).fill('https://youtu.be/5yx6BWlEVcY');
    await b.getByRole('button', { name: 'Go', exact: true }).click();
    for (const page of [a, b]) await expect.poll(() => page.evaluate(() => (window as any).musicLoads.at(-1))).toBe('5yx6BWlEVcY');
    await expect(b.getByRole('region', { name: 'Choose music' })).toHaveCount(0);
    await openMusic(b);
    await b.keyboard.press('Escape');
    await expect(b.getByRole('region', { name: 'Choose music' })).toHaveCount(0);
    const loads = await Promise.all([a, b].map(page => page.evaluate(() => (window as any).musicLoads.length)));
    await openMusic(a); await openMusic(b);
    await a.getByRole('slider', { name: 'Music volume' }).fill('40');
    await expect(b.getByRole('slider', { name: 'Music volume' })).toHaveValue('40');
    await expect.poll(() => b.evaluate(() => (window as any).musicVolume)).toBe(40);
    await a.getByRole('button', { name: 'Mute music', exact: true }).click();
    await expect(b.locator('#top-music-bar')).toHaveAttribute('data-playing', 'false');
    await expect.poll(() => b.evaluate(() => (window as any).musicMuted)).toBe(true);
    await a.getByRole('button', { name: 'Unmute music', exact: true }).click();
    await expect(b.locator('#top-music-bar')).toHaveAttribute('data-playing', 'true');
    await a.getByRole('button', { name: 'Pause Study Music' }).click();
    await expect(b.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
    await expect(a.locator('#top-music-bar')).toHaveAttribute('data-playing', 'false');
    await b.getByRole('button', { name: 'Play Study Music' }).click();
    await expect(a.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
    expect(await Promise.all([a, b].map(page => page.evaluate(() => (window as any).musicLoads.length)))).toEqual(loads);
    for (const width of [320, 375, 1280]) {
      await a.setViewportSize({ width, height: 800 });
      await expect(a.getByRole('button', { name: 'Pause Study Music' })).toBeInViewport();
      await expect(a.getByRole('slider', { name: 'Music volume' })).toBeInViewport();
      await expect(a.getByTestId('music-engine')).toHaveCSS('opacity', '0');
    }
    await a.screenshot({ path: `test-results/music-${source.replaceAll(' ', '-')}.png` });
    await logout(a); await logout(b);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
