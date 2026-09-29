import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}

const drawButton = (page: Page) => page.getByRole('button', { name: 'Draw a card from the deck' });

async function openArena(page: Page) {
  await page.locator('#open-uno-btn').click();
  await expect(page.getByRole('heading', { name: 'UNO Arena', exact: true })).toBeVisible();
}

async function joinFourPlayerQueue(page: Page) {
  await enter(page);
  await openArena(page);
  await page.getByRole('radio', { name: /Four players/ }).click();
  await page.getByRole('button', { name: 'Find a four-player table' }).click();
}

test('the arena can fill the table with bots and the bots answer every move', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await enter(page);
  await openArena(page);
  await page.getByRole('radio', { name: /Bots/ }).click();
  await page.getByRole('button', { name: 'Play the bots' }).click();

  await expect(page.locator('.uno-table')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.uno-opponent').first()).toContainText(/^Bot /);
  await expect(page.locator('.uno-turn-indicator')).toHaveText('Your turn!', { timeout: 15_000 });

  await drawButton(page).click();
  await page.getByRole('button', { name: 'Pass turn' }).click();
  await expect(page.locator('.uno-turn-indicator')).toHaveText('Your turn!', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Quit the UNO game' }).click();
  await page
    .getByRole('dialog', { name: 'Leave the game?' })
    .getByRole('button', { name: 'Leave table' })
    .click();
  await expect(page.getByRole('button', { name: 'Play the bots' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('a four player queue only completes with four waiting sessions', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  try {
    for (const page of pages.slice(0, 3)) {
      page.on('pageerror', (error) => errors.push(error.message));
      await joinFourPlayerQueue(page);
    }
    await expect(pages[0]!.getByText(/Waiting for three more players/)).toBeVisible();
    for (const page of pages.slice(0, 3)) await expect(page.locator('.uno-table')).toHaveCount(0);

    pages[3]!.on('pageerror', (error) => errors.push(error.message));
    await joinFourPlayerQueue(pages[3]!);

    for (const page of pages) {
      await expect(page.locator('.uno-table')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.uno-opponent')).toHaveCount(3);
      await expect(page.getByText('Arena 4 players')).toBeVisible();
      await expect(page.locator('.uno-turn-indicator')).toHaveText(/\S/);
    }
    const heldTurn = async () =>
      (
        await Promise.all(pages.map((page) => page.locator('.uno-turn-indicator').textContent()))
      ).some((turn) => turn === 'Your turn!');
    await expect.poll(heldTurn, { timeout: 10_000 }).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('tic tac toe plays against the bot and a friend on one screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const filled = page.getByRole('button', { name: /^Cell .+, (X|O)$/ });

  await enter(page);
  await page.locator('#open-tictactoe-btn').click();
  await expect(page.getByRole('heading', { name: 'Tic Tac Toe' })).toBeVisible();

  await page.locator('#ttt-play-bot-btn').click();
  await page.getByRole('button', { name: 'Cell top left, empty' }).click();
  await expect(filled).toHaveCount(2, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Choose another opponent' }).click();
  await page.locator('#ttt-play-friend-btn').click();
  await page.getByRole('button', { name: 'Cell centre, empty' }).click();
  await page.getByRole('button', { name: 'Cell top left, empty' }).click();
  await expect(filled).toHaveCount(2);

  await page.getByRole('button', { name: 'New round' }).click();
  await expect(filled).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to menu' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();

  expect(errors).toEqual([]);
});
