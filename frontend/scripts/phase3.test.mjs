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
import { canReadContent, previewInfo } from '../src/utils/content.js';
import { updateFilePreferences, getFileContent } from '../src/api/client.js';
import { mergeServerFiles } from '../src/utils/processing.js';

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
  assert.equal(restored.nameColumnWidth, 720);
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
        new Response(new Uint8Array(1024 ** 2 + 1), { headers: { 'Content-Type': 'text/plain' } }),
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
