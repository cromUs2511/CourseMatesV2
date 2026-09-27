import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, _name: string) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}

const drawButton = (page: Page) => page.getByRole('button', { name: 'Draw a card from the deck' });

/** Exactly one seat holds the turn, and only that seat is told "Your turn!". */
const turnBannerCount = async (a: Page, b: Page) =>
  (await a.locator('.uno-turn-indicator').count()) +
  (await b.locator('.uno-turn-indicator').count());

async function openArena(page: Page, expectWaiting: boolean) {
  await page.locator('#open-uno-btn').click();
  await expect(page.getByRole('heading', { name: 'UNO Arena', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find an opponent' }).click();
  if (expectWaiting) await expect(page.getByText(/Waiting for another player/)).toBeVisible();
}

test('the arena pairs two real sessions, plays a full turn and never shows the opponent hand', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage(),
    b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));

  await signIn(a, 'uno-first');
  await signIn(b, 'uno-second');
  await openArena(a, true);
  await openArena(b, false);
  await expect(a.locator('.uno-table')).toBeVisible({ timeout: 15_000 });
  await expect(b.locator('.uno-table')).toBeVisible({ timeout: 15_000 });

  await expect.poll(() => turnBannerCount(a, b)).toBe(1);
  // The UNO call is automatic now - there is no button to press.
  await expect(a.getByRole('button', { name: 'Call UNO' })).toHaveCount(0);
  await expect(a.getByRole('button', { name: 'UNO rules' })).toBeVisible();
  await expect(a.getByText('Discard pile')).toBeVisible();
  await expect(b.getByText('Discard pile')).toBeVisible();

  // Whichever session holds the turn draws once and passes; the hand counts on
  // both screens must stay independent (each player only ever sees their own).
  const pages = [a, b];
  let actorIndex = -1;
  await expect
    .poll(
      async () => {
        for (let index = 0; index < pages.length; index++) {
          if (
            await drawButton(pages[index]!)
              .isEnabled()
              .catch(() => false)
          ) {
            actorIndex = index;
            return index;
          }
        }
        return -1;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(0);

  const actor = pages[actorIndex]!;
  const other = pages[actorIndex === 0 ? 1 : 0]!;
  await drawButton(actor).click();
  await expect(actor.getByRole('button', { name: 'Pass turn' })).toBeVisible();
  await actor.getByRole('button', { name: 'Pass turn' }).click();

  // The turn moved on: the peer can now draw.
  await expect(drawButton(other)).toBeEnabled({ timeout: 15_000 });

  // Walking away forfeits the table and returns to the lobby panel.
  await actor.getByRole('button', { name: 'Leave the UNO table' }).click();
  const leaveDialog = actor.getByRole('dialog', { name: 'Leave the game?' });
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole('button', { name: 'Leave table' }).click();
  await expect(actor.getByRole('button', { name: 'Find an opponent' })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Victory!' })).toBeVisible();

  expect(errors).toEqual([]);
  await first.close();
  await second.close();
});

test('chat peers can challenge each other, accept and open the table over WebSocket', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage(),
    b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));

  await signIn(a, 'chat-first');
  await signIn(b, 'chat-second');
  await a.locator('#start-chat-btn').click();
  await b.locator('#start-chat-btn').click();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();

  await a.getByRole('button', { name: 'Challenge this peer to a UNO duel' }).click();
  await expect(a.getByText(/Challenge sent to/)).toBeVisible();
  const banner = b.getByText(/challenged you to a UNO duel/);
  await expect(banner).toBeVisible({ timeout: 10_000 });

  await b.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(b.locator('.uno-table')).toBeVisible({ timeout: 10_000 });
  await expect(a.locator('.uno-table')).toBeVisible({ timeout: 10_000 });
  await expect(a.locator('.uno-table').getByText('Chat 1v1')).toBeVisible();

  // Minimising keeps the chat usable; the header control restores the table.
  await a.getByRole('button', { name: 'Minimize the UNO table' }).click();
  await expect(a.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
  await expect(a.locator('.uno-table')).toHaveCount(0);
  await a.getByRole('button', { name: 'Open the UNO table' }).click();
  await expect(a.locator('.uno-table')).toBeVisible();

  expect(errors).toEqual([]);
  await first.close();
  await second.close();
});

const phone = () => ({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark' as const,
});

test('the arena table plays with touch on a phone and still fits when rotated', async ({
  browser,
}) => {
  const first = await browser.newContext(phone());
  const second = await browser.newContext(phone());
  const a = await first.newPage(),
    b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));

  await signIn(a, 'phone-first');
  await signIn(b, 'phone-second');
  await openArena(a, true);
  await openArena(b, false);
  await expect(a.locator('.uno-table')).toBeVisible({ timeout: 15_000 });
  await expect(b.locator('.uno-table')).toBeVisible({ timeout: 15_000 });

  const stateLog: string[] = [];
  for (const [label, page] of [
    ['a', a],
    ['b', b],
  ] as const) {
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/uno/state')) {
        stateLog.push(`${label}:http:${response.status()}`);
        response
          .json()
          .then(
            (data: {
              game?: { status: string; winner: string | null; gameId: string } | null;
              queued?: boolean;
            }) =>
              stateLog.push(
                `${label}:game:${data.game?.status ?? 'null'}:${data.game?.gameId.slice(0, 8) ?? '-'}:winner=${data.game?.winner ?? '-'}:queued=${data.queued}`,
              ),
          )
          .catch(() => stateLog.push(`${label}:bad-json`));
      } else if (url.includes('/api/uno/leave')) {
        stateLog.push(`${label}:leave:${response.status()}`);
      }
    });
  }

  // The table owns the screen: no sideways page scrolling on a 390px phone.
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const portraitBox = await a.locator('.uno-table').boundingBox();
  expect(portraitBox!.width).toBeLessThanOrEqual(390);
  expect(portraitBox!.height).toBeLessThanOrEqual(844);

  // Header controls and the deck are comfortably tappable.
  const rulesBox = await a.getByRole('button', { name: 'UNO rules' }).boundingBox();
  expect(rulesBox!.height).toBeGreaterThanOrEqual(40);
  const drawBox = await drawButton(a).boundingBox();
  expect(drawBox!.height).toBeGreaterThanOrEqual(60);

  await a.getByRole('button', { name: 'UNO rules' }).tap();
  await expect(a.getByRole('dialog', { name: 'UNO rules' })).toBeVisible();
  await a.getByRole('button', { name: 'Close rules' }).tap();
  await expect(a.getByRole('dialog', { name: 'UNO rules' })).toHaveCount(0);

  // One full turn with touch gestures only.
  const pages = [a, b];
  let actorIndex = -1;
  await expect
    .poll(
      async () => {
        for (let index = 0; index < pages.length; index++) {
          if (
            await drawButton(pages[index]!)
              .isEnabled()
              .catch(() => false)
          ) {
            actorIndex = index;
            return index;
          }
        }
        return -1;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(0);
  const actor = pages[actorIndex]!;
  const other = pages[actorIndex === 0 ? 1 : 0]!;
  await drawButton(actor).tap();
  await expect(actor.getByRole('button', { name: 'Pass turn' })).toBeVisible();
  await actor.getByRole('button', { name: 'Pass turn' }).tap();
  await expect(drawButton(other)).toBeEnabled({ timeout: 15_000 });

  // Landscape: the compact layout must keep stage content unclipped. Cards
  // animate their resize for 250ms, so poll until the layout settles.
  await a.setViewportSize({ width: 844, height: 390 });
  const landscapeBox = await a.locator('.uno-table').boundingBox();
  expect(landscapeBox!.height).toBeLessThanOrEqual(390);
  await expect(a.locator('.uno-hand')).toBeVisible();
  await expect.poll(() => turnBannerCount(a, b)).toBe(1);
  await expect
    .poll(
      () => a.locator('.uno-stage').evaluate((stage) => stage.scrollHeight - stage.clientHeight),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(4);
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // Leaving works with the 40px header target.
  await a.getByRole('button', { name: 'Leave the UNO table' }).tap();
  await a
    .getByRole('dialog', { name: 'Leave the game?' })
    .getByRole('button', { name: 'Leave table' })
    .tap();
  await expect(a.getByRole('button', { name: 'Find an opponent' })).toBeVisible();
  try {
    await expect(other.getByRole('heading', { name: 'Victory!' })).toBeVisible();
  } catch (failure) {
    const body = await other.evaluate(() => document.body.innerText.slice(0, 600));
    console.log(
      `VICTORY-FAIL logs=[${stateLog.join(' | ')}] errors=[${errors.join(' | ')}] body=${JSON.stringify(body)}`,
    );
    throw failure;
  }

  expect(errors).toEqual([]);
  await first.close();
  await second.close();
});

test('a phone in chat can challenge, accept and reopen the table', async ({ browser }) => {
  const first = await browser.newContext(phone());
  const second = await browser.newContext(phone());
  const a = await first.newPage(),
    b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));

  await signIn(a, 'phone-chat-a');
  await signIn(b, 'phone-chat-b');
  await a.locator('#start-chat-btn').tap();
  await b.locator('#start-chat-btn').tap();
  await expect(a.locator('#chat-header')).toBeVisible();
  await expect(b.locator('#chat-header')).toBeVisible();

  // The chat entry point is reachable on a 390px header.
  const challenge = a.getByRole('button', { name: 'Challenge this peer to a UNO duel' });
  await expect(challenge).toBeVisible();
  await challenge.tap();
  await expect(a.getByText(/Challenge sent to/)).toBeVisible();
  await expect(b.getByText(/challenged you to a UNO duel/)).toBeVisible({ timeout: 10_000 });

  await b.getByRole('button', { name: 'Accept', exact: true }).tap();
  await expect(b.locator('.uno-table')).toBeVisible({ timeout: 10_000 });
  await expect(a.locator('.uno-table')).toBeVisible({ timeout: 10_000 });
  const tableBox = await a.locator('.uno-table').boundingBox();
  expect(tableBox!.width).toBeLessThanOrEqual(390);
  expect(tableBox!.height).toBeLessThanOrEqual(844);
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // Minimise to chat and reopen with the header control, all by tap.
  await a.getByRole('button', { name: 'Minimize the UNO table' }).tap();
  await expect(a.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
  await a.getByRole('button', { name: 'Open the UNO table' }).tap();
  await expect(a.locator('.uno-table')).toBeVisible();

  expect(errors).toEqual([]);
  await first.close();
  await second.close();
});
