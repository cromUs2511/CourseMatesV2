import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.impact}:${violation.id} -> ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
}

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
  await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
}

test('access gate meets WCAG A/AA without serious or critical violations', async ({ page }) => {
  await page.goto('/');
  expect(await audit(page)).toEqual([]);
});

test('matchmaking screen meets WCAG A/AA without serious or critical violations', async ({
  page,
}) => {
  await enter(page);
  expect(await audit(page)).toEqual([]);
});

test('chat room meets WCAG A/AA without serious or critical violations', async ({ browser }) => {
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
    expect(await audit(a)).toEqual([]);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('the access gate can be completed with the keyboard alone', async ({ page }) => {
  await page.goto('/');
  const checkbox = page.getByRole('checkbox', { name: /at least 18 years old/i });
  const submit = page.getByRole('button', { name: 'Continue to CourseMates' });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'What kind of chat do you want?' })).toBeVisible();
});

test('every tab-reachable control shows a visible focus ring', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const missing: string[] = [];
  const reached: string[] = [];
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const control = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body || element === document.documentElement)
        return null;
      const style = getComputedStyle(element);
      const outlined =
        style.outlineStyle !== 'none' &&
        style.outlineWidth !== '0px' &&
        style.outlineWidth !== '' &&
        style.outlineColor !== 'transparent';
      const shadowed = style.boxShadow !== 'none' && style.boxShadow !== '';
      return {
        label: (element.getAttribute('aria-label') || element.textContent || element.tagName)
          .trim()
          .slice(0, 60),
        visible: outlined || shadowed,
      };
    });
    if (!control) break;
    reached.push(control.label);
    if (!control.visible) missing.push(control.label);
  }
  expect(reached.length).toBeGreaterThanOrEqual(6);
  expect(reached.join(' | ')).toMatch(/Find my peers/i);
  expect(missing).toEqual([]);
});
