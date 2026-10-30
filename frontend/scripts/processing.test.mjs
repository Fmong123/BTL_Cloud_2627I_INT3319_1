import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  getFileStatus,
  listFiles,
  parseUploadResponse,
  uploadFile,
} from '../src/api/client.js';
import {
  isAttention,
  mergeServerFiles,
  needsTracking,
  normalizeServerFile,
  normalizeStatus,
} from '../src/utils/processing.js';
import { canRetry, filterFiles, isBusy } from '../src/utils/workspace.js';

const at = '2026-10-27T03:00:00.000Z';
const later = '2026-10-27T03:00:10.000Z';
const raw = (patch = {}) => ({
  id: 'file-1',
  owner_id: 'dev-user',
  original_name: 'Báo cáo.pdf',
  content_type: 'application/pdf',
  size_bytes: 42,
  key: 'uploads/dev-user/file-1/file.pdf',
  storage: 's3',
  upload_state: 'uploaded',
  scan_status: 'scanning',
  created_at: at,
  updated_at: at,
  findings_count: 0,
  finding_types: [],
  status_reason: null,
  scanned_at: null,
  quarantined_at: null,
  ...patch,
});
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

test('normalization separates successful upload from pending scan and validates metadata', () => {
  const file = normalizeServerFile(raw());
  assert.equal(file.id, 'server:file-1');
  assert.equal(file.status, 'success');
  assert.equal(file.scanStatus, 'scanning');
  assert.equal(file.createdAt, Date.parse(at));
  assert.equal(file.serverOnly, true);
  assert.equal(needsTracking(file), true);
  assert.equal(isBusy(file), false);
  for (const patch of [
    { size_bytes: -1 },
    { size_bytes: true },
    { scan_status: 'clean' },
    { upload_state: 'done' },
    { updated_at: '2026-10-27T03:00:00' },
    { findings_count: -1 },
    { findings_count: true },
    { finding_types: 'PII' },
    { scanned_at: 'bad' },
  ]) {
    assert.throws(() => normalizeServerFile(raw(patch)));
  }
});

test('attention areas and scan filters do not confuse ordinary files with safe files', () => {
  const pending = normalizeServerFile(raw());
  const safe = normalizeServerFile(raw({ id: 'safe', scan_status: 'safe' }));
  const flagged = normalizeServerFile(
    raw({ id: 'flagged', scan_status: 'flagged', findings_count: 2, finding_types: ['CCCD'] }),
  );
  const quarantined = normalizeServerFile(
    raw({ id: 'quarantined', scan_status: 'quarantined', quarantined_at: later }),
  );
  const partial = normalizeServerFile(
    raw({ id: 'partial', scan_status: 'quarantine_delete_failed' }),
  );
  const unknown = normalizeServerFile(raw({ id: 'unknown', upload_state: 'unknown' }));
  assert.equal(isAttention(pending), false);
  assert.equal(isAttention(safe), false);
  assert.equal(isAttention({ mode: 'api', status: 'error' }), true);
  assert.equal(isAttention({ mode: 'api', status: 'unknown' }), true);
  assert.equal(isAttention({ mode: 'demo', status: 'error' }), false);
  for (const file of [flagged, quarantined, partial, unknown])
    assert.equal(isAttention(file), true);
  assert.equal(needsTracking(flagged), true);
  assert.equal(needsTracking(quarantined), false);
  assert.equal(needsTracking(partial), false);
  assert.equal(needsTracking(unknown), true);
  const all = [pending, safe, flagged, quarantined, partial, unknown];
  assert.equal(filterFiles(all, { area: 'normal' }).length, 2);
  assert.equal(filterFiles(all, { area: 'attention' }).length, 4);
  assert.deepEqual(
    filterFiles(all, { area: 'attention', scan: 'flagged' }).map((file) => file.remoteId),
    ['flagged'],
  );
});

test('merge reconciles local/server identity, preserves transfers and rejects stale list versions', () => {
  const original = { name: 'Báo cáo.pdf' };
  const local = {
    id: 'browser-1',
    remoteId: 'file-1',
    original,
    status: 'uploading',
    progress: 45,
    starred: true,
    origin: 'local',
    scope: 'one',
  };
  const merged = mergeServerFiles([local], [{ ...normalizeServerFile(raw()), scope: 'one' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'browser-1');
  assert.equal(merged[0].original, original);
  assert.equal(merged[0].progress, 45);
  assert.equal(merged[0].status, 'uploading');
  assert.equal(merged[0].uploadState, 'uploaded');
  assert.equal(merged[0].starred, true);
  const complete = { ...merged[0], status: 'success', progress: 100 };
  const status = normalizeStatus(raw({ scan_status: 'quarantined', updated_at: later }));
  const afterStatus = mergeServerFiles([complete], [status]);
  assert.equal(afterStatus[0].scanStatus, 'quarantined');
  assert.equal(
    mergeServerFiles(afterStatus, [normalizeServerFile(raw())])[0].scanStatus,
    'quarantined',
  );
  assert.equal(
    mergeServerFiles(afterStatus, [normalizeServerFile(raw({ updated_at: later }))])[0].scanStatus,
    'quarantined',
  );
  const otherScope = mergeServerFiles(afterStatus, [
    { ...normalizeServerFile(raw()), scope: 'two' },
  ]);
  assert.equal(otherScope.length, 2);
});

test('full replacement removes missing remote-only records while retaining local activity', () => {
  const remote = normalizeServerFile(raw());
  const local = { id: 'queued', original: {}, status: 'queued', origin: 'local' };
  assert.deepEqual(mergeServerFiles([remote, local], [], { replace: true }), [local]);
  assert.deepEqual(mergeServerFiles([], [normalizeStatus(raw())]), []);
});

test('definitive upload reconciliation clears uncertainty and only a confirmed failure enables retry', () => {
  const unknown = {
    id: 'browser-unknown',
    remoteId: 'file-1',
    original: {},
    status: 'unknown',
    uploadState: 'unknown',
    reconciling: true,
    outcomeUnknown: true,
    retryable: false,
    error: 'Chưa xác nhận metadata',
  };
  const uploaded = mergeServerFiles([unknown], [normalizeStatus(raw())])[0];
  assert.equal(uploaded.reconciling, false);
  assert.equal(uploaded.outcomeUnknown, false);
  assert.equal(uploaded.error, null);
  assert.equal(canRetry(uploaded), false);
  const failed = mergeServerFiles(
    [unknown],
    [normalizeStatus(raw({ upload_state: 'failed', scan_status: 'error' }))],
  )[0];
  assert.equal(failed.reconciling, false);
  assert.equal(failed.outcomeUnknown, false);
  assert.equal(failed.retryable, true);
  assert.equal(canRetry(failed), true);
  const remote = mergeServerFiles(
    [{ ...unknown, original: undefined }],
    [normalizeStatus(raw({ upload_state: 'failed' }))],
  )[0];
  assert.equal(canRetry(remote), false);
  const invalid = mergeServerFiles(
    [{ ...unknown, validationError: true }],
    [normalizeStatus(raw({ upload_state: 'failed' }))],
  )[0];
  assert.equal(canRetry(invalid), false);
  const pending = mergeServerFiles(
    [unknown],
    [normalizeStatus(raw({ upload_state: 'unknown' }))],
  )[0];
  assert.equal(pending.outcomeUnknown, true);
  assert.equal(canRetry(pending), false);
});

test('list API sends encoded cursor and limit, normalizes metadata and propagates HTTP errors', async () => {
  const page = await listFiles('http://localhost:8000/', {
    cursor: 'opaque+token/=',
    limit: 42,
    fetcher: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, '/files');
      assert.equal(parsed.searchParams.get('limit'), '42');
      assert.equal(parsed.searchParams.get('cursor'), 'opaque+token/=');
      return response({ items: [raw()], next_cursor: 'next' });
    },
  });
  assert.equal(page.items[0].name, 'Báo cáo.pdf');
  assert.equal(page.nextCursor, 'next');
  await assert.rejects(listFiles('http://localhost:8000', { limit: 101 }), RangeError);
  for (const data of [{}, { items: [], next_cursor: 3 }]) {
    await assert.rejects(
      listFiles('http://localhost:8000', { fetcher: async () => response(data) }),
      { code: 'invalid_response' },
    );
  }
  await assert.rejects(
    listFiles('http://localhost:8000', {
      fetcher: async () => response({ detail: 'Metadata chưa bật' }, 503),
    }),
    { name: 'ApiError', status: 503 },
  );
});

test('list skips invalid records individually and retains valid files and pagination', async () => {
  const page = await listFiles('http://localhost:8000', {
    fetcher: async () =>
      response({
        items: [
          raw({ id: 'valid-before' }),
          raw({ id: 'bad-size', size_bytes: 0 }),
          null,
          raw({ id: 'bad-storage', storage: 'S3' }),
          raw({ id: 'bad-status', upload_state: 'bogus' }),
          raw({ id: 'valid-after' }),
        ],
        next_cursor: 'next-page',
      }),
  });
  assert.deepEqual(
    page.items.map((item) => item.remoteId),
    ['valid-before', 'valid-after'],
  );
  assert.equal(page.nextCursor, 'next-page');
  assert.equal(page.skippedItems.length, 4);
  assert.deepEqual(page.skippedItems[0], {
    id: 'bad-size',
    name: 'Báo cáo.pdf',
    reason: 'Metadata dung lượng hoặc nơi lưu chưa hợp lệ',
  });
  assert.equal(page.skippedItems[1].id, null);
  assert.equal(page.skippedItems[2].id, 'bad-storage');
  assert.match(page.skippedItems[3].reason, /trạng thái/);
});

test('a page with only invalid records preserves the next cursor instead of claiming an empty library', async () => {
  const page = await listFiles('http://localhost:8000', {
    fetcher: async () =>
      response({
        items: [raw({ size_bytes: '42' })],
        next_cursor: 'still-more',
      }),
  });
  assert.deepEqual(page.items, []);
  assert.equal(page.skippedItems.length, 1);
  assert.equal(page.nextCursor, 'still-more');
});

test('status endpoint verifies file identity, returns only status fields and supports cancellation', async () => {
  const patch = await getFileStatus('http://localhost:8000', 'file-1', {
    fetcher: async (url) => {
      assert.equal(url, 'http://localhost:8000/files/file-1/status');
      return response(raw({ scan_status: 'safe' }));
    },
  });
  assert.equal(patch.scanStatus, 'safe');
  assert.equal(patch.name, undefined);
  assert.equal(patch.id, undefined);
  await assert.rejects(
    getFileStatus('http://localhost:8000', 'file-1', {
      fetcher: async () => response(raw({ id: 'wrong' })),
    }),
    /không khớp/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    listFiles('http://localhost:8000', {
      signal: controller.signal,
      fetcher: () => assert.fail('must not fetch'),
    }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    getFileStatus('http://localhost:8000', 'missing', {
      fetcher: async () => response({ detail: 'Không tìm thấy tệp' }, 404),
    }),
    { status: 404 },
  );
});

test('list request timeout and malformed JSON never become a valid empty library', async () => {
  await assert.rejects(
    listFiles('http://localhost:8000', {
      timeout: 5,
      fetcher: async (_, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    }),
    { code: 'timeout' },
  );
  await assert.rejects(
    listFiles('http://localhost:8000', {
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('HTML');
        },
      }),
    }),
    { code: 'invalid_response' },
  );
});

function xhrResponse({
  status = 503,
  headers = {},
  body = '{"detail":"Metadata chưa xác nhận"}',
  event = 'load',
} = {}) {
  return () => ({
    upload: {},
    status,
    responseText: body,
    open() {},
    getResponseHeader: (name) => headers[name] ?? null,
    send() {
      queueMicrotask(() => this[`on${event}`]());
    },
    abort() {
      this.onabort?.();
    },
  });
}

test('upload failures preserve recovery IDs and uncertain writes cannot be retried silently', async () => {
  const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
  await assert.rejects(
    uploadFile(file, {
      baseUrl: 'http://localhost:8000',
      xhrFactory: xhrResponse({
        headers: { 'X-File-Id': 'remote-1', 'X-File-Key': 'uploads/remote-1' },
      }),
    }),
    (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.remoteId, 'remote-1');
      assert.equal(error.key, 'uploads/remote-1');
      assert.equal(error.reconciling, true);
      assert.equal(error.outcomeUnknown, true);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  await assert.rejects(
    uploadFile(file, {
      baseUrl: 'http://localhost:8000',
      xhrFactory: xhrResponse({ event: 'timeout', status: 0 }),
    }),
    { outcomeUnknown: true, retryable: false },
  );
  await assert.rejects(
    uploadFile(file, {
      baseUrl: 'http://localhost:8000',
      xhrFactory: xhrResponse({ status: 201, body: '<html>bad</html>' }),
    }),
    { outcomeUnknown: true, retryable: false },
  );
  await assert.rejects(
    uploadFile(file, {
      baseUrl: 'http://localhost:8000',
      xhrFactory: xhrResponse({ status: 413 }),
    }),
    { retryable: false, outcomeUnknown: false },
  );
  const parsed = parseUploadResponse(
    JSON.stringify({
      id: 'x',
      key: 'k',
      storage: 's3',
      scan_status: 'scanning',
      upload_state: 'uploaded',
      created_at: at,
    }),
  );
  assert.equal(parsed.uploadState, 'uploaded');
  assert.equal(parsed.scanStatus, 'scanning');
  assert.equal(parsed.createdAt, Date.parse(at));
});
