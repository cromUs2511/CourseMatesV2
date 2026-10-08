import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModerationDb, resolveModerationDbPath } from '../moderationDb';
import { SafetyStore } from '../safety';
import { attachRuntime, issueSession } from '../runtime';

test('moderation database resolves its path from environment', () => {
  assert.equal(
    resolveModerationDbPath({ MODERATION_DB_PATH: '/tmp/custom.db' } as NodeJS.ProcessEnv),
    '/tmp/custom.db',
  );
  assert.equal(
    resolveModerationDbPath({ DATA_DIR: '/data' } as NodeJS.ProcessEnv),
    '/data/moderation.db',
  );
  assert.equal(resolveModerationDbPath({} as NodeJS.ProcessEnv), undefined);
});

test('report conversation context and admin actions persist in sqlite', () => {
  const db = new ModerationDb();
  try {
    const reportId = '11111111-1111-4111-8111-111111111111';
    db.saveReportContext(
      reportId,
      {
        roomId: 'room-1',
        topic: 'Calculus',
        reporterHandle: 'Curious Fox #1234',
        targetHandle: 'Quiet Otter #5678',
        createdAt: 1000,
      },
      [
        {
          messageId: 'm1',
          senderRole: 'reporter',
          senderHandle: 'Curious Fox #1234',
          text: 'Hello',
          createdAt: 1000,
        },
        {
          messageId: 'm2',
          senderRole: 'target',
          senderHandle: 'Quiet Otter #5678',
          text: 'Hi there',
          createdAt: 1001,
        },
      ],
    );
    const context = db.getReportContext(reportId);
    assert.equal(context?.meta.topic, 'Calculus');
    assert.equal(context?.messages.length, 2);
    assert.equal(context?.messages[0]?.senderRole, 'reporter');
    assert.deepEqual(db.contextMetaFor([reportId, 'missing']), {
      [reportId]: { messageCount: 2 },
    });
    assert.equal(db.getReportContext('missing'), undefined);
    db.logAdminAction({ admin: 'admin', action: 'escalate', reportId, detail: 'needs review' });
    const actions = db.listAdminActions(reportId);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.action, 'escalate');
    assert.equal(db.listAdminActions(undefined, 10).length, 1);
    db.prune(2000);
    assert.equal(db.getReportContext(reportId), undefined);
    assert.equal(db.listAdminActions(reportId).length, 1);
  } finally {
    db.close();
  }
});

test('file-backed review database survives restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coursemates-moderation-db-'));
  try {
    const file = join(dir, 'moderation.db');
    const first = new ModerationDb(file);
    first.saveReportContext(
      '22222222-2222-4222-8222-222222222222',
      { roomId: null, topic: null, reporterHandle: null, targetHandle: null, createdAt: 500 },
      [
        {
          messageId: 'm1',
          senderRole: 'reporter',
          senderHandle: 'A',
          text: 'kept',
          createdAt: 500,
        },
      ],
    );
    first.logAdminAction({ admin: 'admin', action: 'resolve', reportId: null, detail: null });
    first.close();
    const second = new ModerationDb(file);
    try {
      assert.equal(
        second.getReportContext('22222222-2222-4222-8222-222222222222')?.messages.length,
        1,
      );
      assert.equal(second.listAdminActions(undefined, 10).length, 1);
    } finally {
      second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('safety reports carry review details and dismiss/escalate transitions', () => {
  const store = new SafetyStore({ secret: 'review-secret-for-tests' });
  const reporter = store.actor('reporter-browser');
  const target = store.actor('target-browser');
  const report = store.report(reporter, target, 'harassment', null, {
    roomId: 'room-9',
    topic: 'Physics',
    reason: 'Repeated insults after the problem set.',
    reporterHandle: 'Reporter #1',
    targetHandle: 'Target #2',
  });
  assert.equal(report.reason, 'Repeated insults after the problem set.');
  assert.equal(report.topic, 'Physics');
  store.dismissReport(report.id, 'Reviewed context; no violation.');
  assert.equal(store.getReport(report.id)?.status, 'dismissed');
  assert.equal(store.getReport(report.id)?.adminNote, 'Reviewed context; no violation.');
  store.escalateReport(report.id);
  assert.equal(store.getReport(report.id)?.status, 'escalated');
  store.resolveReport(report.id);
  assert.equal(store.getReport(report.id)?.status, 'resolved');
  assert.throws(() => store.setReportStatus(report.id, 'bogus' as never), /status/i);
  assert.throws(() => store.setReportStatus('00000000-0000-4000-8000-000000000000', 'resolved'));
});

const app = express();
app.use(express.json());
const server = http.createServer(app);
const adminPassword = 'review-admin-password-longer-than-32-characters';
const moderationDb = new ModerationDb();
const safety = new SafetyStore({ secret: 'runtime-review-secret' });
const stop = attachRuntime(app, server, {
  safety,
  moderationDb,
  adminUsername: 'review-admin',
  adminPassword,
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

async function adminCookie(): Promise<string> {
  const login = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'review-admin', password: adminPassword }),
  });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie')!.split(';', 1)[0]!;
}

test('reported chats expose conversation context and full review transitions', async () => {
  const a = issueSession('', {}, false, safety.actor('browser-a'));
  const b = issueSession('', {}, false, safety.actor('browser-b'));
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
  const matched = await (
    await fetch(base + '/api/match/join', {
      method: 'POST',
      headers: headers(b),
      body: JSON.stringify({ interests: ['Calculus'] }),
    })
  ).json();
  const roomId = matched.roomId as string;
  await fetch(base + '/api/chat/send', {
    method: 'POST',
    headers: headers(a),
    body: JSON.stringify({ roomId, text: 'Can we compare solutions?' }),
  });
  await fetch(base + '/api/chat/send', {
    method: 'POST',
    headers: headers(b),
    body: JSON.stringify({ roomId, text: 'Sure, which problem?' }),
  });
  const reported = await (
    await fetch(base + '/api/safety/report', {
      method: 'POST',
      headers: headers(a),
      body: JSON.stringify({ roomId, category: 'harassment', reason: 'Rude after greeting' }),
    })
  ).json();
  assert.equal(typeof reported.reportId, 'string');

  const cookie = await adminCookie();
  const adminHeaders = { Cookie: cookie };
  const list = await (await fetch(base + '/api/admin/reports', { headers: adminHeaders })).json();
  assert.equal(list.reports.length, 1);
  assert.equal(list.reports[0].reason, 'Rude after greeting');
  assert.equal(list.reports[0].topic, 'Calculus');
  assert.equal(list.reports[0].messageCount, 2);
  assert.equal(list.reports[0].hasContext, true);

  const detail = await (
    await fetch(base + '/api/admin/reports/' + reported.reportId, { headers: adminHeaders })
  ).json();
  assert.equal(detail.report.id, reported.reportId);
  assert.equal(detail.context.messages.length, 2);
  assert.equal(detail.context.messages[0].senderRole, 'reporter');
  assert.equal(detail.actions.length, 0);

  for (const action of ['escalate', 'dismiss', 'resolve'] as const) {
    const response = await fetch(base + '/api/admin/moderate', {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ action, reportId: reported.reportId, note: `${action} note` }),
    });
    assert.equal(response.status, 200);
  }
  const afterActions = await (
    await fetch(base + '/api/admin/reports/' + reported.reportId, { headers: adminHeaders })
  ).json();
  assert.equal(afterActions.report.status, 'resolved');
  assert.equal(afterActions.actions.length, 3);
  const trail = await (
    await fetch(base + '/api/admin/actions?reportId=' + reported.reportId, {
      headers: adminHeaders,
    })
  ).json();
  assert.equal(trail.actions.length, 3);
  assert.equal(
    await (
      await fetch(base + '/api/admin/reports/00000000-0000-4000-8000-000000000000', {
        headers: adminHeaders,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(base + '/api/admin/moderate', {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ action: 'resolve', reportId: 'not-a-uuid' }),
      })
    ).status,
    400,
  );
  assert.equal((await fetch(base + '/api/admin/reports')).status, 401);
});
