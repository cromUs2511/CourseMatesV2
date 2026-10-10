import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MEDIA_LOCK_MS,
  chatMediaRemainingSeconds,
  formatChatMediaCountdown,
} from '../src/data/chatMedia';

test('photo and voice countdown stays locked through 1:30 and opens at the boundary', () => {
  const unlockAt = 100_000 + CHAT_MEDIA_LOCK_MS;

  assert.equal(chatMediaRemainingSeconds(unlockAt, 100_000), 90);
  assert.equal(chatMediaRemainingSeconds(unlockAt, unlockAt - 1), 1);
  assert.equal(chatMediaRemainingSeconds(unlockAt, unlockAt), 0);
  assert.equal(chatMediaRemainingSeconds(unlockAt, unlockAt + 5_000), 0);
  assert.equal(formatChatMediaCountdown(90), '1:30');
  assert.equal(formatChatMediaCountdown(9), '0:09');
});
