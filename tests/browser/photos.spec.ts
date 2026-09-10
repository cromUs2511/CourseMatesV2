import { test, expect, type Page } from '@playwright/test';

const photo = { name: 'Study notes.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
async function signIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: /student email/i }).fill(name + '@mymail.mapua.edu.ph');
  await page.getByRole('button', { name: 'Continue in demo mode' }).click();
  await expect(page.getByRole('heading', { name: 'Add an interest' })).toBeVisible();
}
async function demo(page: Page, name: string) {
  await signIn(page, name);
  await page.locator('#start-chat-btn').click();
  await page.locator('#simulate-peer-btn').click();
  await expect(page.locator('#chat-header')).toBeVisible();
}
async function attach(page: Page, files = [photo]) {
  await page.getByRole('button', { name: 'Attach photos', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose photos', exact: true }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByRole('img', { name: 'Preview of Study notes.png' })).toBeVisible();
}

for (const fallback of [false, true]) test(`photos preview, retry, arrive once and delete with ${fallback ? 'HTTP fallback' : 'WebSockets'}`, async ({ browser }) => {
  const first = await browser.newContext(), second = await browser.newContext();
  if (fallback) for (const context of [first, second]) await context.addInitScript(() => {
    window.WebSocket = class { constructor() { throw new Error('Blocked for photo fallback test'); } } as any;
  });
  const a = await first.newPage(), b = await second.newPage();
  try {
    await signIn(a, 'photos-a'); await signIn(b, 'photos-b');
    await a.locator('#start-chat-btn').click(); await b.locator('#start-chat-btn').click();
    await expect(a.locator('#chat-header')).toBeVisible(); await expect(b.locator('#chat-header')).toBeVisible();
    const largeData = await a.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1700; canvas.height = 900;
      const context = canvas.getContext('2d')!;
      const pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 42;
      for (let index = 0; index < pixels.data.length; index += 4) {
        for (let color = 0; color < 3; color++) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels.data[index + color] = seed >>> 24; }
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await attach(a, [photo, { name: 'Large photo.png', mimeType: 'image/png', buffer: Buffer.from(largeData, 'base64') }]);
    await expect(b.getByRole('img', { name: 'Study notes.png', exact: true })).toHaveCount(0);
    await a.route('**/api/chat/send', route => route.fulfill({ status: 503, json: { error: 'Photo delivery failed' } }));
    await a.locator('#send-message-btn').click();
    await expect(a.getByRole('alert')).toHaveText('Photo delivery failed');
    await expect(a.getByRole('img', { name: 'Preview of Study notes.png' })).toBeVisible();
    await a.unroute('**/api/chat/send');
    const upload = a.waitForRequest('**/api/chat/send');
    await a.locator('#send-message-btn').click();
    const body = (await upload).postData()!;
    expect(body.length).toBeGreaterThan(65536);
    expect(JSON.parse(body).images[1].width).toBe(1600);
    const received = b.getByRole('img', { name: 'Study notes.png', exact: true });
    await expect(received).toHaveCount(1);
    await expect.poll(() => received.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect.poll(() => b.getByRole('img', { name: 'Large photo.png', exact: true }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1600)).toBe(true);
    await expect(a.getByRole('img', { name: 'Preview of Study notes.png' })).toHaveCount(0);
    await b.getByRole('button', { name: 'View photo Study notes.png' }).click();
    await expect(b.getByRole('dialog', { name: 'Photo', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(b.getByRole('dialog', { name: 'Photo', exact: true })).toHaveCount(0);
    await expect(received).toHaveCount(0);
  } finally {
    await a.locator('#leave-chat-btn').click();
    await a.getByRole('dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await first.close(); await second.close();
  }
});

test('mobile attachments validate, remove, and request camera permission only on demand', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(() => {
    (window as any).cameraRequests = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      (window as any).cameraRequests.push(constraints);
      throw new DOMException('Denied for test', 'NotAllowedError');
    };
  });
  await demo(page, 'photo-mobile');
  await attach(page);
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeInViewport();
  await expect(page.locator('#send-message-btn')).toBeInViewport();
  await page.screenshot({ path: 'test-results/mobile-photo-preview.png' });
  expect(await page.evaluate(() => (window as any).cameraRequests.length)).toBe(0);
  await page.getByRole('button', { name: 'Remove photo Study notes.png' }).click();
  await expect(page.locator('#send-message-btn')).toBeDisabled();
  await page.getByLabel('Choose photos to attach').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toHaveText('Choose a JPEG, PNG, or WebP photo.');
  await page.getByRole('button', { name: 'Attach photos', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Camera permission was not granted');
  expect(await page.evaluate(() => (window as any).cameraRequests)).toEqual([{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false }]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('camera capture previews a photo and stops the stream when closed', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).cameraTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
      const context = canvas.getContext('2d')!; context.fillStyle = '#991b1b'; context.fillRect(0, 0, 160, 120);
      const stream = canvas.captureStream(10);
      (window as any).cameraTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await demo(page, 'photo-camera');
  await page.getByRole('button', { name: 'Attach photos', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await page.getByRole('button', { name: 'Capture photo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Preview of Camera photo.jpg' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).cameraTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('textbox', { name: 'Chat message' }).fill('Camera caption');
  await page.locator('#send-message-btn').click();
  await expect(page.getByRole('img', { name: 'Camera photo.jpg', exact: true })).toBeVisible();
  await expect(page.getByText('Camera caption', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Attach photos', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture photo', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).cameraTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
});

test('a camera permission grant after dismissal immediately stops its stream', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      (window as any).grantCamera = () => {
        const canvas = document.createElement('canvas');
        const stream = canvas.captureStream();
        (window as any).lateCameraTracks = stream.getTracks();
        resolve(stream);
      };
    });
  });
  await demo(page, 'photo-late-permission');
  await page.getByRole('button', { name: 'Attach photos', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Waiting for camera access');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => (window as any).grantCamera());
  await expect.poll(() => page.evaluate(() => (window as any).lateCameraTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByLabel('Photo attachments')).toHaveCount(0);
});

test('grid breathing and theme wrapping work on login and main menu with reduced-motion support', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue in demo mode' })).toBeVisible();
  expect(await page.locator('.access-gateway').evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('grid-breathe');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.waitForFunction(() => getComputedStyle(document.documentElement, '::view-transition-new(root)').animationName === 'theme-wrap');
  await page.screenshot({ path: 'test-results/theme-wrapping.png' });
  await expect(page.locator('html')).not.toHaveClass(/theme-revealing/);
  await signIn(page, 'photo-theme');
  expect(await page.locator('.ambient-grid').evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('grid-breathe');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('html')).not.toHaveClass(/theme-revealing/);
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.ambient-grid')).toBeVisible();
  expect(await page.locator('.ambient-grid').evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('none');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
});
