import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMessageSnapshot } from '../src/utils/chatMessages';
import type { ChatMessage } from '../src/types';

const message = { id: 'one', senderId: 'peer', senderHandle: 'Peer', senderAvatar: '', isMe: false, text: 'Hello', timestamp: 1 };
test('unchanged polls preserve history and message references', () => {
  const history = reconcileMessageSnapshot([], [message], 'me');
  assert.equal(reconcileMessageSnapshot(history, [{ ...message }], 'me'), history);
});
test('transient empty polls preserve active chat history', () => {
  const history = reconcileMessageSnapshot([], [message], 'me');
  assert.equal(reconcileMessageSnapshot(history, [], 'me'), history);
});
test('polling still applies reactions, replies, photos and unsent messages', () => {
  let history = reconcileMessageSnapshot([], [message, { ...message, id: 'two' }], 'me');
  const unchanged = history[1];
  for (const change of [
    { reactions: { me: '❤️' } },
    { replyTo: { id: 'quote', senderHandle: 'Me', text: 'Question' } },
    { images: [{ id: 'photo', name: 'Notes', url: '/notes.png', width: 30, height: 20 }] },
    { type: 'system' as const, text: 'Message unsent.' },
  ]) {
    const next = reconcileMessageSnapshot(history, [{ ...message, ...change }, { ...message, id: 'two' }], 'me');
    assert.notEqual(next, history);
    assert.deepEqual(next[0], { ...message, ...change });
    assert.equal(next[1], unchanged);
    history = next;
  }
});
test('local notices survive snapshots and own messages are identified', () => {
  const notice: ChatMessage = { ...message, id: 'local', type: 'system' };
  const history = reconcileMessageSnapshot([notice], [{ ...message, senderId: 'me' }], 'me');
  assert.equal(history[0], notice);
  assert.equal(history[1].isMe, true);
});
