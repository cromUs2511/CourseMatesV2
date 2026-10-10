import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}

test('anonymous name can be edited and restored to a default name', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: 'Edit anonymous name' }).click();
  await page.getByRole('textbox', { name: 'Custom name' }).fill('Study Partner');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Study Partner', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use default name' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Study Partner', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use default name' }).click();
  await expect(page.getByRole('button', { name: 'Use default name' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit anonymous name' })).toBeVisible();
});

test('anonymous access uses only an HttpOnly cookie and restores after reload', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByText(/student status is not verified/i)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy policy', exact: true })).toHaveAttribute(
    'href',
    '/privacy',
  );
  const login = page.waitForResponse('**/api/auth/anonymous');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  const body = await (await login).json();
  expect(body.session).not.toHaveProperty('token');
  expect(body.session).not.toHaveProperty('email');
  const authCookie = (await context.cookies()).find((cookie) => cookie.httpOnly);
  expect(authCookie).toBeDefined();
  expect(await page.evaluate(() => document.cookie)).not.toContain(authCookie!.name + '=');
  const restore = page.waitForRequest('**/api/auth/session');
  await page.reload();
  expect((await restore).headers()).not.toHaveProperty('authorization');
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
});

test('policy links open the published privacy, terms and community pages', async ({ page }) => {
  await page.goto('/');
  const [privacy] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: 'Privacy policy', exact: true }).click(),
  ]);
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Privacy Policy');
  await privacy.getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(privacy).toHaveTitle('Terms of Use | CourseMates');
  await privacy.getByRole('link', { name: 'Community rules', exact: true }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText(
    'Community and Moderation Rules',
  );
  await privacy.close();
});

test('expired sessions return to anonymous entry with a recovery explanation', async ({ page }) => {
  await enter(page);
  await page.route('**/api/auth/reroll', (route) =>
    route.fulfill({ status: 401, json: { error: 'Session expired.' } }),
  );
  await page.getByRole('button', { name: 'Shuffle default name', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to CourseMates' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/session.*ended/i);
});

test('peers can report without exposing message content and block to end the chat', async ({
  browser,
}) => {
  const first = await browser.newContext(),
    second = await browser.newContext();
  const a = await first.newPage(),
    b = await second.newPage();
  try {
    await enter(a);
    await enter(b);
    await a.locator('#start-chat-btn').click();
    await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible();
    await expect(b.locator('#chat-header')).toBeVisible();
    const safetyButton = a.getByRole('button', { name: 'Report or block peer', exact: true });
    await safetyButton.click();
    const dialog = a.getByRole('dialog', { name: 'Report or block peer', exact: true });
    await expect(dialog).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(safetyButton).toBeFocused();
    await safetyButton.click();
    await dialog.getByLabel('Reason for reporting').selectOption('harassment');
    const report = a.waitForRequest('**/api/safety/report');
    await dialog.getByRole('button', { name: 'Submit report', exact: true }).click();
    expect(Object.keys((await report).postDataJSON()).sort()).toEqual(['category', 'roomId']);
    await expect(dialog.getByRole('status')).toContainText('Report submitted');
    await dialog.getByRole('button', { name: 'Block peer and end chat', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(a.getByText('Peer disconnected from this session')).toBeVisible();
    await expect(b.getByText('Peer disconnected from this session')).toBeVisible();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
