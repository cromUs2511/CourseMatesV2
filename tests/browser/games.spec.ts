import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.locator('#start-chat-btn')).toBeVisible();
  await expect(page.locator('#open-uno-btn, #open-tictactoe-btn')).toHaveCount(0);
}

for (const polling of [false, true]) {
  test(`Tic Tac Toe shares invitations, turns, results and rematches (${polling ? 'REST recovery' : 'WebSocket'})`, async ({ browser }) => {
    test.setTimeout(polling ? 60000 : 30000);
    const first = await browser.newContext();
    const second = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const a = await first.newPage(), b = await second.newPage();
    const errors: string[] = [];
    try {
      for (const page of [a, b]) {
        page.on('pageerror', (error) => errors.push(error.message));
        if (polling) await page.routeWebSocket('**/ws/chat*', (socket) => socket.close());
        await enter(page);
      }
      await a.locator('#start-chat-btn').click();
      await b.locator('#start-chat-btn').click();
      await expect(a.locator('#chat-header')).toBeVisible();
      const invite = async () => {
        await a.getByRole('button', { name: 'Open the games catalog' }).click();
        await expect(a.getByRole('dialog', { name: 'Games' })).toBeVisible();
        await a.locator('#chat-game-tictactoe-btn').click();
        await expect(b.getByRole('region', { name: 'Tic Tac Toe invitation' })).toBeVisible();
      };
      await invite();
      await b.getByRole('button', { name: 'Decline', exact: true }).click();
      await expect(a.getByRole('region', { name: 'Tic Tac Toe invitation' })).toHaveCount(0);
      await invite();
      await b.getByRole('button', { name: 'Accept', exact: true }).click();
      for (const page of [a, b]) await expect(page.getByRole('group', { name: 'Tic Tac Toe board' })).toBeVisible();
      await expect(b.getByRole('button', { name: 'Square 1: empty', exact: true })).toBeDisabled();
      for (const [page, square, mark] of [[a, 1, 'X'], [b, 4, 'O'], [a, 2, 'X'], [b, 5, 'O'], [a, 3, 'X']] as const) {
        await page.getByRole('button', { name: `Square ${square}: empty`, exact: true }).click();
        for (const peer of [a, b]) await expect(peer.getByRole('button', { name: `Square ${square}: ${mark}`, exact: true })).toBeDisabled();
      }
      for (const page of [a, b]) {
        await expect(page.getByRole('status').filter({ hasText: /wins!/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Square 9: empty', exact: true })).toBeDisabled();
      }
      await a.getByRole('button', { name: 'Request rematch', exact: true }).click();
      await b.getByRole('button', { name: 'Accept rematch', exact: true }).click();
      await expect(b.getByRole('button', { name: 'Square 1: empty', exact: true })).toBeEnabled();
      // O starts round two. This sequence fills the board without a winning line.
      for (const [page, square] of [[b, 1], [a, 2], [b, 3], [a, 5], [b, 4], [a, 6], [b, 8], [a, 7], [b, 9]] as const) {
        await page.getByRole('button', { name: `Square ${square}: empty`, exact: true }).click();
      }
      for (const page of [a, b]) await expect(page.getByText('Draw — well played!')).toBeVisible();
      await b.getByRole('button', { name: 'Minimize Tic Tac Toe' }).click();
      await expect(b.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
      await b.getByRole('button', { name: 'Open the games catalog' }).click();
      await b.locator('#chat-game-tictactoe-btn').click();
      await expect(b.getByText('Draw — well played!')).toBeVisible();
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await first.close(); await second.close(); }
  });
}

test('icebreakers expire once, 75 seconds into a conversation', async ({ page }) => {
  await enter(page);
  await page.clock.install();
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#ai-suggestions-bar')).toBeVisible();
  await page.clock.fastForward(60000);
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await expect(page.locator('#ai-suggestions-bar')).toBeVisible();
  await page.clock.fastForward(16000);
  await expect(page.locator('#ai-suggestions-bar')).toHaveCount(0);
});
