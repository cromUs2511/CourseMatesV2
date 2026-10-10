import { test, expect, type Page, type Browser } from '@playwright/test';

const png = {
  name: 'Pasted image.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  ).toString('base64'),
};

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}
async function demo(page: Page) {
  await signIn(page);
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();
  await page.evaluate(() => {
    const browserNow = Date.now.bind(Date);
    Date.now = () => browserNow() + 91_000;
  });
  await page.waitForTimeout(300);
}
async function pasteFiles(
  page: Page,
  files: { name: string; mimeType: string; buffer?: string }[],
  text?: string,
) {
  await page.getByRole('textbox', { name: 'Chat message' }).focus();
  await page.evaluate(
    ({ files, text }) => {
      const data = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.buffer!), (char) => char.charCodeAt(0));
        data.items.add(new File([bytes], file.name, { type: file.mimeType }));
      }
      if (text !== undefined) data.setData('text/plain', text);
      const target = document.getElementById('chat-message-input')!;
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      target.dispatchEvent(event);
    },
    { files, text },
  );
}

test('pasted images preview, remove, and send on desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page);
  await pasteFiles(page, [png]);
  await expect(page.getByRole('img', { name: 'Preview of Pasted image.png' })).toBeVisible();
  // Removing works before sending.
  await page.getByRole('button', { name: 'Remove photo Pasted image.png' }).click();
  await expect(page.getByRole('img', { name: 'Preview of Pasted image.png' })).toHaveCount(0);
  // Ordinary typing still works after a paste.
  await page.getByRole('textbox', { name: 'Chat message' }).fill('caption this');
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('caption this');
  // Pasting again and sending delivers the image through the media path.
  await pasteFiles(page, [png]);
  await expect(page.getByRole('img', { name: 'Preview of Pasted image.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Pasted image.png', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('text-only and non-image pastes leave the composer untouched', async ({ page }) => {
  await demo(page);
  await pasteFiles(
    page,
    [
      {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello').toString('base64'),
      },
    ],
    'hello pasted',
  );
  await expect(page.getByRole('img', { name: /Preview of/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Chat message' }).fill('still typing');
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('still typing');
});

test('pasted images preview and send on a mobile browser context', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await demo(page);
    await pasteFiles(page, [png]);
    await expect(page.getByRole('img', { name: 'Preview of Pasted image.png' })).toBeVisible();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Pasted image.png', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
