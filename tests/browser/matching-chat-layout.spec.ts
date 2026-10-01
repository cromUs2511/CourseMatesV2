import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}

async function expectContained(page: Page, selector: string) {
  const issues = await page.locator(selector).evaluateAll((elements) =>
    elements.flatMap((element) => {
      const box = element.getBoundingClientRect();
      const failures: string[] = [];
      if (box.width && (box.left < 0 || box.right > innerWidth + 1))
        failures.push(`${element.tagName}: outside viewport`);
      if (element.scrollWidth > element.clientWidth + 1)
        failures.push(`${element.tagName}: horizontal overflow`);
      return failures;
    }),
  );
  expect(issues).toEqual([]);
}

for (const theme of ['Crimson red', 'Ocean blue']) {
  for (const mode of ['light', 'dark'] as const) {
    test(`matching and chat layouts wrap in ${theme}, ${mode} mode`, async ({ browser }, info) => {
      test.setTimeout(60000);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        colorScheme: mode,
        reducedMotion: 'reduce',
      });
      const peerContext = await browser.newContext();
      try {
        const page = await context.newPage();
        const peer = await peerContext.newPage();
        await enter(page);
        const modeToggle = page.getByRole('button', { name: `Switch to ${mode} mode` });
        if (await modeToggle.isVisible()) await modeToggle.click();
        if (mode === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        else await expect(page.locator('html')).not.toHaveClass(/dark/);
        await page.getByRole('button', { name: 'Choose chat color theme' }).click();
        await page
          .getByRole('dialog', { name: 'Chat color themes' })
          .getByRole('button', { name: theme, exact: true })
          .click();
        await page.getByRole('radio', { name: /Study \/ Help/ }).click();
        await expect(page.getByRole('radio', { name: /Study \/ Help/ })).toHaveAttribute(
          'aria-checked',
          'true',
        );

        // Long names and the editing form must fit even at the smallest width.
        await page.setViewportSize({ width: 320, height: 800 });
        const shuffle = page.getByTitle('Shuffle default name');
        const shuffleBox = (await shuffle.boundingBox())!;
        const iconBox = (await shuffle.locator('svg').boundingBox())!;
        expect(
          Math.abs(shuffleBox.x + shuffleBox.width / 2 - iconBox.x - iconBox.width / 2),
        ).toBeLessThan(1);
        expect(
          Math.abs(shuffleBox.y + shuffleBox.height / 2 - iconBox.y - iconBox.height / 2),
        ).toBeLessThan(1);
        await page.getByRole('button', { name: 'Use a custom name' }).click();
        await expectContained(page, '.matching-name-form, .matching-name-form input');
        await page
          .getByRole('textbox', { name: 'Custom name' })
          .fill('A very long study nickname for wrapping');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit name' })).toBeVisible();

        for (const width of [320, 390, 1280]) {
          await page.setViewportSize({ width, height: 844 });
          await expectContained(
            page,
            '.matching-identity, .matching-intent, .matching-preferences',
          );
          for (const button of await page.locator('.matching-name-action, .matching-intent').all())
            expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
          await page.locator('.matching-menu').evaluate((element) => {
            element.scrollTop = 0;
          });
          await page.screenshot({ path: info.outputPath(`matching-${width}.png`) });
          await page.locator('#start-chat-btn').scrollIntoViewIfNeeded();
          await page.screenshot({ path: info.outputPath(`matching-action-${width}.png`) });
        }

        await page.locator('#start-chat-btn').click();
        await expect(page.getByText(/Finding active study peers/)).toBeVisible();
        await expect(page.getByRole('radio', { name: /Study \/ Help/ })).toBeDisabled();
        await page.locator('#cancel-queue-btn').click();
        await expect(page.locator('#start-chat-btn')).toBeVisible();

        await enter(peer);
        await peer.getByRole('radio', { name: /Study \/ Help/ }).click();
        await page.locator('#start-chat-btn').click();
        await peer.locator('#start-chat-btn').click();
        await expect(page.locator('#chat-header')).toBeVisible();
        await peer
          .getByRole('textbox', { name: 'Chat message' })
          .fill('Want to compare our notes?');
        await peer.locator('#send-message-btn').click();
        await expect(page.getByText('Want to compare our notes?', { exact: true })).toBeVisible();
        await page
          .getByRole('textbox', { name: 'Chat message' })
          .fill('Yes! Let’s start with the first topic.');
        await page.locator('#send-message-btn').click();
        await expect(
          peer.getByText('Yes! Let’s start with the first topic.', { exact: true }),
        ).toBeVisible();
        await page.getByRole('textbox', { name: 'Chat message' }).blur();

        for (const width of [320, 390, 1280]) {
          await page.setViewportSize({ width, height: 844 });
          await expectContained(page, '#chat-header, [data-message-bubble], #chat-input-console');
          // Identity and actions must occupy separate columns, including long names.
          const identity = (await page.locator('.chat-header-conversation').boundingBox())!;
          const settings = (await page
            .getByRole('button', { name: 'Account and display settings' })
            .boundingBox())!;
          expect(identity.x + identity.width).toBeLessThanOrEqual(settings.x + 1);
          await page.screenshot({ path: info.outputPath(`chat-${width}.png`) });
          const input = page.getByRole('textbox', { name: 'Chat message' });
          await input.focus();
          if (width < 768)
            await expect(page.locator('.chat-header-shell')).toHaveClass(/is-retracted/);
          await expect(
            page.getByRole('button', { name: 'Send music snippet', exact: true }),
          ).toBeInViewport();
          await expectContained(page, '.chat-composer-form, .chat-composer-tools');
          expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(60);
          for (const button of await page
            .locator('.chat-composer-tools > button, #send-message-btn')
            .all())
            expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
          await page.screenshot({ path: info.outputPath(`composer-${width}.png`) });
          await input.blur();
          await expect(page.locator('.chat-header-shell')).not.toHaveClass(/is-retracted/);
          await expect(page.locator('#chat-header')).toBeVisible();

          await page.getByRole('button', { name: 'Open music controls' }).click();
          const music = page.getByRole('region', { name: 'Choose music' });
          await expect(music).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(25, 25, 25)' : 'rgb(255, 253, 250)',
          );
          await expect(music).toHaveCSS('color-scheme', mode);
          await expect(music.getByRole('searchbox')).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)',
          );
          await expectContained(page, '.music-controls-panel');
          await page.screenshot({ path: info.outputPath(`music-${width}.png`) });
          await music.getByRole('button', { name: 'Close music selection' }).click();
        }
      } finally {
        await Promise.all([context.close(), peerContext.close()]);
      }
    });
  }
}
