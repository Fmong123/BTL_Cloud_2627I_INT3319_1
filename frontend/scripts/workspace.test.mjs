import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRetry,
  fileFingerprint,
  filterFiles,
  PREFERENCES_KEY,
  readPreferences,
  savePreferences,
  uiPreferenceDefaults,
} from '../src/utils/workspace.js';
import { checkHealth } from '../src/api/client.js';

const defaults = {
  ...uiPreferenceDefaults,
  theme: 'system',
  view: 'list',
  sort: 'newest',
  mode: 'demo',
  baseUrl: 'http://localhost:8000',
};
test('preferences tolerate unavailable storage, malformed JSON and unsupported versions', () => {
  for (const value of [
    'invalid',
    'null',
    '{"version":3}',
    '{"version":1,"theme":"nope","view":null}',
  ]) {
    const storage = { getItem: () => value };
    assert.deepEqual(readPreferences(defaults, storage), defaults);
  }
  assert.deepEqual(
    readPreferences(defaults, {
      getItem() {
        throw new Error('blocked');
      },
    }),
    defaults,
  );
  assert.equal(
    savePreferences(defaults, {
      setItem() {
        throw new Error('quota');
      },
    }),
    false,
  );
  let saved;
  assert.equal(
    savePreferences(
      { ...defaults, theme: 'dark' },
      {
        setItem(key, value) {
          assert.equal(key, PREFERENCES_KEY);
          saved = value;
        },
      },
    ),
    true,
  );
  assert.equal(readPreferences(defaults, { getItem: () => saved }).theme, 'dark');
});
test('filters compose, Vietnamese search works, source order is preserved and recent expires', () => {
  const files = [
    {
      id: 'a',
      name: 'Báo cáo.pdf',
      size: 20,
      createdAt: 100,
      status: 'success',
      starred: true,
    },
    {
      id: 'b',
      name: 'Đồ án.csv',
      size: 10,
      createdAt: 200,
      status: 'error',
      starred: false,
    },
    {
      id: 'c',
      name: 'Ảnh.png',
      size: 30,
      createdAt: 300,
      status: 'uploading',
      original: {},
      starred: false,
    },
  ];
  assert.deepEqual(
    filterFiles(files, {
      q: 'bao cao',
      status: 'success',
      category: 'document',
      section: 'starred',
    }).map((f) => f.id),
    ['a'],
  );
  assert.equal(filterFiles(files, { q: 'do an' })[0].id, 'b');
  assert.equal(filterFiles(files, { status: 'active' })[0].id, 'c');
  assert.deepEqual(
    filterFiles(files, { sort: 'size-desc' }).map((f) => f.id),
    ['c', 'a', 'b'],
  );
  assert.equal(filterFiles(files, { section: 'recent' }, 86400300).length, 0);
  assert.deepEqual(
    files.map((f) => f.id),
    ['a', 'b', 'c'],
  );
});
test('only retryable failures and cancellations can retry; fingerprints use all three fields', () => {
  assert.equal(canRetry({ status: 'error', validationError: true }), false);
  assert.equal(canRetry({ status: 'error', retryable: false }), false);
  assert.equal(canRetry({ status: 'cancelled', original: {} }), true);
  assert.equal(canRetry({ status: 'cancelled' }), false);
  assert.equal(canRetry({ status: 'error', original: {}, reconciling: true }), false);
  assert.equal(canRetry({ status: 'error', original: {}, outcomeUnknown: true }), false);
  assert.equal(canRetry({ status: 'success' }), false);
  assert.equal(
    fileFingerprint({ name: 'a', size: 2, lastModified: 3 }),
    fileFingerprint({ name: 'a', size: 2, lastModified: 3 }),
  );
  assert.notEqual(
    fileFingerprint({ name: 'a', size: 2, lastModified: 3 }),
    fileFingerprint({ name: 'a', size: 2, lastModified: 4 }),
  );
});
test('health preserves server limit and rejects invalid responses and HTTP errors', async () => {
  const data = {
    status: 'ok',
    storage: 'local',
    storage_configured: true,
    max_file_size_bytes: 42,
  };
  const fetcher = async (url) => {
    assert.equal(url, 'http://localhost:8000/health');
    return { ok: true, json: async () => data };
  };
  assert.equal((await checkHealth('http://localhost:8000/', { fetcher })).max_file_size_bytes, 42);
  for (const bad of [{}, { ...data, max_file_size_bytes: 0 }, { ...data, storage: 'fake' }]) {
    await assert.rejects(
      checkHealth('http://localhost:8000', {
        fetcher: async () => ({ ok: true, json: async () => bad }),
      }),
    );
  }
  await assert.rejects(
    checkHealth('http://localhost:8000', {
      fetcher: async () => ({ ok: false, status: 503 }),
    }),
    /503/,
  );
});
test('health times out and propagates caller cancellation', async () => {
  const fetcher = async (_, { signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
    });
  await assert.rejects(
    checkHealth('http://localhost:8000', { timeout: 5, fetcher }),
    /chưa phản hồi/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    checkHealth('http://localhost:8000', {
      signal: controller.signal,
      fetcher,
    }),
    { name: 'AbortError' },
  );
});
