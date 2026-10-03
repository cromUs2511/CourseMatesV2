import { test, expect, type Page } from '@playwright/test';
import type { UnoStateResponse } from '../../unoTypes';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.locator('#start-chat-btn')).toBeVisible();
}

for (const polling of [false, true]) {
  test(`chat-only UNO plays a complete match and rematch on desktop and phone (${polling ? 'REST' : 'socket'})`, async ({
    browser,
  }) => {
    test.setTimeout(120000);
    const first = await browser.newContext();
    const second = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const a = await first.newPage(),
      b = await second.newPage();
    const errors: string[] = [];
    const baseURL = 'http://127.0.0.1:3100';
    const headers = { Origin: baseURL, 'Content-Type': 'application/json' };
    try {
      for (const page of [a, b]) {
        page.on('pageerror', (error) => errors.push(error.message));
        if (polling) await page.routeWebSocket('**/ws/chat*', (socket) => socket.close());
        await enter(page);
      }
      await a.locator('#start-chat-btn').click();
      await b.locator('#start-chat-btn').click();
      await expect(a.locator('#chat-header')).toBeVisible();
      await a.getByRole('button', { name: 'Open the games catalog' }).click();
      await a.locator('#chat-game-uno-btn').click();
      await expect(a.getByText(/Invitation sent to/)).toBeVisible();
      await expect(b.getByRole('region', { name: 'UNO invitation' })).toBeVisible();
      await b.getByRole('button', { name: 'Accept', exact: true }).click();
      for (const page of [a, b]) {
        await expect(page.locator('.uno-table')).toBeVisible();
        await expect(page.locator('.uno-opponent')).toHaveCount(1);
        await expect(page.getByText('Discard pile', { exact: true })).toBeVisible();
      }
      await b.getByRole('button', { name: 'Minimize the UNO table' }).tap();
      await expect(b.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
      await b.getByRole('button', { name: 'Open the games catalog' }).tap();
      await b.locator('#chat-game-uno-btn').tap();
      await expect(b.locator('.uno-table')).toBeVisible();
      await b.setViewportSize({ width: 844, height: 390 });
      await expect(b.locator('.uno-hand')).toBeVisible();
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await b.setViewportSize({ width: 390, height: 844 });
      // One real UI turn, then drive legal moves via each participant's own cookie
      // to reach an actual empty-hand victory without a test-only runtime endpoint.
      const read = async (page: Page): Promise<UnoStateResponse> =>
        (await page.request.get('/api/uno/state', { headers })).json();
      let state = await read(a);
      const actor = state.game!.turn === 'you' ? a : b;
      const turnLabel = await actor.locator('.uno-turn-indicator').elementHandle();
      await actor.getByRole('button', { name: 'Draw a card from the deck' }).click();
      await actor.getByRole('button', { name: 'Pass turn' }).click();
      await expect(actor.locator('.uno-turn-indicator')).not.toHaveText('Your turn!');
      expect(await turnLabel!.evaluate((element) => element.isConnected)).toBe(true);
      for (let move = 0; move < 350; move++) {
        state = await read(a);
        if (state.game!.status === 'over') break;
        const page = state.game!.turn === 'you' ? a : b;
        const game = (await read(page)).game!;
        const card = game.you.hand.find((entry) => game.playable.includes(entry.id));
        const response = await page.request.post('/api/uno/action', {
          headers,
          data: {
            gameId: game.gameId,
            round: game.round,
            action: card ? 'play' : game.hasDrawn ? 'pass' : 'draw',
            ...(card ? { cardId: card.id, color: 'red' } : {}),
          },
        });
        expect(response.ok(), await response.text()).toBe(true);
      }
      state = await read(a);
      expect(state.game!.status).toBe('over');
      const winner = state.game!.winner === 'you' ? a : b;
      const loser = winner === a ? b : a;
      expect((await read(winner)).game!.you.hand).toHaveLength(0);
      await expect(winner.getByRole('heading', { name: 'Victory!' })).toBeVisible();
      await expect(loser.getByRole('heading', { name: 'Defeated' })).toBeVisible();
      for (const page of [a, b])
        await expect(
          page.getByRole('button', { name: 'Draw a card from the deck' }),
        ).toBeDisabled();
      await loser.getByRole('button', { name: 'Request rematch', exact: true }).click();
      await winner.getByRole('button', { name: 'Accept rematch', exact: true }).click();
      for (const page of [a, b])
        await expect(page.getByRole('dialog', { name: 'Game result' })).toHaveCount(0);
      expect((await read(a)).game!.round).toBe(2);
      await a.getByRole('button', { name: 'Quit the UNO game' }).click();
      await a
        .getByRole('dialog', { name: 'Leave the game?' })
        .getByRole('button', { name: 'Leave table' })
        .click();
      await expect(a.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
      await expect(b.getByText('Table closed — no winner')).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });
}
