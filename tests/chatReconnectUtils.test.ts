import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveActiveChat, loadActiveChat, clearActiveChat } from '../src/utils/chatReconnect';
import { pastedImageFiles } from '../src/utils/clipboardImages';

const peer = {
  sessionId: 'peer-session',
  handle: 'Gentle Dolphin #1505',
  avatar: '🐬',
  interests: [],
  topic: 'General Peer Discovery',
  matchedAt: 1,
  mediaUnlockAt: 2,
};
const snapshot = {
  version: 1 as const,
  sessionId: 'session-a',
  roomId: 'room-1',
  peer,
  topic: 'T',
};

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}
const realStorage = (globalThis as Record<string, unknown>).localStorage;
afterEach(() => {
  (globalThis as Record<string, unknown>).localStorage = realStorage;
});

test('active chat snapshots round-trip through storage', () => {
  (globalThis as Record<string, unknown>).localStorage = fakeStorage();
  assert.equal(loadActiveChat(), null);
  saveActiveChat(snapshot);
  assert.deepEqual(loadActiveChat(), snapshot);
  clearActiveChat();
  assert.equal(loadActiveChat(), null);
});

test('corrupt or foreign snapshots never restore', () => {
  const storage = fakeStorage();
  (globalThis as Record<string, unknown>).localStorage = storage;
  const { roomId: _dropped, ...withoutRoom } = snapshot;
  for (const raw of [
    'not json{',
    JSON.stringify({ ...snapshot, version: 2 }),
    JSON.stringify({ ...snapshot, roomId: 42 }),
    JSON.stringify({ ...snapshot, peer: { handle: 'Nope' } }),
    JSON.stringify(withoutRoom),
  ]) {
    storage.setItem('cm_active_chat', raw);
    assert.equal(loadActiveChat(), null);
  }
});

test('storage helpers never throw when storage is unavailable', () => {
  delete (globalThis as Record<string, unknown>).localStorage;
  assert.equal(loadActiveChat(), null);
  saveActiveChat(snapshot);
  clearActiveChat();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(loadActiveChat(), null);
  saveActiveChat(snapshot);
  clearActiveChat();
});

const fakeFile = (overrides: Partial<File> = {}) =>
  ({
    name: 'photo.png',
    size: 100,
    type: 'image/png',
    lastModified: 7,
    ...overrides,
  }) as File;

test('pastedImageFiles takes images from files and items without duplicating', () => {
  const fromFiles = fakeFile({ name: 'a.png' });
  const shared = fakeFile({ name: 'b.png' });
  const data = {
    files: [fromFiles, fakeFile({ name: 'movie.mp4', type: 'video/mp4' })],
    items: [
      { kind: 'file', type: 'image/png', getAsFile: () => shared },
      // Same blob offered through both lists counts once.
      { kind: 'file', type: 'image/png', getAsFile: () => ({ ...shared }) },
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ],
  };
  assert.deepEqual(
    pastedImageFiles(data as never).map((file) => file.name),
    ['a.png', 'b.png'],
  );
});

test('pastedImageFiles ignores text and hostile clipboards', () => {
  assert.deepEqual(pastedImageFiles(null), []);
  assert.deepEqual(pastedImageFiles(undefined), []);
  assert.deepEqual(pastedImageFiles({} as never), []);
  assert.deepEqual(
    pastedImageFiles({ files: [], items: [{ kind: 'string', type: 'text/plain' }] } as never),
    [],
  );
  assert.deepEqual(
    pastedImageFiles({
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => {
            throw new Error('denied');
          },
        },
      ],
    } as never),
    [],
  );
});
