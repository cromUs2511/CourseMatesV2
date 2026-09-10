import { test, expect } from '@playwright/test';

test('three successful starters exhaust the bar without limiting normal messages or message actions', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    for (const [index, page] of [a, b].entries()) {
      await page.goto('/');
      await page.getByRole('textbox', { name: /student email/i }).fill(`starter-${index}@mymail.mapua.edu.ph`);
      await page.getByRole('button', { name: 'Continue in demo mode' }).click();
      await page.locator('#start-chat-btn').click();
    }
    await expect(a.locator('#chat-header')).toBeVisible();
    await expect(b.locator('#chat-header')).toBeVisible();
    const bar = a.locator('#ai-suggestions-bar');
    const suggestions = bar.getByTitle('Use this conversation starter');
    const input = a.getByRole('textbox', { name: 'Chat message' });
    await expect(suggestions).toHaveCount(3);
    await suggestions.first().click();
    await expect(bar).toContainText('3 left');
    // A delivery failure preserves both the selected draft and its allowance.
    await a.route('**/api/chat/send', route => route.fulfill({ status: 503, json: { error: 'Test delivery failure' } }));
    await a.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(a.getByRole('alert')).toHaveText('Test delivery failure');
    await expect(bar).toContainText('3 left');
    await a.unroute('**/api/chat/send');
    for (let remaining = 3; remaining > 0; remaining--) {
      await expect(suggestions).toHaveCount(remaining);
      await bar.getByRole('button', { name: 'Shuffle' }).click();
      await expect(suggestions).toHaveCount(remaining);
      await expect(bar).toContainText(`${remaining} left`);
      await suggestions.first().click();
      const text = await input.inputValue();
      await a.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(b.locator('[data-message-bubble] > p').last()).toHaveText(text);
      if (remaining > 1) await expect(bar).toContainText(`${remaining - 1} left`);
    }
    await expect(bar).toHaveCount(0);
    await expect(b.locator('#ai-suggestions-bar')).toContainText('3 left');
    await input.fill('I can still write my own messages.');
    await a.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(b.getByText('I can still write my own messages.', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'More message actions' }).last().click();
    await expect(a.getByRole('dialog', { name: 'Message actions' })).toBeVisible();
    await a.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(a.getByText('Message unsent.', { exact: true })).toBeVisible();
    // A new conversation gets a fresh allowance.
    await a.locator('#leave-chat-btn').click();
    await a.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await a.locator('#start-chat-btn').click();
    await a.locator('#simulate-peer-btn').click();
    await expect(bar).toContainText('3 left');
    await expect(suggestions).toHaveCount(3);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
