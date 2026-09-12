import { test, expect } from '@playwright/test';

test('long mobile history stays visible while backreading with aurora and incoming messages', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const other = await browser.newContext();
  try {
    await context.addInitScript(() => {
      (window as any).YT = { Player: class {
        constructor(_element: HTMLElement, private options: any) { setTimeout(() => options.events.onReady({ target: this }), 0); }
        loadVideoById() { this.playVideo(); }
        cueVideoById() {}
        playVideo() { this.options.events.onStateChange({ target: this, data: 1 }); }
        pauseVideo() { this.options.events.onStateChange({ target: this, data: 2 }); }
        setVolume() {}
        mute() {}
        unMute() {}
        destroy() {}
      } };
    });
    const [page, peer] = await Promise.all([context.newPage(), other.newPage()]);
    const history = Array.from({ length: 140 }, (_, index) => ({
      id: `history-${index}`, senderId: 'history-peer', senderHandle: 'Study Peer', senderAvatar: '',
      text: `Message ${index + 1}: ${index % 3 ? 'These older notes should remain visible when scrolling back.' : 'A longer study note with enough detail to wrap over several lines, so that backreading covers mixed message heights.'}`,
      timestamp: Date.now() + index,
    }));
    await page.route('**/api/chat/messages?*', route => route.fulfill({ json: { active: true, messages: history, isPeerTyping: false } }));
    for (const [index, target] of [page, peer].entries()) {
      await target.goto('/');
      await target.getByRole('textbox', { name: /email address/i }).fill(`backread-${index}@gmail.com`);
      await target.getByRole('button', { name: 'Continue in demo mode' }).click();
      await target.locator('#start-chat-btn').click();
    }
    await expect(page.locator('[data-message-bubble]')).toHaveCount(140);
    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    expect(await chatInput.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await chatInput.focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Open music controls' }).click();
    await page.getByRole('button', { name: 'Play Study Music' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ambient-aurora')).toBeVisible();
    const scroller = page.locator('#chat-messages-container');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('LayerTree.enable');
    let paints = 0;
    cdp.on('LayerTree.layerPainted', () => paints++);
    await page.waitForTimeout(2000); // Let the entrance animation and image decoding settle.
    paints = 0;
    const before = await cdp.send('Performance.getMetrics');
    await page.waitForTimeout(2000);
    const after = await cdp.send('Performance.getMetrics');
    const metric = (set: typeof before, name: string) => set.metrics.find(item => item.name === name)!.value;
    console.log(JSON.stringify({ steadyAuroraPaints: paints, taskMilliseconds: Math.round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000) }));
    for (const fraction of [0.75, 0.5, 0.25, 0]) {
      await scroller.evaluate((el, value) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * value; }, fraction);
      await expect(page.getByRole('button', { name: 'Scroll to latest messages' })).toBeVisible();
      const visible = await scroller.locator('[data-message-bubble]').evaluateAll(bubbles => bubbles.filter(bubble => {
        const box = bubble.getBoundingClientRect();
        return box.top > 80 && box.bottom < innerHeight - 180;
      }).map(bubble => ({ text: bubble.textContent, opacity: getComputedStyle(bubble).opacity, height: bubble.getBoundingClientRect().height })));
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every(bubble => bubble.text?.includes('Message ') && bubble.opacity === '1' && bubble.height > 20)).toBe(true);
      expect(await scroller.locator('[data-message-bubble]').evaluateAll(bubbles => bubbles.every(bubble => getComputedStyle(bubble).transform === 'none'))).toBe(true);
      await page.screenshot({ path: `test-results/mobile-backread-${fraction}.png` });
    }
    const position = await scroller.evaluate(el => el.scrollTop);
    history.push({ ...history[0], id: 'incoming', text: 'A new message while you are reading older notes.' });
    await expect(page.getByRole('button', { name: 'Scroll to latest messages' })).toContainText('1 new message');
    expect(await scroller.evaluate(el => el.scrollTop)).toBe(position);
    await page.getByRole('button', { name: 'Scroll to latest messages' }).click();
    await expect(page.getByText('A new message while you are reading older notes.', { exact: true })).toBeInViewport();
    // A vertical touch gesture must not start swipe-to-reply.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 320 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 144, y: 360 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 147, y: 460 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('button', { name: 'Cancel reply' })).toHaveCount(0);
    // Horizontal swiping still replies, then removes the temporary transform.
    const bubble = scroller.locator('[data-message-bubble]').last();
    await bubble.scrollIntoViewIfNeeded();
    await bubble.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 100, clientY: 400 }] });
    await bubble.dispatchEvent('touchmove', { touches: [{ identifier: 0, clientX: 170, clientY: 402 }] });
    await bubble.dispatchEvent('touchend', { touches: [] });
    await expect(page.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
    await expect(bubble).toHaveCSS('transform', 'none');
  } finally {
    await Promise.all([context.close(), other.close()]);
  }
});
