import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.locator('#start-chat-btn')).toBeVisible();
}
for (const polling of [false, true]) {
  test(`Draw & Guess desktop and touch peers share sketches and private words (${polling ? 'REST' : 'WebSocket'})`, async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const first = await browser.newContext();
    const second = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const a = await first.newPage(),
      b = await second.newPage();
    const errors: string[] = [];
    try {
      for (const p of [a, b]) {
        p.on('pageerror', (e) => errors.push(e.message));
        if (polling) await p.routeWebSocket('**/ws/chat*', (socket) => socket.close());
        await enter(p);
      }
      await a.locator('#start-chat-btn').click();
      await b.locator('#start-chat-btn').click();
      await expect(a.locator('#chat-header')).toBeVisible();
      await a.getByRole('button', { name: 'Open the games catalog' }).click();
      await a.locator('#chat-game-drawing-btn').click();
      await expect(a.getByRole('dialog', { name: 'Draw & Guess' })).toBeVisible();
      await a.getByLabel('Prompt category').selectOption('animals');
      await a.getByLabel('Prompt difficulty').selectOption('easy');
      await a.getByRole('button', { name: 'Invite peer to draw' }).click();
      await expect(b.getByRole('region', { name: 'Draw & Guess invitation' })).toBeVisible();
      await b.getByRole('button', { name: 'Accept', exact: true }).click();
      const choices = a.locator('[data-draw-choice]');
      await expect(choices).toHaveCount(3);
      await expect(b.locator('[data-draw-choice]')).toHaveCount(0);
      const word = await choices.first().getAttribute('data-draw-choice');
      await choices.first().click();
      const ca = a.getByLabel('Drawing canvas'),
        cb = b.getByLabel('Drawing canvas');
      await expect(cb).toBeVisible();
      await expect(b.locator('[data-secret-word]')).toHaveCount(0);
      const rect = (await ca.boundingBox())!;
      await a.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.3);
      await a.mouse.down();
      await a.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.7, { steps: 12 });
      await a.mouse.up();
      await expect(cb).toHaveAttribute('data-stroke-count', '1');
      await a.getByRole('button', { name: 'Undo last stroke' }).click();
      await expect(cb).toHaveAttribute('data-stroke-count', '0');
      await a.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
      await expect(cb).toHaveAttribute('data-stroke-count', '1');
      await a.getByRole('button', { name: 'Clear canvas' }).click();
      await expect(cb).toHaveAttribute('data-stroke-count', '0');
      await b.getByLabel('Your guess').fill(word!);
      await b.getByRole('button', { name: 'Send guess' }).click();
      await expect(b.getByRole('status').filter({ hasText: 'Correct guess!' })).toBeVisible();
      await b.getByRole('button', { name: 'Next round' }).click();
      await expect(b.locator('[data-draw-choice]')).toHaveCount(3);
      await b.locator('[data-draw-choice]').first().click();
      // Touch Pointer Events, including capture cleanup after cancellation.
      await cb.evaluate((canvas: HTMLCanvasElement) => {
        const r = canvas.getBoundingClientRect();
        const fire = (type: string, x: number, y: number) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 42,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX: r.x + r.width * x,
              clientY: r.y + r.height * y,
            }),
          );
        fire('pointerdown', 0.2, 0.2);
        fire('pointermove', 0.6, 0.6);
        fire('pointercancel', 0.6, 0.6);
      });
      await expect(ca).toHaveAttribute('data-stroke-count', '1');
      // A long touch stroke must finish uploading before minimize can remove
      // its canvas. Delay the first batch to reproduce a slow mobile network.
      let releaseBatch!: () => void;
      const heldBatch = new Promise<void>((resolve) => {
        releaseBatch = resolve;
      });
      let held = false,
        strokeRoom = '';
      await b.route('**/api/chat/drawing', async (route) => {
        const body = route.request().postDataJSON();
        if (body?.action === 'stroke' && !held) {
          held = true;
          strokeRoom = body.roomId;
          await heldBatch;
        }
        await route.continue();
      });
      try {
        await cb.evaluate((canvas: HTMLCanvasElement) => {
          const r = canvas.getBoundingClientRect();
          const fire = (type: string, x: number, y: number) =>
            canvas.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                pointerId: 43,
                pointerType: 'touch',
                isPrimary: true,
                button: 0,
                clientX: r.x + r.width * x,
                clientY: r.y + r.height * y,
              }),
            );
          fire('pointerdown', 0.1, 0.3);
          for (let i = 1; i <= 100; i++) fire('pointermove', 0.1 + i * 0.007, i % 2 ? 0.4 : 0.3);
          fire('pointerup', 0.8, 0.3);
        });
        await expect(b.getByRole('button', { name: 'Minimize Draw & Guess' })).toBeDisabled();
        await b.keyboard.press('Escape');
        await expect(cb).toBeVisible();
        releaseBatch();
        await expect
          .poll(async () => {
            if (!strokeRoom) return 0;
            return b.evaluate(async (roomId) => {
              const state = await (
                await fetch('/api/chat/drawing?roomId=' + encodeURIComponent(roomId))
              ).json();
              return state.game.strokes.at(-1)?.points.length ?? 0;
            }, strokeRoom);
          })
          .toBe(101);
      } finally {
        releaseBatch();
        await b.unroute('**/api/chat/drawing');
      }
      await a.screenshot({ path: `test-results/drawing-desktop-${polling ? 'rest' : 'ws'}.png` });
      await b.screenshot({ path: `test-results/drawing-mobile-${polling ? 'rest' : 'ws'}.png` });
      await b.setViewportSize({ width: 844, height: 390 });
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await b.getByRole('button', { name: 'Minimize Draw & Guess' }).click();
      await b.getByRole('button', { name: 'Open the games catalog' }).click();
      await b.locator('#chat-game-drawing-btn').click();
      await expect(cb).toHaveAttribute('data-stroke-count', '2');
      await b.getByRole('button', { name: 'Leave Draw & Guess' }).click();
      await b.getByRole('button', { name: 'Sure?', exact: true }).click();
      await expect(a.getByRole('dialog', { name: 'Draw & Guess' })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });
}
