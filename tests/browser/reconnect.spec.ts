import { test, expect, type Page, type Browser } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}
async function match(a: Page, b: Page) {
  await a.locator('#start-chat-btn').click();
  await b.locator('#start-chat-btn').click();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Chat message' }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
async function endChat(page: Page) {
  await page.locator('#leave-chat-btn').click();
  await page.getByRole('dialog').getByRole('button', { name: 'End chat' }).click();
}
// Best-effort hygiene so a failed test never leaves a queued or chatting
// ghost behind for the next test to match with.
async function cleanup(page: Page) {
  await page
    .evaluate(() =>
      fetch('/api/match/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
      }).catch(() => {}),
    )
    .catch(() => {});
}

test('reloading mid-chat restores the same chat with its messages', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  try {
    await signIn(a);
    await signIn(b);
    await match(a, b);
    await send(a, 'still here after reload');
    await expect(b.getByText('still here after reload', { exact: true })).toBeVisible();
    await a.reload();
    // The same chat comes back with its history instead of matchmaking.
    await expect(a.getByRole('textbox', { name: 'Chat message' })).toBeVisible({
      timeout: 15000,
    });
    await expect(a.getByText('still here after reload', { exact: true })).toBeVisible();
    // The peer who stayed was never told the chat ended.
    await expect(b.getByText('Peer disconnected')).toHaveCount(0);
    await expect(b.locator('#chat-header')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await cleanup(a);
    await cleanup(b);
    await first.close();
    await second.close();
  }
});

test('going offline shows Reconnecting and recovery syncs missed messages', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  try {
    await signIn(a);
    await signIn(b);
    await match(a, b);
    await a.context().setOffline(true);
    await expect(a.getByText(/Reconnecting/)).toBeVisible({ timeout: 15000 });
    await send(b, 'missed while offline');
    await expect(b.getByText('missed while offline', { exact: true })).toBeVisible();
    await a.context().setOffline(false);
    await expect(a.getByText(/Reconnecting/)).toBeHidden({ timeout: 20000 });
    await expect(a.getByText('missed while offline', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(errors).toEqual([]);
  } finally {
    await cleanup(a);
    await cleanup(b);
    await first.close();
    await second.close();
  }
});

test('returning after the peer ended shows the honest ended state with a way forward', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  try {
    await signIn(a);
    await signIn(b);
    await match(a, b);
    await a.context().setOffline(true);
    await expect(a.getByText(/Reconnecting/)).toBeVisible({ timeout: 15000 });
    await endChat(b);
    // The leaver honestly sees the ended state with a way forward too.
    await expect(b.getByText('Peer disconnected from this session')).toBeVisible();
    await expect(b.getByRole('button', { name: 'Next peer', exact: true })).toBeVisible();
    await a.context().setOffline(false);
    await expect(a.getByText('Peer disconnected from this session')).toBeVisible({
      timeout: 20000,
    });
    await expect(a.getByRole('button', { name: 'Next peer', exact: true })).toBeVisible();
    // The way forward works: back to matchmaking for a new peer.
    await a.getByRole('button', { name: 'Next peer', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
  } finally {
    await cleanup(a);
    await cleanup(b);
    await first.close();
    await second.close();
  }
});

test('restore works over polling when WebSockets are unavailable', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  for (const context of [first, second])
    await context.addInitScript(() => {
      window.WebSocket = class {
        constructor() {
          throw new Error('Blocked for reconnect fallback test');
        }
      } as any;
    });
  const a = await first.newPage();
  const b = await second.newPage();
  try {
    await signIn(a);
    await signIn(b);
    // Socket-less matching falls back to REST and can take a few ticks.
    await a.locator('#start-chat-btn').click();
    await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible({ timeout: 20000 });
    await expect(b.locator('#chat-header')).toBeVisible({ timeout: 20000 });
    await send(a, 'polling keeps this chat');
    await expect(b.getByText('polling keeps this chat', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await a.reload();
    await expect(a.getByRole('textbox', { name: 'Chat message' })).toBeVisible({
      timeout: 20000,
    });
    await expect(a.getByText('polling keeps this chat', { exact: true })).toBeVisible({
      timeout: 15000,
    });
  } finally {
    await cleanup(a);
    await cleanup(b);
    await first.close();
    await second.close();
  }
});

test('reloading a simulated chat returns to matchmaking without an error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page);
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();
  await page.reload();
  // Simulated chats have no server room to rejoin: matchmaking, honestly.
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible({
    timeout: 15000,
  });
  expect(errors).toEqual([]);
});
