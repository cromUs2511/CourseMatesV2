import { test, expect } from '@playwright/test';

const tracks = [
  {
    id: 'queue-track-one',
    title: 'Queue Track One',
    artist: 'Queue Test',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    youtubeVideoId: 'dQw4w9WgXcQ',
    category: 'custom',
  },
  {
    id: 'queue-track-two',
    title: 'Queue Track Two',
    artist: 'Queue Test',
    youtubeUrl: 'https://www.youtube.com/watch?v=s3a4OQR-10M',
    youtubeVideoId: 's3a4OQR-10M',
    category: 'custom',
  },
  {
    id: 'queue-track-three',
    title: 'Queue Track Three',
    artist: 'Queue Test',
    youtubeUrl: 'https://www.youtube.com/watch?v=yGHEis32s2Y',
    youtubeVideoId: 'yGHEis32s2Y',
    category: 'custom',
  },
];

test('music search queues songs in order and stops playback when the queue ends', async ({
  browser,
}) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) {
      await context.addInitScript(() => {
        (window as any).musicLoads = [];
        (window as any).musicStops = 0;
        (window as any).YT = {
          Player: class {
            private options: any;
            private position = 0;
            private lastUpdated = Date.now();
            private playing = false;
            constructor(element: HTMLElement, options: any) {
              this.options = options;
              const iframe = document.createElement('iframe');
              element.replaceWith(iframe);
              setTimeout(() => options.events.onReady({ target: this }), 0);
              (window as any).musicPlayer = this;
            }
            loadVideoById(video: string | { videoId: string; startSeconds: number }) {
              const videoId = typeof video === 'string' ? video : video.videoId;
              this.position = typeof video === 'string' ? 0 : video.startSeconds;
              this.lastUpdated = Date.now();
              (window as any).musicLoads.push(videoId);
              this.playVideo();
            }
            cueVideoById() {}
            playVideo() {
              this.position = this.getCurrentTime();
              this.lastUpdated = Date.now();
              this.playing = true;
              this.options.events.onStateChange({ target: this, data: 1 });
            }
            pauseVideo() {
              this.position = this.getCurrentTime();
              this.lastUpdated = Date.now();
              this.playing = false;
              this.options.events.onStateChange({ target: this, data: 2 });
            }
            stopVideo() {
              (window as any).musicStops += 1;
              this.position = 0;
              this.playing = false;
            }
            finish() {
              this.position = 240;
              this.playing = false;
              this.options.events.onStateChange({ target: this, data: 0 });
            }
            getCurrentTime() {
              return this.position + (this.playing ? (Date.now() - this.lastUpdated) / 1000 : 0);
            }
            seekTo(seconds: number) {
              this.position = seconds;
              this.lastUpdated = Date.now();
            }
            setVolume() {}
            mute() {}
            unMute() {}
            destroy() {}
          },
        };
      });
      await context.route('**/api/music/search?q=*', (route) =>
        route.fulfill({ json: { tracks } }),
      );
    }
    const firstContext = contexts[0];
    const secondContext = contexts[1];
    if (!firstContext || !secondContext) throw new Error('Music test needs two browser contexts.');
    const [first, second] = await Promise.all([firstContext.newPage(), secondContext.newPage()]);
    for (const page of [first, second]) {
      await page.goto('/');
      await page.getByRole('checkbox', { name: /at least 18 years old/i }).check();
      await page.getByRole('button', { name: 'Continue to CourseMates' }).click();
    }
    await first.locator('#start-chat-btn').click();
    await second.locator('#start-chat-btn').click();
    await expect(first.locator('#chat-header')).toBeVisible();
    await expect(second.locator('#chat-header')).toBeVisible();

    await first.getByRole('button', { name: 'Open music controls' }).click();
    await first
      .getByRole('searchbox', { name: 'Search music or paste a YouTube link' })
      .fill('queue test songs');
    await first.getByRole('button', { name: 'Go', exact: true }).click();
    await first.getByRole('button', { name: 'Play Queue Track One by Queue Test' }).click();
    await expect
      .poll(() => first.evaluate(() => (window as any).musicLoads.at(-1)))
      .toBe('dQw4w9WgXcQ');
    await first.getByRole('button', { name: 'Open music controls' }).click();
    await first.getByRole('button', { name: 'Add Queue Track Two to queue' }).click();
    await first.getByRole('button', { name: 'Add Queue Track Three to queue' }).click();
    await expect(first.getByRole('group', { name: 'Music queue' })).toContainText('Up next (2)');

    await second.getByRole('button', { name: 'Open music controls' }).click();
    for (const page of [first, second])
      await expect(page.getByRole('button', { name: 'Pause Study Music' })).toBeVisible();
    const firstTrackLoads = await Promise.all(
      [first, second].map((page) => page.evaluate(() => (window as any).musicLoads.length)),
    );
    await first.getByRole('button', { name: 'Pause Study Music' }).click();
    for (const page of [first, second])
      await expect(page.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
    await first.getByRole('button', { name: 'Play Study Music' }).click();
    expect(
      await Promise.all(
        [first, second].map((page) => page.evaluate(() => (window as any).musicLoads.length)),
      ),
    ).toEqual(firstTrackLoads);

    const firstAdvance = first.waitForResponse('**/api/chat/music/next');
    await first.evaluate(() => (window as any).musicPlayer.finish());
    const firstAdvanceState = await (await firstAdvance).json();
    expect(firstAdvanceState.music.trackId).toBe(tracks[1]?.id);
    expect(firstAdvanceState.music.isPlaying).toBe(true);
    for (const page of [first, second])
      await expect
        .poll(() => page.evaluate(() => (window as any).musicLoads.at(-1)))
        .toBe('s3a4OQR-10M');
    await expect(first.getByRole('group', { name: 'Music queue' })).toContainText('Up next (1)');

    const secondAdvance = first.waitForResponse('**/api/chat/music/next');
    await first.evaluate(() => (window as any).musicPlayer.finish());
    const secondAdvanceState = await (await secondAdvance).json();
    expect(secondAdvanceState.music.trackId).toBe(tracks[2]?.id);
    expect(secondAdvanceState.music.isPlaying).toBe(true);
    for (const page of [first, second])
      await expect
        .poll(() => page.evaluate(() => (window as any).musicLoads.at(-1)))
        .toBe('yGHEis32s2Y');
    const stopResponse = first.waitForResponse('**/api/chat/music/next');
    await first.evaluate(() => (window as any).musicPlayer.finish());
    const stoppedState = await (await stopResponse).json();
    expect(stoppedState.music.isPlaying).toBe(false);

    await expect(first.locator('#top-music-bar')).toHaveAttribute('data-playing', 'false');
    await expect.poll(() => first.evaluate(() => (window as any).musicStops)).toBeGreaterThan(0);
    await expect
      .poll(() => second.locator('#top-music-bar').getAttribute('data-playing'))
      .toBe('false');
    await expect.poll(() => second.evaluate(() => (window as any).musicStops)).toBeGreaterThan(0);
    for (const page of [first, second])
      await expect(page.getByRole('button', { name: 'Play Study Music' })).toBeVisible();
    await expect(first.getByRole('group', { name: 'Music queue' })).toContainText('Up next (0)');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
