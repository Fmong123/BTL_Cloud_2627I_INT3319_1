import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPreferences,
  savePreferences,
  PREFERENCES_KEY,
  LEGACY_PREFERENCES_KEY,
  uiPreferenceDefaults,
  filterFiles,
  dateBounds,
} from '../src/utils/workspace.js';
import { canReadContent, previewInfo, downloadBlockReason } from '../src/utils/content.js';
import { MB, UPLOAD_LIMIT, formatBytes, validateFile } from '../src/utils/files.js';
import { updateFilePreferences, getFileContent } from '../src/api/client.js';
import { mergeServerFiles } from '../src/utils/processing.js';
import { saveFile } from '../src/utils/saveFile.js';

test('decimal units and the 100 MB upload ceiling apply even when an old server allows more', () => {
  assert.equal(formatBytes(1000), '1 KB');
  assert.equal(formatBytes(1_000_000), '1 MB');
  assert.equal(formatBytes(1_000_000_000), '1 GB');
  assert.equal(UPLOAD_LIMIT, 100_000_000);
  assert.equal(validateFile({ size: UPLOAD_LIMIT }, 104_857_600), null);
  assert.match(validateFile({ size: UPLOAD_LIMIT + 1 }, 104_857_600), /100 MB/);
  assert.match(validateFile({ size: 11 * MB }, 10 * MB), /10 MB/);
});

test('every download entry uses the same status, capability, decimal size and busy checks', () => {
  const file = {
    mode: 'api',
    remoteId: '1',
    uploadState: 'uploaded',
    scanStatus: 'safe',
    size: 100 * MB,
  };
  const options = { contentAvailable: true };
  assert.equal(downloadBlockReason(file, options), '');
  assert.match(downloadBlockReason({ ...file, size: file.size + 1 }, options), /100 MB/);
  assert.notEqual(downloadBlockReason({ ...file, scanStatus: 'quarantined' }, options), '');
  assert.notEqual(downloadBlockReason(file), '');
  assert.notEqual(downloadBlockReason(file, { ...options, downloadingId: 'other' }), '');
  for (const [type, size] of [
    ['image/png', 10 * MB],
    ['application/pdf', 20 * MB],
    ['text/plain', MB],
  ]) {
    assert.ok(previewInfo({ ...file, type, size }).kind);
    assert.equal(previewInfo({ ...file, type, size: size + 1 }).kind, null);
  }
});

test('v1 preferences migrate without losing theme, connection or layout and v2 bounds untrusted UI values', () => {
  const defaults = {
    ...uiPreferenceDefaults,
    theme: 'system',
    view: 'list',
    sort: 'newest',
    mode: 'demo',
    baseUrl: 'http://localhost:8000',
  };
  const store = new Map([
    [
      LEGACY_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        theme: 'dark',
        mode: 'api',
        baseUrl: 'http://localhost:8123',
        sort: 'name',
        view: 'grid',
      }),
    ],
  ]);
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const migrated = readPreferences(defaults, storage);
  assert.equal(migrated.theme, 'dark');
  assert.equal(migrated.view, 'grid');
  assert.equal(migrated.baseUrl, 'http://localhost:8123');
  assert.equal(migrated.density, 'comfortable');
  savePreferences(
    {
      ...migrated,
      density: 'compact',
      nameColumnWidth: 99999,
      sidebarCollapsed: true,
      savedFilters: {
        demo: Array.from({ length: 12 }, (_, i) => ({
          id: `${i}`,
          name: 'View',
          filters: { q: 'báo cáo', page: '4', selection: 'bad', date: '7d' },
        })),
      },
    },
    storage,
  );
  assert.equal(JSON.parse(store.get(PREFERENCES_KEY)).version, 2);
  const restored = readPreferences(defaults, storage);
  assert.equal(restored.density, 'compact');
  assert.equal(restored.nameColumnWidth, 4000);
  assert.equal(restored.sidebarCollapsed, true);
  assert.equal(restored.savedFilters.demo.length, 10);
  assert.deepEqual(restored.savedFilters.demo[0].filters, { q: 'báo cáo', date: '7d' });
});

test('date filters use local calendar days including final-day boundary and invalid custom ranges match nothing', () => {
  const now = +new Date(2026, 9, 27, 12);
  const files = [
    { id: 'start', createdAt: +new Date(2026, 9, 27), name: 'one' },
    { id: 'end', createdAt: +new Date(2026, 9, 27, 23, 59, 59, 999), name: 'two' },
    { id: 'tomorrow', createdAt: +new Date(2026, 9, 28), name: 'three' },
    { id: 'old', createdAt: +new Date(2026, 9, 20), name: 'four' },
  ];
  assert.deepEqual(
    filterFiles(files, { date: 'today', sort: 'oldest' }, now).map((file) => file.id),
    ['start', 'end'],
  );
  assert.deepEqual(
    filterFiles(
      files,
      { date: 'custom', dateFrom: '2026-10-27', dateTo: '2026-10-27', sort: 'oldest' },
      now,
    ).map((file) => file.id),
    ['start', 'end'],
  );
  assert.equal(
    filterFiles(files, { date: 'custom', dateFrom: '2026-10-28', dateTo: '2026-10-01' }, now)
      .length,
    0,
  );
  assert.equal(filterFiles(files, { date: 'custom', dateFrom: '2026-02-30' }, now).length, 0);
  assert.equal(dateBounds('7d', '', '', now)[0], +new Date(2026, 9, 21));
});

test('star revisions merge independently of scan revisions, with status-only patches retaining preferences', () => {
  const file = {
    id: '1',
    remoteId: '1',
    mode: 'api',
    starred: true,
    starredUpdatedAt: 50,
    updatedAt: 100,
    scanStatus: 'scanning',
  };
  const updated = mergeServerFiles(
    [file],
    [{ remoteId: '1', updatedAt: 80, starred: false, starredUpdatedAt: 60, scanStatus: 'safe' }],
  )[0];
  assert.equal(updated.scanStatus, 'scanning');
  assert.equal(updated.starred, false);
  const status = mergeServerFiles(
    [updated],
    [{ remoteId: '1', updatedAt: 110, scanStatus: 'safe' }],
  )[0];
  assert.equal(status.starred, false);
  assert.equal(status.starredUpdatedAt, 60);
  const list = mergeServerFiles(
    [status],
    [{ remoteId: '1', updatedAt: 120, starred: true, starredUpdatedAt: 30 }],
  )[0];
  assert.equal(list.starred, false);
});

test('content eligibility never treats successful upload as a safe scan or enables HTML/SVG preview', () => {
  const file = {
    mode: 'api',
    remoteId: '1',
    uploadState: 'uploaded',
    scanStatus: 'safe',
    type: 'text/plain',
    size: 50,
  };
  assert.equal(canReadContent(file), true);
  assert.equal(previewInfo(file).kind, 'text');
  for (const scanStatus of [
    'not_started',
    'scanning',
    'flagged',
    'quarantined',
    'quarantine_delete_failed',
    'unscanned',
    'error',
  ])
    assert.equal(canReadContent({ ...file, scanStatus }), false);
  for (const type of ['text/html', 'image/svg+xml'])
    assert.equal(previewInfo({ ...file, type }).kind, null);
  assert.equal(previewInfo({ ...file, size: 1024 ** 2 + 1 }).kind, null);
});

test('preference PATCH sends an explicit boolean, validates identity and rejects unsupported or unconfirmed writes', async () => {
  const patch = await updateFilePreferences('http://localhost:8000', 'x', true, {
    fetcher: async (url, options) => {
      assert.equal(url, 'http://localhost:8000/files/x/preferences');
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { starred: true });
      return new Response(
        JSON.stringify({ id: 'x', starred: true, starred_updated_at: '2026-10-27T12:00:00Z' }),
      );
    },
  });
  assert.equal(patch.starred, true);
  await assert.rejects(
    updateFilePreferences('http://localhost:8000', 'x', true, {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            id: 'wrong',
            starred: true,
            starred_updated_at: '2026-10-27T12:00:00Z',
          }),
        ),
    }),
    { code: 'invalid_response' },
  );
  await assert.rejects(
    updateFilePreferences('http://localhost:8000', 'x', true, {
      fetcher: async () =>
        new Response(JSON.stringify({ detail: 'Not supported' }), { status: 405 }),
    }),
    { status: 405 },
  );
});

test('content reads enforce MIME and byte limits, propagate blocked reads and cancellation', async () => {
  const options = {
    mode: 'preview',
    fetcher: async () => new Response('plain', { headers: { 'Content-Type': 'text/plain' } }),
  };
  assert.equal(await (await getFileContent('http://localhost:8000', 'x', options)).text(), 'plain');
  const exactText = await getFileContent('http://localhost:8000', 'x', {
    ...options,
    fetcher: async () =>
      new Response(new Uint8Array(MB), { headers: { 'Content-Type': 'text/plain' } }),
  });
  assert.equal(exactText.size, MB);
  await assert.rejects(
    getFileContent('http://localhost:8000', 'x', {
      ...options,
      fetcher: async () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    }),
    { status: 415 },
  );
  await assert.rejects(
    getFileContent('http://localhost:8000', 'x', {
      ...options,
      fetcher: async () =>
        new Response(new Uint8Array(MB + 1), { headers: { 'Content-Type': 'text/plain' } }),
    }),
    { status: 413 },
  );
  await assert.rejects(
    getFileContent('http://localhost:8000', 'x', {
      ...options,
      fetcher: async () =>
        new Response(JSON.stringify({ detail: 'Chưa An toàn' }), { status: 409 }),
    }),
    { status: 409 },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    getFileContent('http://localhost:8000', 'x', { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

function framedBody(
  data,
  { id = 'x', type = 'application/pdf', size = data.length, end = true } = {},
) {
  const frames = [{ kind: 'metadata', id, content_type: type, size_bytes: size }];
  for (let index = 0; index < data.length; index += 49152)
    frames.push({ kind: 'data', data: data.subarray(index, index + 49152).toString('base64') });
  if (end) frames.push({ kind: 'end' });
  return frames.map((frame) => JSON.stringify(frame) + '\n').join('');
}

test('browser transfer reconstructs binary bytes across split JSON frames without a file response', async () => {
  const data = Buffer.alloc(100_003);
  for (let index = 0; index < data.length; index++) data[index] = index % 256;
  const wire = new TextEncoder().encode(framedBody(data));
  let offset = 0;
  const blob = await getFileContent('http://localhost:8000', 'x', {
    mode: 'preview',
    fetcher: async (url, options) => {
      assert.equal(options.headers.Accept, 'application/x-ndjson');
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (offset === wire.length) return controller.close();
            const next = Math.min(wire.length, offset + 997);
            controller.enqueue(wire.slice(offset, next));
            offset = next;
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    },
  });
  assert.equal(blob.type, 'application/pdf');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), data);
});

test('framed transfers reject wrong identity, unsupported MIME, oversize, truncation and invalid base64', async () => {
  const data = Buffer.from('hello');
  const valid = framedBody(data);
  for (const [body, expected] of [
    [framedBody(data, { id: 'other' }), { code: 'invalid_response' }],
    [framedBody(data, { type: 'text/html' }), { status: 415 }],
    [framedBody(data, { type: 'constructor' }), { status: 415 }],
    [framedBody(data, { type: '__proto__' }), { status: 415 }],
    [framedBody(data, { size: 20 * MB + 1 }), { status: 413 }],
    [framedBody(data, { end: false }), { code: 'invalid_response' }],
    [framedBody(data, { size: 6 }), { code: 'invalid_response' }],
    [framedBody(data, { size: 4 }), { status: 413 }],
    [valid.replace(data.toString('base64'), '!!!!'), { code: 'invalid_response' }],
    [valid + '{"kind":"end"}\n', { code: 'invalid_response' }],
  ]) {
    await assert.rejects(
      getFileContent('http://localhost:8000', 'x', {
        mode: 'preview',
        fetcher: async () =>
          new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
      }),
      expected,
    );
  }
  let cancelled = false;
  await assert.rejects(
    getFileContent('http://localhost:8000', 'x', {
      mode: 'preview',
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(framedBody(data, { id: 'other' })));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        ),
    }),
    { code: 'invalid_response' },
  );
  assert.equal(cancelled, true);
});

test('Save As chooses a destination before fetching and closes only after an exact byte write', async () => {
  const events = [];
  let choose;
  const result = saveFile(
    'Báo:cáo.pdf',
    async () => {
      events.push('load');
      return new Blob(['exact bytes']);
    },
    {
      browser: {
        isSecureContext: true,
        showSaveFilePicker(options) {
          events.push('picker');
          assert.equal(options.suggestedName, 'Báo_cáo.pdf');
          assert.equal(options.startIn, 'downloads');
          return new Promise((resolve) => {
            choose = resolve;
          });
        },
      },
    },
  );
  assert.deepEqual(events, ['picker']);
  choose({
    createWritable: async () => ({
      write: async (blob) => {
        events.push(await blob.text());
      },
      close: async () => {
        events.push('close');
      },
    }),
  });
  assert.equal(await result, 'saved');
  assert.deepEqual(events, ['picker', 'load', 'exact bytes', 'close']);
});

test('cancelling Save As does not fetch; a failed disk write aborts without committing', async () => {
  let loads = 0,
    aborts = 0,
    closes = 0;
  const load = async () => {
    loads++;
    return new Blob(['content']);
  };
  await assert.rejects(
    saveFile('file.txt', load, {
      browser: {
        isSecureContext: true,
        showSaveFilePicker: async () => {
          throw new DOMException('Cancelled', 'AbortError');
        },
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(loads, 0);
  await assert.rejects(
    saveFile('file.txt', load, {
      browser: {
        isSecureContext: true,
        showSaveFilePicker: async () => ({
          createWritable: async () => ({
            write: async () => {
              throw new DOMException('Disk full', 'QuotaExceededError');
            },
            close: async () => {
              closes++;
            },
            abort: async () => {
              aborts++;
            },
          }),
        }),
      },
    }),
    { name: 'QuotaExceededError' },
  );
  assert.equal(loads, 1);
  assert.equal(aborts, 1);
  assert.equal(closes, 0);
});

test('a connection/status cancellation after the picker stops reads and does not commit a file', async () => {
  const controller = new AbortController();
  let closes = 0,
    aborts = 0;
  await assert.rejects(
    saveFile('file.txt', async () => new Blob(['content']), {
      signal: controller.signal,
      browser: {
        isSecureContext: true,
        showSaveFilePicker: async () => ({
          createWritable: async () => ({
            write: async () => {
              controller.abort();
            },
            close: async () => {
              closes++;
            },
            abort: async () => {
              aborts++;
            },
          }),
        }),
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(closes, 0);
  assert.ok(aborts >= 1);
});
