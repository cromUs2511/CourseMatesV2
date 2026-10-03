import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { moderateText, SafetyStore } from '../safety';

const secret = 'test-moderation-secret-not-used-in-production';
const day = 86_400_000;

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'coursemates-safety-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, 'moderation.json') };
}

test('anonymous moderation identities are stable across restarts without storing raw identifiers', (t) => {
  const { path } = fixture(t);
  const store = new SafetyStore({ path, secret });
  const actor = store.actor('private-browser-identifier');
  const target = store.actor('another-browser-identifier');
  assert.match(actor, /^[a-f0-9]{64}$/);
  assert.notEqual(actor, target);
  store.block(actor, target);
  store.ban(target);
  const report = store.report(actor, target, 'harassment', '::ffff:192.0.2.17');
  assert.deepEqual(Object.keys(report).sort(), [
    'category',
    'createdAt',
    'id',
    'ipAddress',
    'reporter',
    'status',
    'target',
  ]);
  assert.equal(report.ipAddress, '192.0.2.17');
  const reopened = new SafetyStore({ path, secret });
  assert.equal(reopened.actor('private-browser-identifier'), actor);
  assert.equal(reopened.isBlocked(target, actor), true);
  assert.equal(reopened.isBanned(target), true);
  assert.equal(reopened.listReports()[0]?.id, report.id);
  assert.equal(reopened.listReports()[0]?.ipAddress, '192.0.2.17');
  assert.equal(readFileSync(path, 'utf8').includes('browser-identifier'), false);
});

test('legacy reports load without an IP and newly reported IPs support temporary and permanent bans', (t) => {
  const { path } = fixture(t);
  let now = 1000;
  const store = new SafetyStore({ path, secret, now: () => now });
  const reporter = store.actor('reporter');
  const target = store.actor('target');
  const legacyReport = store.report(reporter, target, 'spam');
  const legacyState = JSON.parse(readFileSync(path, 'utf8'));
  delete legacyState.reports[0].ipAddress;
  writeFileSync(path, JSON.stringify(legacyState));
  assert.equal(new SafetyStore({ path, secret, now: () => now }).listReports()[0]?.ipAddress, null);

  const current = new SafetyStore({ path, secret, now: () => now });
  const report = current.report(reporter, target, 'other', '2001:db8::1');
  assert.equal(
    current.listReports().find((item) => item.id === report.id)?.ipAddress,
    '2001:db8::1',
  );
  current.ban(target, day, report.ipAddress);
  assert.equal(current.isBanned(target, '2001:0db8:0:0:0:0:0:1'), true);
  now += day;
  assert.equal(current.isBanned(target, report.ipAddress), false);
  current.ban(target, null, report.ipAddress);
  const reopened = new SafetyStore({ path, secret, now: () => now });
  assert.equal(reopened.isIpBanned('2001:db8::1'), true);
  assert.equal(reopened.listBans().length, 2);
  reopened.unbanIp('2001:db8::1');
  assert.equal(reopened.isIpBanned('2001:db8::1'), false);
  assert.equal(reopened.isActorBanned(target), true);
  reopened.unban(target);
  assert.equal(reopened.listBans().length, 0);
  assert.equal(legacyReport.ipAddress, null);
});

test('resolved reports and ban removal persist, and callers cannot mutate reports', (t) => {
  const { path } = fixture(t);
  const store = new SafetyStore({ path, secret });
  const actor = store.actor('a'),
    target = store.actor('b');
  const report = store.report(actor, target, 'spam');
  report.status = 'resolved';
  assert.equal(store.listReports()[0]?.status, 'open');
  store.ban(target, day);
  store.unban(target);
  store.resolveReport(report.id);
  const reopened = new SafetyStore({ path, secret });
  assert.equal(reopened.isBanned(target), false);
  assert.equal(reopened.listReports()[0]?.status, 'resolved');
  assert.throws(() => reopened.resolveReport('unknown'), /not found/i);
});

test('expired records are removed from both enforcement and durable storage', (t) => {
  const { path } = fixture(t);
  let now = 1000;
  const store = new SafetyStore({ path, secret, now: () => now });
  const actor = store.actor('a'),
    target = store.actor('b');
  store.block(actor, target);
  store.ban(target, day);
  store.report(actor, target, 'threats');
  now += day;
  assert.equal(store.isBanned(target), false);
  assert.equal(store.isBlocked(actor, target), true);
  now += 29 * day;
  assert.equal(store.isBlocked(actor, target), false);
  assert.deepEqual(store.listReports(), []);
  const reopened = new SafetyStore({ path, secret, now: () => now });
  assert.deepEqual(reopened.counts(), { bans: 0, blocks: 0, reports: 0, openReports: 0 });
});

test('capacity and per-reporter limits reject abuse without discarding active protections', () => {
  const limited = new SafetyStore({ secret, maxRecords: 2 });
  const actor = limited.actor('a'),
    target = limited.actor('b');
  limited.ban(actor);
  limited.block(actor, target);
  assert.throws(() => limited.report(actor, target, 'other'), /capacity/i);
  assert.equal(limited.isBanned(actor), true);
  assert.equal(limited.isBlocked(actor, target), true);
  const store = new SafetyStore({ secret });
  for (let i = 0; i < 20; i++) store.report(actor, target, 'other');
  assert.throws(() => store.report(actor, target, 'other'), /report limit/i);
});

test('corrupt, unsafe, or incompatible persisted data fails closed', (t) => {
  const { path } = fixture(t);
  writeFileSync(path, '{broken');
  assert.throws(() => new SafetyStore({ path, secret }), /moderation store/i);
  writeFileSync(path, JSON.stringify({ version: 1, bans: [], blocks: [], reports: [] }));
  assert.throws(() => new SafetyStore({ path, secret }), /moderation store/i);
  rmSync(path);
  const store = new SafetyStore({ path, secret });
  store.ban(store.actor('a'));
  assert.throws(() => new SafetyStore({ path, secret: 'changed-secret' }), /moderation store/i);
  const document = JSON.parse(readFileSync(path, 'utf8'));
  document.bans[0].until = 'forever';
  writeFileSync(path, JSON.stringify(document));
  assert.throws(() => new SafetyStore({ path, secret }), /moderation store/i);
});

test('failed atomic writes preserve the last committed data and fail closed thereafter', (t) => {
  const { path } = fixture(t);
  const store = new SafetyStore({ path, secret });
  const actor = store.actor('a'),
    target = store.actor('b');
  store.ban(actor);
  const committed = readFileSync(path, 'utf8');
  const oldPath = `${path}.previous`;
  renameSync(path, oldPath);
  mkdirSync(path);
  assert.throws(() => store.ban(target), /moderation store/i);
  assert.equal(readFileSync(oldPath, 'utf8'), committed);
  assert.throws(() => store.isBanned(target), /moderation store/i);
  rmSync(path, { recursive: true });
  renameSync(oldPath, path);
  const reopened = new SafetyStore({ path, secret });
  assert.equal(reopened.isBanned(actor), true);
  assert.equal(reopened.isBanned(target), false);
});

test('invalid categories, self-targeting, durations, and identifiers never enter the store', () => {
  const store = new SafetyStore({ secret });
  const actor = store.actor('a'),
    target = store.actor('b');
  assert.throws(() => store.report(actor, target, 'arbitrary-text' as 'spam'), /category/i);
  assert.throws(() => store.report(actor, actor, 'spam'), /yourself/i);
  assert.throws(() => store.block(actor, actor), /yourself/i);
  assert.throws(() => store.ban(target, 0), /duration/i);
  assert.throws(() => store.ban(target, 31 * day), /duration/i);
  assert.throws(() => store.ban('raw-browser-id'), /identity/i);
  assert.throws(() => store.actor(''), /identifier/i);
  assert.throws(() => new SafetyStore({ secret: '' }), /secret/i);
  assert.deepEqual(store.counts(), { bans: 0, blocks: 0, reports: 0, openReports: 0 });
});

test('shared severe filter rules block normalized threats and common evasions', () => {
  for (const text of [
    'kill yourself',
    'ＫＩＬＬ ＹＯＵＲＳＥＬＦ',
    'k i l l y o u r s e l f',
    'k1ll your$elf',
    'ki\u200bll yourself',
    'I WILL FIND YOU',
    'free robux',
    'exam answers for sale',
  ]) {
    assert.equal(moderateText(text).allowed, false, text);
  }
  assert.deepEqual(moderateText('kill yourself').categories, ['self_harm']);
});

test('whole-word moderation avoids course vocabulary false positives and reports mild categories', () => {
  for (const text of [
    'Our skills improve yourself through practice.',
    'Kysely database course',
    'Cryptography and giveaways in probability',
    'A textbook on idiotypes',
    'Happy skies today',
  ]) {
    assert.equal(moderateText(text).allowed, true, text);
  }
  assert.deepEqual(moderateText('That was stupid'), { allowed: true, categories: ['harassment'] });
});

test('moderation handles repeated-letter input without excessive regex backtracking', () => {
  const start = performance.now();
  assert.equal(moderateText('k'.repeat(24)).allowed, true);
  assert.ok(
    performance.now() - start < 500,
    'Repeated-letter input exceeded the moderation budget',
  );
});
