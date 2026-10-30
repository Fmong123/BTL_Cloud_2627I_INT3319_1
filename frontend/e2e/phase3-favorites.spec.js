import { test, expect, serveBuiltApp } from './support/built-app.js';

const API = 'http://127.0.0.1:8000';
const OTHER = 'http://127.0.0.1:8001';
const stamp = '2026-10-27T04:00:00.000Z';
const starStamp = '2026-10-27T05:00:00.000Z';
const file = (id, patch = {}) => ({
  id, owner_id: 'dev-user', original_name: `${id}.txt`, key: `uploads/dev-user/${id}/${id}.txt`,
  size_bytes: 5, content_type: 'text/plain', storage: 's3', upload_state: 'uploaded',
  scan_status: 'safe', created_at: stamp, updated_at: stamp, findings_count: 0,
  finding_types: [], status_reason: null, scanned_at: stamp, quarantined_at: null,
  starred: false, starred_updated_at: null, ...patch,
});
const health = {
  status: 'ok', storage: 's3', storage_configured: true, max_file_size_bytes: 104857600,
  metadata_mode: 'dynamodb', metadata_configured: true, scan_pipeline_enabled: true,
  owner_mode: 'development', scan_status: 'scanning',
  capabilities: { persistent_favorites: true, file_content: true },
};
const star = (page, id, value = false) => page.getByRole('button', {
  name: `${value ? 'Bỏ đánh dấu' : 'Đánh dấu'} ${id}.txt`, exact: true,
});
const rows = (page) => page.locator('.file-table tbody tr');
const nav = (page) => page.getByRole('navigation', { name: 'Điều hướng chính' });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function seed(surface) {
  await surface.addInitScript(({ API }) => localStorage.setItem('maysec.preferences.v1', JSON.stringify({
    version: 1, mode: 'api', baseUrl: API, theme: 'light', view: 'list', sort: 'newest',
  })), { API });
}
async function json(route, data, status = 200) {
  await route.fulfill({ status, json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
}
async function mock(surface, { origin = API, records = [file('favorite')], capabilities = health.capabilities, list, patch } = {}) {
  const calls = { list: 0, patch: [] };
  await surface.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    } });
    if (url.pathname === '/health') {
      const response = { ...health, capabilities };
      if (capabilities === null) delete response.capabilities;
      return json(route, response);
    }
    if (url.pathname === '/files') {
      calls.list++;
      return list ? list(route, calls) : json(route, { items: records, next_cursor: null });
    }
    const match = url.pathname.match(/^\/files\/([^/]+)\/preferences$/);
    if (match && request.method() === 'PATCH') {
      const id = decodeURIComponent(match[1]);
      const body = request.postDataJSON();
      calls.patch.push({ id, body, origin: url.origin });
      expect(Object.keys(body)).toEqual(['starred']);
      expect(typeof body.starred).toBe('boolean');
      if (patch) return patch(route, id, body, calls);
      const item = records.find((item) => item.id === id);
      item.starred = body.starred;
      item.starred_updated_at = starStamp;
      return json(route, { id, starred: item.starred, starred_updated_at: starStamp });
    }
    return json(route, { detail: 'Unexpected test request' }, 404);
  });
  return calls;
}
async function switchBackend(page, origin) {
  await nav(page).getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await page.getByRole('textbox', { name: 'Địa chỉ máy chủ' }).fill(origin);
  await page.getByRole('button', { name: 'Lưu kết nối', exact: true }).click();
  await nav(page).getByRole('link', { name: /^Tệp của tôi/ }).click();
}

const pageErrors = new WeakMap();
test.beforeEach(({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]));

test('persistent favorites survive reload and a completely new browser context', async ({ page, browser, baseURL }) => {
  const records = [file('favorite')];
  const calls = await mock(page, { records });
  await seed(page);
  await page.goto('/#/files');
  await expect(star(page, 'favorite')).toBeEnabled();
  await star(page, 'favorite').click();
  await expect(star(page, 'favorite', true)).toBeEnabled();
  expect(calls.patch).toEqual([{ id: 'favorite', body: { starred: true }, origin: API }]);
  await page.reload();
  await expect(star(page, 'favorite', true)).toBeEnabled();
  await nav(page).getByRole('link', { name: 'Đã đánh dấu', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  const context = await browser.newContext({ baseURL });
  try {
    await serveBuiltApp(context, baseURL);
    await mock(context, { records });
    await seed(context);
    const fresh = await context.newPage();
    await fresh.goto('/#/files?section=starred');
    await expect(star(fresh, 'favorite', true)).toBeEnabled();
    await star(fresh, 'favorite', true).click();
    await expect.poll(() => records[0].starred).toBe(false);
    await fresh.goto('/#/files');
    await expect(star(fresh, 'favorite')).toBeEnabled();
    expect(records[0].starred).toBe(false);
  } finally {
    await context.close();
  }
});

test('optimistic star stays set while pending and a delayed stale list cannot revert PATCH success', async ({ page }) => {
  const patchHold = deferred(), listHold = deferred();
  const stale = file('stale');
  const calls = await mock(page, {
    records: [stale],
    list: async (route, calls) => {
      if (calls.list > 1) await listHold.promise;
      await json(route, { items: [stale], next_cursor: null }).catch(() => {});
    },
    patch: async (route, id, body) => {
      await patchHold.promise;
      await json(route, { id, starred: body.starred, starred_updated_at: starStamp });
    },
  });
  await seed(page);
  await page.goto('/#/files');
  try {
    await expect(star(page, 'stale')).toBeEnabled();
    await star(page, 'stale').click();
    await expect(star(page, 'stale', true)).toBeDisabled();
    await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
    await expect.poll(() => calls.list).toBe(2);
    patchHold.resolve();
    await expect(star(page, 'stale', true)).toBeEnabled();
    listHold.resolve();
    await expect(page.getByRole('button', { name: 'Làm mới danh sách', exact: true })).toBeEnabled();
    await expect(star(page, 'stale', true)).toBeEnabled();
    expect(calls.patch).toHaveLength(1);
  } finally {
    patchHold.resolve(); listHold.resolve();
  }
});

test('failed preferences roll back the optimistic value and remain retryable', async ({ page }) => {
  const hold = deferred();
  let fail = true;
  const calls = await mock(page, { patch: async (route, id, body) => {
    await hold.promise;
    return fail ? json(route, { detail: 'DynamoDB tạm thời không phản hồi' }, 503)
      : json(route, { id, starred: body.starred, starred_updated_at: starStamp });
  } });
  await seed(page);
  await page.goto('/#/files');
  try {
    await expect(star(page, 'favorite')).toBeEnabled();
    await star(page, 'favorite').click();
    await expect(star(page, 'favorite', true)).toBeDisabled();
    hold.resolve();
    await expect(star(page, 'favorite')).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu 0/1 đánh dấu' })).toBeVisible();
    fail = false;
    await star(page, 'favorite').click();
    await expect(star(page, 'favorite', true)).toBeEnabled();
    expect(calls.patch).toHaveLength(2);
  } finally { hold.resolve(); }
});

test('bulk favorites keep four requests in flight and report partial failure without reverting successes', async ({ page }) => {
  const hold = deferred();
  const records = Array.from({ length: 7 }, (_, index) => file(`bulk-${index}`));
  let active = 0, maximum = 0;
  const calls = await mock(page, { records, patch: async (route, id, body) => {
    active++; maximum = Math.max(maximum, active);
    try {
      await hold.promise;
      if (['bulk-1', 'bulk-5'].includes(id)) return await json(route, { detail: 'Temporary failure' }, 503);
      const item = records.find((item) => item.id === id);
      item.starred = body.starred; item.starred_updated_at = starStamp;
      return await json(route, { id, starred: body.starred, starred_updated_at: starStamp });
    } finally { active--; }
  } });
  await seed(page);
  await page.goto('/#/files');
  try {
    await expect(rows(page)).toHaveCount(7);
    await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
    await page.locator('.selection-toolbar').getByRole('button', { name: 'Đánh dấu', exact: true }).click();
    await expect.poll(() => calls.patch.length).toBe(4);
    expect(active).toBe(4); expect(maximum).toBe(4);
    hold.resolve();
    await expect.poll(() => calls.patch.length).toBe(7);
    await expect(star(page, 'bulk-1')).toBeEnabled();
    await expect(star(page, 'bulk-5')).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Bỏ đánh dấu bulk-/ })).toHaveCount(5);
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu 5/7 đánh dấu' })).toBeVisible();
    expect(maximum).toBeLessThanOrEqual(4);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Bỏ đánh dấu bulk-/ })).toHaveCount(5);
  } finally { hold.resolve(); }
});

for (const [name, capabilities] of [
  ['missing', undefined], ['disabled', { persistent_favorites: false, file_content: true }],
  ['non-boolean', { persistent_favorites: 'true', file_content: true }],
]) {
  test(`favorites stay disabled when capability is ${name}`, async ({ page }) => {
    // Explicit null bypasses the mock helper's default for a missing capability object.
    const calls = await mock(page, { capabilities: capabilities ?? null });
    await seed(page);
    await page.goto('/#/files');
    await expect(star(page, 'favorite')).toBeDisabled();
    await expect(star(page, 'favorite')).toHaveAttribute('title', 'Máy chủ chưa hỗ trợ đánh dấu tệp');
    await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
    await expect(page.locator('.selection-toolbar').getByRole('button', { name: 'Đánh dấu', exact: true })).toBeDisabled();
    expect(calls.patch).toHaveLength(0);
  });
}

test('a late favorite response from the previous backend cannot decorate an identical new backend ID', async ({ page }) => {
  const hold = deferred();
  const oldCalls = await mock(page, { records: [file('same-id')], patch: async (route, id, body) => {
    await hold.promise;
    await json(route, { id, starred: body.starred, starred_updated_at: starStamp }).catch(() => {});
  } });
  const newCalls = await mock(page, { origin: OTHER, records: [file('same-id')] });
  await seed(page);
  await page.goto('/#/files');
  try {
    await expect(star(page, 'same-id')).toBeEnabled();
    await star(page, 'same-id').click();
    await expect.poll(() => oldCalls.patch.length).toBe(1);
    await switchBackend(page, OTHER);
    await expect(star(page, 'same-id')).toBeEnabled();
    hold.resolve();
    await expect(star(page, 'same-id')).toBeEnabled();
    await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
    await expect.poll(() => newCalls.list).toBeGreaterThan(1);
    await expect(star(page, 'same-id')).toBeEnabled();
    expect(newCalls.patch).toHaveLength(0);
    await star(page, 'same-id').click();
    await expect(star(page, 'same-id', true)).toBeEnabled();
    expect(newCalls.patch).toHaveLength(1);
  } finally { hold.resolve(); }
});

test('queued bulk preferences retain their original backend after a connection switch', async ({ page }) => {
  const hold = deferred();
  const oldRecords = Array.from({ length: 6 }, (_, index) => file(`queued-${index}`));
  const oldCalls = await mock(page, { records: oldRecords, patch: async (route, id, body) => {
    await hold.promise;
    return json(route, { id, starred: body.starred, starred_updated_at: starStamp }).catch(() => {});
  } });
  const newCalls = await mock(page, { origin: OTHER, records: oldRecords.map((item) => ({ ...item })) });
  await seed(page);
  await page.goto('/#/files');
  try {
    await expect(rows(page)).toHaveCount(6);
    await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
    await page.locator('.selection-toolbar').getByRole('button', { name: 'Đánh dấu', exact: true }).click();
    await expect.poll(() => oldCalls.patch.length).toBe(4);
    await switchBackend(page, OTHER);
    await expect(rows(page)).toHaveCount(6);
    hold.resolve();
    await expect.poll(() => oldCalls.patch.length).toBe(6);
    await expect(page.getByRole('button', { name: /^Đánh dấu queued-/ })).toHaveCount(6);
    expect(newCalls.patch).toHaveLength(0);
    expect(oldCalls.patch.every((request) => request.origin === API)).toBe(true);
  } finally { hold.resolve(); }
});
