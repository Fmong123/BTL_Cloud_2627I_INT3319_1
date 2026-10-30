import { test, expect } from './support/built-app.js';

const API = 'http://127.0.0.1:8000';
const stamp = '2026-10-27T03:00:00.000Z';
const record = (id, patch = {}) => ({
  id,
  owner_id: 'dev-user',
  original_name: `${id}.txt`,
  key: `uploads/dev-user/${id}/${id}.txt`,
  size_bytes: 42,
  content_type: 'text/plain',
  storage: 's3',
  upload_state: 'uploaded',
  scan_status: 'safe',
  created_at: stamp,
  updated_at: stamp,
  findings_count: 0,
  finding_types: [],
  status_reason: null,
  scanned_at: stamp,
  quarantined_at: null,
  ...patch,
});
const health = {
  status: 'ok',
  storage: 's3',
  storage_configured: true,
  max_file_size_bytes: 104857600,
  metadata_mode: 'dynamodb',
  metadata_configured: true,
  scan_pipeline_enabled: true,
  owner_mode: 'development',
  scan_status: 'scanning',
  capabilities: { persistent_favorites: true, file_content: false },
};
const sample = (name) => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('MâySec integration test'),
});
const rows = (page) => page.locator('.file-table tbody tr');
const row = (page, name) =>
  rows(page).filter({ has: page.getByRole('button', { name, exact: true }) });
const nav = (page) => page.getByRole('navigation', { name: 'Điều hướng chính' });
const bell = (page) => page.getByRole('button', { name: /^Thông báo(?:,|$)/ });

async function useApi(page, baseUrl = API) {
  await page.addInitScript(
    ({ baseUrl }) => {
      localStorage.setItem(
        'maysec.preferences.v1',
        JSON.stringify({
          version: 1,
          mode: 'api',
          baseUrl,
          theme: 'system',
          view: 'list',
          sort: 'newest',
        }),
      );
    },
    { baseUrl },
  );
}

async function json(route, data, status = 200, headers = {}) {
  await route.fulfill({
    status,
    json: data,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-File-Id, X-File-Key',
      ...headers,
    },
  });
}

async function apiRoutes(
  page,
  { origin = API, files = () => [], healthPatch = {}, list, status, upload } = {},
) {
  const calls = { health: 0, list: [], status: [], upload: [] };
  const favorites = new Map();
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    if (url.pathname === '/health') {
      calls.health++;
      return json(route, {
        ...health,
        ...(typeof healthPatch === 'function' ? healthPatch() : healthPatch),
      });
    }
    if (url.pathname === '/files') {
      calls.list.push(url.searchParams.get('cursor'));
      if (list) return list(route, url, calls);
      const all = files().map((file) => ({ ...file, ...favorites.get(file.id) }));
      const start = Number(url.searchParams.get('cursor') || 0);
      const limit = Number(url.searchParams.get('limit') || 100);
      const end = Math.min(all.length, start + limit);
      return json(route, {
        items: all.slice(start, end),
        next_cursor: end < all.length ? String(end) : null,
      });
    }
    const prefMatch = url.pathname.match(/^\/files\/([^/]+)\/preferences$/);
    if (prefMatch && request.method() === 'PATCH') {
      const id = decodeURIComponent(prefMatch[1]);
      if (!files().some((file) => file.id === id))
        return json(route, { detail: 'Không tìm thấy tệp' }, 404);
      const patch = {
        starred: request.postDataJSON().starred,
        starred_updated_at: new Date().toISOString(),
      };
      favorites.set(id, patch);
      return json(route, { id, ...patch });
    }
    const match = url.pathname.match(/^\/files\/([^/]+)\/status$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      calls.status.push(id);
      if (status) return status(route, id, calls);
      const item = files().find((file) => file.id === id);
      return item ? json(route, item) : json(route, { detail: 'Không tìm thấy tệp' }, 404);
    }
    if (url.pathname === '/upload') {
      calls.upload.push(request.postDataBuffer());
      if (upload) return upload(route, calls);
      return json(route, { detail: 'Unexpected upload in test' }, 500);
    }
    return json(route, { detail: 'Không tìm thấy route' }, 404);
  });
  return calls;
}

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test('sidebar shortcuts filter real records, keep one active link and reset old filters', async ({
  page,
}, testInfo) => {
  const recent = new Date().toISOString();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const files = [
    record('recent', { created_at: recent, updated_at: recent }),
    record('old', { created_at: old, updated_at: old }),
    record('isolated', {
      created_at: old,
      updated_at: old,
      scan_status: 'quarantined',
      quarantined_at: old,
    }),
  ];
  await apiRoutes(page, { files: () => files });
  await useApi(page);
  await page.goto('/#/files?q=old');
  await page.getByRole('button', { name: 'Đánh dấu old.txt', exact: true }).click();
  await nav(page).getByRole('link', { name: 'Gần đây', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'recent.txt')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gần đây');
  await nav(page).getByRole('link', { name: 'Đã đánh dấu', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'old.txt')).toBeVisible();
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav(page).locator('[aria-current="page"]')).toHaveText('Đã đánh dấu1');
  await nav(page).getByRole('link', { name: 'Cách ly', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'isolated.txt')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cách ly');
  await page.reload();
  await expect(row(page, 'isolated.txt')).toBeVisible();
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
  await nav(page).getByRole('link', { name: 'Tệp của tôi', exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true })).toHaveValue('');
  await expect(page.getByText('Không gian cá nhân', { exact: true })).toHaveCount(0);
  await expect(page.locator('.session-note')).toHaveCount(0);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(nav(page).getByRole('link', { name: 'Cài đặt', exact: true })).toBeInViewport();
      await expect(
        nav(page).getByRole('link', { name: 'Hướng dẫn', exact: true }),
      ).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`sidebar-${theme}-${viewport.width}.png`),
      });
    }
  }
});

test('API library reads all DynamoDB metadata pages and survives browser reload without duplicate rows', async ({
  page,
}) => {
  const files = Array.from({ length: 103 }, (_, index) =>
    record(`file-${String(index).padStart(3, '0')}`),
  );
  const calls = await apiRoutes(page, { files: () => files });
  await useApi(page);
  await page.goto('/#/files');
  await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText('103 tệp');
  expect(calls.list).toContain('100');
  await expect(rows(page)).toHaveCount(50);
  await page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true }).fill('file-102');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'file-102.txt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử lại file-102.txt', exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(row(page, 'file-102.txt')).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Lưu trữ thật', exact: true })).toBeVisible();
});

test('invalid file metadata is skipped across pages with a visible warning and valid records still load', async ({
  page,
}) => {
  const calls = await apiRoutes(page, {
    list: (route, url) => {
      const cursor = url.searchParams.get('cursor');
      if (!cursor)
        return json(route, {
          items: [record('bad-size', { size_bytes: 0 })],
          next_cursor: 'second',
        });
      if (cursor === 'second')
        return json(route, {
          items: [record('valid-one'), record('bad-storage', { storage: 'S3' })],
          next_cursor: 'third',
        });
      return json(route, { items: [record('valid-two')], next_cursor: null });
    },
  });
  await useApi(page);
  await page.goto('/#/files');
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'valid-one.txt')).toBeVisible();
  await expect(row(page, 'valid-two.txt')).toBeVisible();
  expect(calls.list).toEqual([null, 'second', 'third']);
  const warning = page.getByRole('status', { name: 'Tệp bị bỏ qua' });
  await expect(warning).toContainText('Đã bỏ qua 2 bản ghi');
  await warning.getByText('Xem chi tiết lỗi', { exact: true }).click();
  await expect(warning).toContainText('bad-size.txt');
  await expect(warning).toContainText('bad-storage.txt');
  await expect(warning).toContainText('Metadata dung lượng hoặc nơi lưu chưa hợp lệ');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/skipped-metadata.png', fullPage: true });
  await page.goto('/#/');
  await expect(page.getByRole('status', { name: 'Tệp bị bỏ qua' })).toContainText(
    'Đã bỏ qua 2 bản ghi',
  );
});

test('an all-invalid library is not labelled empty and refresh removes warnings after metadata is fixed', async ({
  page,
}) => {
  let files = [record('repair-me', { size_bytes: 0 })];
  await apiRoutes(page, { files: () => files });
  await useApi(page);
  await page.goto('/#/files');
  const warning = page.getByRole('status', { name: 'Tệp bị bỏ qua' });
  await expect(warning).toContainText('Đã bỏ qua 1 bản ghi');
  await expect(page.getByRole('heading', { name: 'Chưa có tệp hợp lệ để hiển thị' })).toBeVisible();
  await expect(page.getByText('Thư viện máy chủ chưa có tệp.', { exact: false })).toHaveCount(0);
  files = [record('repair-me')];
  await warning.getByRole('button', { name: 'Thử đồng bộ lại' }).click();
  await expect(row(page, 'repair-me.txt')).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test('scan and quarantine update independently of upload, move tabs and notify once per meaningful transition', async ({
  page,
}) => {
  let file = record('scan-file', { scan_status: 'scanning', scanned_at: null });
  const calls = await apiRoutes(page, { files: () => [file] });
  await useApi(page);
  await page.goto('/#/files');
  await expect(row(page, 'scan-file.txt')).toBeVisible();
  await expect(row(page, 'scan-file.txt').locator('.status-badge').first()).toContainText(/Đã lưu/);
  await expect(row(page, 'scan-file.txt').locator('.scan-badge')).toContainText('Đang quét');
  await bell(page).click();
  const notifications = page.getByRole('region', { name: 'Thông báo', exact: true });
  await expect(notifications).toContainText('Chưa có thông báo mới');
  await page.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();

  file = record('scan-file', {
    scan_status: 'flagged',
    findings_count: 2,
    finding_types: ['CCCD'],
    updated_at: '2026-10-27T03:00:10.000Z',
  });
  await expect(row(page, 'scan-file.txt').locator('.scan-badge')).toContainText(
    'Chờ cách ly',
    { timeout: 12000 },
  );
  await page.getByRole('tab', { name: /^Khu thường/ }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('tab', { name: /^Cần xử lý \/ Cách ly/ }).click();
  await expect(row(page, 'scan-file.txt')).toBeVisible();
  await bell(page).click();
  await expect(notifications.locator('.notification-event')).toHaveCount(1);
  const before = calls.status.length;
  await expect.poll(() => calls.status.length, { timeout: 10000 }).toBeGreaterThan(before);
  await expect(notifications.locator('.notification-event')).toHaveCount(1);
  await page.getByRole('button', { name: 'Đóng thông báo', exact: true }).click();

  file = record('scan-file', {
    scan_status: 'quarantined',
    findings_count: 2,
    finding_types: ['CCCD'],
    updated_at: '2026-10-27T03:00:20.000Z',
    quarantined_at: '2026-10-27T03:00:20.000Z',
  });
  await expect(row(page, 'scan-file.txt').locator('.scan-badge')).toContainText('Đã cách ly', {
    timeout: 12000,
  });
  await expect(row(page, 'scan-file.txt').locator('.status-badge').first()).toContainText(/Đã lưu/);
  await bell(page).click();
  await expect(notifications.locator('.notification-event')).toHaveCount(2);
  await notifications.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' }).click();
  await expect(notifications).toContainText('0 chưa đọc');
  await notifications.locator('.notification-event-title').first().click();
  await expect(page.getByRole('region', { name: 'Thông tin tệp', exact: true })).toContainText(
    'scan-file.txt',
  );
});

test('five uploads run concurrently, later files wait and all results reconcile without duplicates', async ({
  page,
}) => {
  let active = 0,
    maximum = 0,
    releaseFirst;
  const firstWave = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const stored = [];
  const calls = await apiRoutes(page, {
    files: () => stored,
    upload: async (route, history) => {
      const index = history.upload.length;
      active++;
      maximum = Math.max(maximum, active);
      try {
        await firstWave;
        const name =
          route
            .request()
            .postDataBuffer()
            .toString()
            .match(/filename="([^"]+)"/)?.[1] || `parallel-${index}.txt`;
        const file = record(`upload-${index}`, { original_name: name });
        stored.push(file);
        await json(route, file, 201);
      } finally {
        active--;
      }
    },
  });
  await useApi(page);
  await page.goto('/#/files');
  await page
    .locator('input[type="file"]')
    .setInputFiles(Array.from({ length: 12 }, (_, index) => sample(`parallel-${index}.txt`)));
  try {
    await expect.poll(() => calls.upload.length).toBe(5);
    expect(active).toBe(5);
    expect(maximum).toBe(5);
  } finally {
    releaseFirst();
  }
  await expect.poll(() => calls.upload.length).toBe(12);
  await expect(rows(page)).toHaveCount(12);
  await expect(page.getByRole('region', { name: 'Tiến trình tải lên' })).toHaveCount(0);
  expect(maximum).toBeLessThanOrEqual(5);
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(rows(page)).toHaveCount(12);
});

test('metadata failure after storage uses recovery ID and checks status without uploading twice', async ({
  page,
}) => {
  let recovered = false;
  const file = record('recovered-file', { original_name: 'recovery.txt' });
  const calls = await apiRoutes(page, {
    files: () => (recovered ? [file] : []),
    upload: async (route) => {
      recovered = true;
      await json(route, { detail: 'Nội dung tệp đã được lưu nhưng metadata chưa xác nhận' }, 503, {
        'X-File-Id': file.id,
        'X-File-Key': file.key,
      });
    },
    status: async (route, id) => json(route, record(id, { original_name: 'recovery.txt' })),
  });
  await useApi(page);
  await page.goto('/#/files');
  await page.locator('input[type="file"]').setInputFiles(sample('recovery.txt'));
  await expect.poll(() => calls.status.includes('recovered-file'), { timeout: 12000 }).toBe(true);
  await expect(row(page, 'recovery.txt').locator('.status-badge').first()).toContainText(
    /Đã lưu|API đã xác nhận/,
  );
  expect(calls.upload.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Thử lại recovery.txt', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(calls.upload.length).toBe(1);
});

test('disabled metadata keeps real-upload mode and explicitly labels a session-only list', async ({
  page,
}) => {
  const calls = await apiRoutes(page, {
    healthPatch: {
      metadata_mode: 'disabled',
      metadata_configured: false,
      scan_pipeline_enabled: false,
      scan_status: 'not_started',
      storage: 'local',
    },
    list: (route) => json(route, { detail: 'Chức năng metadata chưa được bật' }, 503),
  });
  await useApi(page);
  await page.goto('/#/files');
  await expect(page.getByRole('button', { name: 'Lưu trữ thật', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText(
    /metadata|phiên hiện tại/,
  );
  expect(calls.upload.length).toBe(0);
  await expect(page.locator('tbody .status-badge.demo')).toHaveCount(0);
});

test('switching backend aborts stale list responses and never mixes two server libraries', async ({
  page,
}) => {
  let releaseOld;
  const oldResponse = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const oldCalls = await apiRoutes(page, {
    list: async (route) => {
      await oldResponse;
      await json(route, { items: [record('old-server')], next_cursor: null }).catch(() => {});
    },
  });
  const other = 'http://127.0.0.1:8001';
  await apiRoutes(page, { origin: other, files: () => [record('new-server')] });
  await useApi(page);
  await page.goto('/#/files');
  await expect.poll(() => oldCalls.list.length).toBeGreaterThan(0);
  await nav(page).getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await page.getByRole('textbox', { name: 'Địa chỉ máy chủ' }).fill(other);
  await page.getByRole('button', { name: 'Lưu kết nối', exact: true }).click();
  releaseOld();
  await nav(page)
    .getByRole('link', { name: /^Tệp của tôi/ })
    .click();
  await expect(row(page, 'new-server.txt')).toBeVisible();
  await expect(row(page, 'old-server.txt')).toHaveCount(0);
});

test('status scheduler stays within four in-flight requests including manual rechecks', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-27T04:00:00Z') });
  const files = Array.from({ length: 7 }, (_, index) =>
    record(`pending-${index}`, { scan_status: 'scanning', scanned_at: null }),
  );
  let active = 0,
    maximum = 0,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const activeIds = new Map();
  const requests = new Map();
  function finish(request) {
    const id = requests.get(request);
    if (!requests.delete(request)) return;
    if (activeIds.get(id) === request) activeIds.delete(id);
    active--;
  }
  page.on('requestfailed', finish);
  const calls = await apiRoutes(page, {
    files: () => files,
    status: async (route, id) => {
      const request = route.request();
      const prior = activeIds.get(id);
      if (prior?.failure()) finish(prior);
      expect(activeIds.has(id)).toBe(false);
      activeIds.set(id, request);
      requests.set(request, id);
      active++;
      maximum = Math.max(maximum, active);
      try {
        await held;
        await json(
          route,
          files.find((item) => item.id === id),
        );
      } finally {
        finish(request);
      }
    },
  });
  await useApi(page);
  await page.goto('/#/files');
  try {
    await expect(rows(page)).toHaveCount(7);
    await page.clock.fastForward(1100);
    await expect.poll(() => calls.status.length).toBe(4);
    await page.getByRole('button', { name: 'Thông tin pending-6.txt', exact: true }).click();
    await page.getByRole('button', { name: 'Cập nhật trạng thái', exact: true }).click();
    await page.clock.fastForward(1200);
    expect(active).toBe(4);
    expect(calls.status.length).toBe(4);
    expect(maximum).toBe(4);
  } finally {
    release();
  }
  await expect.poll(() => active).toBe(0);
  await page.clock.fastForward(1100);
  await expect.poll(() => new Set(calls.status).size).toBe(7);
  expect(maximum).toBeLessThanOrEqual(4);
});

test('a metadata-disabled health result clears the retry schedule after an initial 503', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-27T04:00:00Z') });
  let disabled = false;
  const calls = await apiRoutes(page, {
    healthPatch: () =>
      disabled
        ? { metadata_mode: 'disabled', metadata_configured: false, scan_pipeline_enabled: false }
        : {},
    list: (route) => json(route, { detail: 'Metadata đang khởi động' }, 503),
  });
  await useApi(page);
  await page.goto('/#/files');
  await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText(
    'Metadata đang khởi động',
  );
  expect(calls.list.length).toBe(1);
  const initialHealthCalls = calls.health;
  disabled = true;
  await page.clock.fastForward(6000);
  await expect.poll(() => calls.health).toBeGreaterThan(initialHealthCalls);
  await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText(
    /metadata.*tắt|metadata.*bật|phiên hiện tại/i,
  );
  const disabledHealthCalls = calls.health;
  await page.clock.fastForward(20000);
  expect(calls.health).toBe(disabledHealthCalls);
  expect(calls.list.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Lưu trữ thật', exact: true })).toBeVisible();
});

test('one sync outage generates one notification even when background retries fail repeatedly', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-27T04:00:00Z') });
  let failed = false;
  const calls = await apiRoutes(page, {
    list: (route) =>
      failed
        ? json(route, { detail: 'DynamoDB tạm ngừng phản hồi' }, 503)
        : json(route, { items: [record('existing-safe')], next_cursor: null }),
  });
  await useApi(page);
  await page.goto('/#/files');
  await expect(row(page, 'existing-safe.txt')).toBeVisible();
  failed = true;
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText(
    'DynamoDB tạm ngừng phản hồi',
  );
  await bell(page).click();
  const panel = page.getByRole('region', { name: 'Thông báo', exact: true });
  await expect(panel.locator('.notification-event')).toHaveCount(1);
  await page.clock.fastForward(6000);
  await expect.poll(() => calls.list.length).toBeGreaterThanOrEqual(3);
  await expect(panel.locator('.notification-event')).toHaveCount(1);
  await page.clock.fastForward(11000);
  await expect.poll(() => calls.list.length).toBeGreaterThanOrEqual(4);
  await expect(panel.locator('.notification-event')).toHaveCount(1);
  await expect(row(page, 'existing-safe.txt')).toBeVisible();
});

test('new uploads can notify completed scan while the initial library page is still loading', async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const uploaded = record('early-upload', {
    original_name: 'early-upload.txt',
    scan_status: 'scanning',
    scanned_at: null,
  });
  const calls = await apiRoutes(page, {
    list: async (route) => {
      await pending;
      await json(route, { items: [], next_cursor: null }).catch(() => {});
    },
    upload: (route) => json(route, uploaded, 201),
    status: (route, id) =>
      json(
        route,
        record(id, { original_name: 'early-upload.txt', updated_at: '2026-10-27T03:00:10Z' }),
      ),
  });
  await useApi(page);
  await page.goto('/#/files');
  try {
    await expect.poll(() => calls.list.length).toBe(1);
    await page.locator('input[type="file"]').setInputFiles(sample('early-upload.txt'));
    await expect(row(page, 'early-upload.txt').locator('.scan-badge')).toContainText('Không phát hiện');
    await bell(page).click();
    const panel = page.getByRole('region', { name: 'Thông báo', exact: true });
    await expect(
      panel.locator('.notification-event-title').filter({ hasText: 'Không phát hiện' }),
    ).toHaveCount(1);
    expect(calls.upload.length).toBe(1);
  } finally {
    release();
  }
});

test('hidden and offline tabs pause polling; ten-minute tracking cap can be manually restarted', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-27T04:00:00Z') });
  const file = record('long-scan', { scan_status: 'scanning', scanned_at: null });
  const calls = await apiRoutes(page, { files: () => [file] });
  await useApi(page);
  await page.goto('/#/files');
  await expect(row(page, 'long-scan.txt')).toBeVisible();
  await page.clock.fastForward(1100);
  await expect.poll(() => calls.status.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Thông tin long-scan.txt', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'Thông tin tệp', exact: true });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenStatus = calls.status.length,
    hiddenLists = calls.list.length;
  await page.clock.fastForward(20000);
  expect(calls.status.length).toBe(hiddenStatus);
  expect(calls.list.length).toBe(hiddenLists);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => calls.status.length).toBeGreaterThan(hiddenStatus);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });
  const offlineStatus = calls.status.length,
    offlineLists = calls.list.length;
  await page.clock.fastForward(20000);
  expect(calls.status.length).toBe(offlineStatus);
  expect(calls.list.length).toBe(offlineLists);
  await page.evaluate(() => {
    delete navigator.onLine;
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => calls.status.length).toBeGreaterThan(offlineStatus);
  await page.waitForTimeout(50);
  await page.clock.fastForward(601000);
  await expect(drawer).toContainText('Chưa nhận kết quả mới trong thời gian theo dõi');
  const stoppedAt = calls.status.length;
  await page.clock.fastForward(20000);
  expect(calls.status.length).toBe(stoppedAt);
  await drawer.getByRole('button', { name: 'Cập nhật trạng thái', exact: true }).click();
  await expect.poll(() => calls.status.length).toBeGreaterThan(stoppedAt);
  await expect(drawer).not.toContainText('Chưa nhận kết quả mới trong thời gian theo dõi');
});

for (const failure of ['page-error', 'cursor-loop']) {
  test(`incomplete list (${failure}) keeps loaded records and displays sync failure`, async ({
    page,
  }) => {
    const calls = await apiRoutes(page, {
      list: async (route, url) => {
        if (!url.searchParams.has('cursor'))
          return json(route, { items: [record('partial-file')], next_cursor: 'again' });
        if (failure === 'page-error')
          return json(route, { detail: 'DynamoDB tạm thời không phản hồi' }, 503);
        return json(route, { items: [record('partial-file')], next_cursor: 'again' });
      },
    });
    await useApi(page);
    await page.goto('/#/files');
    await expect(row(page, 'partial-file.txt')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText(
      /lỗi|chưa|không|cũ/i,
    );
    await expect(
      page.getByRole('button', { name: 'Làm mới danh sách', exact: true }),
    ).toBeEnabled();
    expect(calls.list.length).toBeLessThanOrEqual(3);
    await expect(rows(page)).toHaveCount(1);
  });
}
