import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { screenImagePixels, isSkinPixel } from '../src/data/imageNudity';
import { ModerationDb } from '../moderationDb';
import { SafetyStore } from '../safety';
import { attachRuntime, issueSession } from '../runtime';

function buffer(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  return data;
}

const SKIN: [number, number, number] = [200, 150, 120];
const SKY: [number, number, number] = [100, 150, 220];
const GRAY: [number, number, number] = [120, 120, 120];

test('skin rule needs real chroma, so grayscale never qualifies', () => {
  assert.equal(isSkinPixel(...SKIN), true);
  assert.equal(isSkinPixel(...SKY), false);
  assert.equal(isSkinPixel(...GRAY), false);
  assert.equal(isSkinPixel(220, 30, 30), false);
});

test('full-frame skin exposure is refused with a high score', () => {
  const verdict = screenImagePixels(
    buffer(64, 64, () => SKIN),
    64,
    64,
  );
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.score >= 80);
  assert.equal(verdict.skinRatio, 1);
});

test('ordinary scenes, portraits, and scattered skin pass', () => {
  assert.equal(
    screenImagePixels(
      buffer(64, 64, () => SKY),
      64,
      64,
    ).allowed,
    true,
  );
  assert.equal(
    screenImagePixels(
      buffer(64, 64, () => GRAY),
      64,
      64,
    ).allowed,
    true,
  );
  // Face-like band across the top quarter.
  assert.equal(
    screenImagePixels(
      buffer(64, 64, (_x, y) => (y < 16 ? SKIN : SKY)),
      64,
      64,
    ).allowed,
    true,
  );
  // Small centered spot on a plain background.
  assert.equal(
    screenImagePixels(
      buffer(64, 64, (x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 100 ? SKIN : SKY)),
      64,
      64,
    ).allowed,
    true,
  );
  // Checkerboard: half the pixels are skin but nothing connects.
  assert.equal(
    screenImagePixels(
      buffer(64, 64, (x, y) => ((x + y) % 2 === 0 ? SKIN : SKY)),
      64,
      64,
    ).allowed,
    true,
  );
});

test('dominant lower-frame exposure is refused', () => {
  const verdict = screenImagePixels(
    buffer(64, 64, (_x, y) => (y >= 21 ? SKIN : SKY)),
    64,
    64,
  );
  assert.equal(verdict.allowed, false);
});

test('thumbnails too small to judge always pass', () => {
  assert.equal(
    screenImagePixels(
      buffer(1, 1, () => SKIN),
      1,
      1,
    ).allowed,
    true,
  );
  assert.equal(
    screenImagePixels(
      buffer(1, 1, () => SKIN),
      1,
      1,
    ).score,
    0,
  );
});

test('image fingerprint bans persist, lift, and prune like other records', () => {
  const db = new ModerationDb();
  try {
    const hash = 'a'.repeat(64);
    assert.equal(db.imageHashBanned(hash), false);
    assert.equal(db.imageHashBanned('not-a-hash'), false);
    db.banImageHash('not-a-hash');
    assert.equal(db.imageHashBanned('not-a-hash'), false);
    db.banImageHash(hash, 'report-1');
    assert.equal(db.imageHashBanned(hash), true);
    assert.deepEqual(
      db.listBannedImageHashes().map((entry) => entry.hash),
      [hash],
    );
    db.saveReportImageHashes('report-1', [hash, 'b'.repeat(64), 'junk']);
    assert.deepEqual(db.getReportImageHashes('report-1'), [hash, 'b'.repeat(64)]);
    assert.deepEqual(db.reportImageHashCounts(['report-1', 'missing']), { 'report-1': 2 });
    db.prune(Date.now() + 1000);
    assert.deepEqual(db.getReportImageHashes('report-1'), []);
    assert.equal(db.imageHashBanned(hash), true);
    db.unbanImageHash(hash);
    assert.equal(db.imageHashBanned(hash), false);
    assert.deepEqual(db.listBannedImageHashes(), []);
  } finally {
    db.close();
  }
});

const app = express();
app.use(express.json());
const server = http.createServer(app);
const safety = new SafetyStore({ secret: 'image-safety-test-secret' });
const moderationDb = new ModerationDb();
const stop = attachRuntime(app, server, {
  safety,
  moderationDb,
  adminUsername: 'image-admin',
  adminPassword: 'image-admin-password-longer-than-32-characters',
});
let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
after(async () => {
  stop();
  moderationDb.close();
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const gifBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const gifHash = crypto.createHash('sha256').update(gifBytes).digest('hex');
const gifPayload = {
  name: 'dot.gif',
  dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  width: 1,
  height: 1,
};

async function adminCookie(): Promise<string> {
  const login = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      username: 'image-admin',
      password: 'image-admin-password-longer-than-32-characters',
    }),
  });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie')!.split(';', 1)[0]!;
}

test('banned photo fingerprints are rejected on send and lift cleanly', async () => {
  const a = issueSession('', {}, false, safety.actor('img-browser-a'));
  const b = issueSession('', {}, false, safety.actor('img-browser-b'));
  const headers = (session: { token: string }) => ({
    'Content-Type': 'application/json',
    Origin: base,
    Cookie: 'cm_session=' + session.token,
  });
  await fetch(base + '/api/match/join', {
    method: 'POST',
    headers: headers(a),
    body: JSON.stringify({ interests: ['Calculus'] }),
  });
  const roomId = (
    (await (
      await fetch(base + '/api/match/join', {
        method: 'POST',
        headers: headers(b),
        body: JSON.stringify({ interests: ['Calculus'] }),
      })
    ).json()) as { roomId: string }
  ).roomId;
  const sendPhoto = (session: { token: string }) =>
    fetch(base + '/api/chat/send', {
      method: 'POST',
      headers: headers(session),
      body: JSON.stringify({ roomId, text: 'hello', images: [gifPayload] }),
    });
  try {
    // Baseline: unbanned photo reaches the media lock, not a restriction.
    const baseline = await (await sendPhoto(b)).json();
    assert.match(baseline.error, /available in/);

    const cookie = await adminCookie();
    const adminHeaders = {
      Cookie: cookie,
      'Content-Type': 'application/json',
      Origin: base,
    };
    const ban = await fetch(base + '/api/admin/moderate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ action: 'banImage', imageHash: gifHash }),
    });
    assert.equal(ban.status, 200);
    const blocked = await (await sendPhoto(b)).json();
    assert.match(blocked.error, /restricted by moderators/);
    const listed = await (
      await fetch(base + '/api/admin/images', { headers: { Cookie: cookie } })
    ).json();
    assert.deepEqual(
      listed.bannedImages.map((entry: { hash: string }) => entry.hash),
      [gifHash],
    );

    // Reports can attach the fingerprint; the detail view reflects the ban.
    const reported = (await (
      await fetch(base + '/api/safety/report', {
        method: 'POST',
        headers: headers(a),
        body: JSON.stringify({ roomId, category: 'other', imageHashes: [gifHash] }),
      })
    ).json()) as { reportId: string };
    const detail = await (
      await fetch(base + '/api/admin/reports/' + reported.reportId, {
        headers: { Cookie: cookie },
      })
    ).json();
    assert.deepEqual(detail.imageHashes, [{ hash: gifHash, banned: true }]);

    const unban = await fetch(base + '/api/admin/moderate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ action: 'unbanImage', imageHash: gifHash }),
    });
    assert.equal(unban.status, 200);
    const afterLift = await (await sendPhoto(b)).json();
    assert.match(afterLift.error, /available in/);

    const invalid = await fetch(base + '/api/admin/moderate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ action: 'banImage', imageHash: 'junk' }),
    });
    assert.equal(invalid.status, 400);
    const malformed = await fetch(base + '/api/safety/report', {
      method: 'POST',
      headers: headers(a),
      body: JSON.stringify({ roomId, category: 'other', imageHashes: 'junk' }),
    });
    assert.equal(malformed.status, 400);
  } finally {
    await fetch(base + '/api/match/cancel', {
      method: 'POST',
      headers: headers(a),
      body: '{}',
    });
  }
});
