import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { autoEscalateThreshold, triageConversation } from '../autoModeration';
import { SafetyStore } from '../safety';
import { ModerationDb } from '../moderationDb';
import { attachRuntime, issueSession } from '../runtime';

test('triage flags severe language as high risk', () => {
  const result = triageConversation(
    [
      { text: 'hey, how are you?', senderRole: 'reporter', createdAt: 1000 },
      { text: 'kill yourself', senderRole: 'target', createdAt: 1001 },
    ],
    'harassment',
    { reportsAgainstTarget: 0, targetBans: 0, reportsFiledByReporter: 0 },
  );
  assert.ok(result.signals.some((signal) => signal.code === 'severe-language'));
  assert.equal(result.label, 'high');
  assert.ok(result.score >= 50 && result.score < 80);
});

test('triage reaches critical with repetition, history, and severe language', () => {
  const result = triageConversation(
    [
      { text: 'kill yourself', senderRole: 'target', createdAt: 1000 },
      { text: 'kill yourself', senderRole: 'target', createdAt: 1001 },
      { text: 'kill yourself', senderRole: 'target', createdAt: 1002 },
    ],
    'threats',
    { reportsAgainstTarget: 4, targetBans: 1, reportsFiledByReporter: 0 },
  );
  assert.equal(result.label, 'critical');
  assert.ok(result.score >= 80);
  assert.ok(result.signals.some((signal) => signal.code === 'repeated-messages'));
  assert.ok(result.signals.some((signal) => signal.code === 'target-recidivism'));
});

test('triage detects spam bursts and concerning language without severe hits', () => {
  const burst = Array.from({ length: 7 }, (_, index) => ({
    text: `deal number ${index}`,
    senderRole: 'target' as const,
    createdAt: 1000 + index * 5000,
  }));
  const result = triageConversation(burst, 'spam', {
    reportsAgainstTarget: 0,
    targetBans: 0,
    reportsFiledByReporter: 0,
  });
  assert.ok(result.signals.some((signal) => signal.code === 'spam-burst'));

  const mild = triageConversation(
    [{ text: 'That was stupid', senderRole: 'target', createdAt: 1000 }],
    'other',
    { reportsAgainstTarget: 0, targetBans: 0, reportsFiledByReporter: 0 },
  );
  assert.ok(mild.signals.some((signal) => signal.code === 'concerning-language'));
});

test('clean chats score low and frequent reporters are noted without penalty', () => {
  const result = triageConversation(
    [
      { text: 'Can we compare solutions?', senderRole: 'reporter', createdAt: 1000 },
      { text: 'Sure, which problem?', senderRole: 'target', createdAt: 1001 },
    ],
    'other',
    { reportsAgainstTarget: 0, targetBans: 0, reportsFiledByReporter: 20 },
  );
  assert.equal(result.label, 'low');
  assert.ok(result.signals.some((signal) => signal.code === 'frequent-reporter'));
  assert.equal(result.signals.find((signal) => signal.code === 'frequent-reporter')?.weight, 0);
});

test('auto-escalation threshold reads configuration with a safe default', () => {
  assert.equal(autoEscalateThreshold({} as NodeJS.ProcessEnv), 80);
  assert.equal(autoEscalateThreshold({ AUTO_MOD_ESCALATE_SCORE: '0' } as NodeJS.ProcessEnv), 0);
  assert.equal(autoEscalateThreshold({ AUTO_MOD_ESCALATE_SCORE: 'off' } as NodeJS.ProcessEnv), 0);
  assert.equal(autoEscalateThreshold({ AUTO_MOD_ESCALATE_SCORE: '50' } as NodeJS.ProcessEnv), 50);
  assert.equal(autoEscalateThreshold({ AUTO_MOD_ESCALATE_SCORE: '500' } as NodeJS.ProcessEnv), 100);
  assert.equal(
    autoEscalateThreshold({ AUTO_MOD_ESCALATE_SCORE: 'nonsense' } as NodeJS.ProcessEnv),
    80,
  );
});

const app = express();
app.use(express.json());
const server = http.createServer(app);
const safety = new SafetyStore({ secret: 'auto-mod-test-secret' });
const moderationDb = new ModerationDb();
const stop = attachRuntime(app, server, {
  safety,
  moderationDb,
  adminUsername: 'auto-mod-admin',
  adminPassword: 'auto-mod-admin-password-longer-than-32-chars',
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

async function pair() {
  const a = issueSession('', {}, false, safety.actor('triage-browser-a'));
  const b = issueSession('', {}, false, safety.actor('triage-browser-b'));
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
  return { a, b, headers, roomId: matched.roomId as string };
}

async function send(headers: Record<string, string>, roomId: string, text: string) {
  const response = await fetch(base + '/api/chat/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({ roomId, text }),
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { message: { id: string } }).message.id;
}

async function adminCookie(): Promise<string> {
  const login = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      username: 'auto-mod-admin',
      password: 'auto-mod-admin-password-longer-than-32-chars',
    }),
  });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie')!.split(';', 1)[0]!;
}

test('one message can be flagged and triage scores the report', async () => {
  const { a, b, headers, roomId } = await pair();
  try {
    await send(headers(a), roomId, 'Can we compare solutions?');
    const targetIds: string[] = [];
    for (let index = 0; index < 6; index += 1)
      targetIds.push(await send(headers(b), roomId, `deal number ${index}`));
    const flagged = targetIds[2]!;
    const reported = await (
      await fetch(base + '/api/safety/report', {
        method: 'POST',
        headers: headers(a),
        body: JSON.stringify({ roomId, category: 'spam', messageId: flagged }),
      })
    ).json();
    assert.equal(typeof reported.reportId, 'string');

    const cookie = await adminCookie();
    const adminHeaders = { Cookie: cookie };
    const list = await (await fetch(base + '/api/admin/reports', { headers: adminHeaders })).json();
    const entry = list.reports.find((report: { id: string }) => report.id === reported.reportId);
    assert.equal(entry.messageId, flagged);
    assert.ok(entry.autoScore >= 20);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(entry.autoLabel));

    const detail = await (
      await fetch(base + '/api/admin/reports/' + reported.reportId, { headers: adminHeaders })
    ).json();
    assert.ok(detail.triage);
    assert.ok(
      detail.triage.signals.some((signal: { code: string }) => signal.code === 'spam-burst'),
    );
    const flaggedMessage = detail.context.messages.find(
      (message: { messageId: string }) => message.messageId === flagged,
    );
    assert.ok(flaggedMessage);

    const unknown = await fetch(base + '/api/safety/report', {
      method: 'POST',
      headers: headers(a),
      body: JSON.stringify({ roomId, category: 'spam', messageId: 'missing-message' }),
    });
    assert.equal(unknown.status, 400);
    const ownMessage = await send(headers(a), roomId, 'my own message');
    const own = await fetch(base + '/api/safety/report', {
      method: 'POST',
      headers: headers(a),
      body: JSON.stringify({ roomId, category: 'spam', messageId: ownMessage }),
    });
    assert.equal(own.status, 400);
  } finally {
    await fetch(base + '/api/match/cancel', {
      method: 'POST',
      headers: headers(a),
      body: '{}',
    });
  }
});

test('critical triage auto-escalates for human review without banning', async () => {
  process.env.AUTO_MOD_ESCALATE_SCORE = '1';
  try {
    const { a, b, headers, roomId } = await pair();
    try {
      await send(headers(a), roomId, 'hello');
      await send(headers(b), roomId, 'That was stupid');
      const reported = await (
        await fetch(base + '/api/safety/report', {
          method: 'POST',
          headers: headers(a),
          body: JSON.stringify({ roomId, category: 'harassment' }),
        })
      ).json();
      const cookie = await adminCookie();
      const detail = await (
        await fetch(base + '/api/admin/reports/' + reported.reportId, {
          headers: { Cookie: cookie },
        })
      ).json();
      assert.equal(detail.report.status, 'escalated');
      assert.ok(
        detail.actions.some(
          (entry: { admin: string; action: string }) =>
            entry.admin === 'auto-triage' && entry.action === 'escalate',
        ),
      );
      assert.equal(detail.report.adminNote?.includes('Auto-escalated'), true);
    } finally {
      await fetch(base + '/api/match/cancel', {
        method: 'POST',
        headers: headers(a),
        body: '{}',
      });
    }
  } finally {
    delete process.env.AUTO_MOD_ESCALATE_SCORE;
  }
});
