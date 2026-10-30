import { test, expect } from './support/built-app.js';

const API = 'http://127.0.0.1:18009';
const stamp = '2026-10-27T03:00:00.000Z';
const metadata = (id, patch = {}) => ({
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
async function fixture(
  page,
  { files = [metadata('report')], capability = true, content, upload } = {},
) {
  const calls = [];
  await page.addInitScript(
    ({ API }) => {
      if (!localStorage.getItem('maysec.preferences.v2'))
        localStorage.setItem(
          'maysec.preferences.v2',
          JSON.stringify({
            version: 2,
            mode: 'api',
            baseUrl: API,
            theme: 'dark',
            view: 'list',
            sort: 'newest',
          }),
        );
    },
    { API },
  );
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (url.pathname === '/upload' && upload) return upload(route);
    if (url.pathname === '/health')
      return route.fulfill({
        json: {
          status: 'ok',
          storage: 's3',
          storage_configured: true,
          max_file_size_bytes: 104857600,
          metadata_mode: 'dynamodb',
          metadata_configured: true,
          scan_pipeline_enabled: true,
          capabilities: { file_content: capability },
        },
        headers,
      });
    if (url.pathname === '/files')
      return route.fulfill({ json: { items: files, next_cursor: null }, headers });
    if (url.pathname.endsWith('/content')) {
      calls.push(url);
      if (content) return content(route, url);
      return route.fulfill({
        body: '<script>window.__unsafe = true</script>\nXin chào MâySec',
        contentType: 'text/plain; charset=utf-8',
        headers,
      });
    }
    if (url.pathname.endsWith('/status')) {
      const file = files.find((item) => url.pathname.includes(`/${item.id}/`));
      return route.fulfill({ json: file, headers });
    }
    return route.fulfill({ status: 404, json: { detail: 'Not found' }, headers });
  });
  return calls;
}

test('safe text opens escaped, downloads, restores focus and collapsed navigation persists', async ({
  page,
}, testInfo) => {
  const calls = await fixture(page);
  // Exercise the ordinary browser-download fallback when Save As is unavailable.
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined;
  });
  await page.goto('/');
  await expect(page).toHaveURL(/#\/files$/);
  const collapse = page.getByRole('button', { name: 'Thu gọn thanh điều hướng' });
  await collapse.click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '64px');
  await expect(
    page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Tệp của tôi', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mở rộng thanh điều hướng' })).toBeVisible();
  const name = page.getByRole('button', { name: 'report.txt', exact: true });
  await name.click();
  const dialog = page.getByRole('dialog', { name: 'report.txt', exact: true });
  await expect(dialog.getByLabel('Nội dung report.txt')).toContainText(
    '<script>window.__unsafe = true</script>',
  );
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
  expect(calls[0].searchParams.get('mode')).toBe('preview');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Tải xuống', exact: true }).click();
  await downloaded;
  expect(calls.some((url) => url.searchParams.get('mode') === 'download')).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('text-viewer-dark-collapsed.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(name).toBeFocused();
});

function browserFrames(id, type, data) {
  return [
    { kind: 'metadata', id, content_type: type, size_bytes: data.length },
    { kind: 'data', data: data.toString('base64') },
    { kind: 'end' },
  ]
    .map((frame) => JSON.stringify(frame) + '\n')
    .join('');
}

async function nativeSaveStub(page, { cancelFirst = false, delayed = false } = {}) {
  await page.addInitScript(
    ({ cancelFirst, delayed }) => {
      window.__save = { picks: [], writes: [], closed: 0, aborted: 0 };
      window.showSaveFilePicker = async (options) => {
        window.__save.picks.push({ ...options, active: navigator.userActivation.isActive });
        if (cancelFirst && window.__save.picks.length === 1)
          throw new DOMException('Cancelled by user', 'AbortError');
        const handle = {
          createWritable: async () => ({
            write: async (blob) => {
              window.__save.writes.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
            },
            close: async () => {
              window.__save.closed++;
            },
            abort: async () => {
              window.__save.aborted++;
            },
          }),
        };
        return delayed
          ? new Promise((resolve) => {
              window.__chooseSave = () => resolve(handle);
            })
          : handle;
      };
    },
    { cancelFirst, delayed },
  );
}

async function downloadFromMenu(page, name) {
  await page.getByRole('button', { name: `Thao tác ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tải xuống', exact: true }).click();
}

test('Save As runs in the click gesture before content fetch and writes exact bytes to the selected target', async ({
  page,
}) => {
  const data = Buffer.from([0, 255, 13, 10, 128, 42]);
  const calls = await fixture(page, {
    files: [
      metadata('binary', {
        original_name: 'Báo cáo.pdf',
        content_type: 'application/pdf',
        size_bytes: data.length,
      }),
    ],
    content: (route, url) => {
      expect(route.request().headers().accept).toBe('application/x-ndjson');
      expect(url.searchParams.get('mode')).toBe('download');
      return route.fulfill({
        body: browserFrames('binary', 'application/octet-stream', data),
        contentType: 'application/x-ndjson',
      });
    },
  });
  await nativeSaveStub(page, { delayed: true });
  let browserDownloads = 0;
  page.on('download', () => {
    browserDownloads++;
  });
  await page.goto('/#/files');
  await downloadFromMenu(page, 'Báo cáo.pdf');
  const picks = await page.evaluate(() => window.__save.picks);
  expect(picks).toEqual([
    { id: 'maysec-downloads', startIn: 'downloads', suggestedName: 'Báo cáo.pdf', active: true },
  ]);
  expect(calls).toHaveLength(0);
  await page.evaluate(() => window.__chooseSave());
  await expect.poll(() => page.evaluate(() => window.__save.closed)).toBe(1);
  expect(await page.evaluate(() => window.__save.writes)).toEqual([Array.from(data)]);
  await expect(page.getByText('Đã lưu tệp vào thư mục đã chọn', { exact: true })).toBeVisible();
  expect(browserDownloads).toBe(0);
});

test('cancelling Save As does not fetch and allows a later successful save', async ({ page }) => {
  const calls = await fixture(page);
  await nativeSaveStub(page, { cancelFirst: true });
  await page.goto('/#/files');
  await downloadFromMenu(page, 'report.txt');
  await expect(page.getByText('Đã hủy tải xuống', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
  await downloadFromMenu(page, 'report.txt');
  await expect.poll(() => page.evaluate(() => window.__save.closed)).toBe(1);
  expect(calls).toHaveLength(1);
});

test('framed image and PDF previews stay inside the viewer without invoking Save As or a download', async ({
  page,
}) => {
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6sAAAAASUVORK5CYII=',
    'base64',
  );
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  );
  await fixture(page, {
    files: [
      metadata('photo', {
        original_name: 'photo.png',
        content_type: 'image/png',
        size_bytes: image.length,
      }),
      metadata('pdf', {
        original_name: 'report.pdf',
        content_type: 'application/pdf',
        size_bytes: pdf.length,
      }),
    ],
    content: (route, url) => {
      expect(url.searchParams.get('mode')).toBe('preview');
      expect(route.request().headers().accept).toBe('application/x-ndjson');
      const isImage = url.pathname.includes('/photo/');
      return route.fulfill({
        body: browserFrames(
          isImage ? 'photo' : 'pdf',
          isImage ? 'image/png' : 'application/pdf',
          isImage ? image : pdf,
        ),
        contentType: 'application/x-ndjson',
      });
    },
  });
  await nativeSaveStub(page);
  let browserDownloads = 0;
  page.on('download', () => {
    browserDownloads++;
  });
  await page.goto('/#/files');
  await page.getByRole('button', { name: 'photo.png', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Xem trước photo.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'report.pdf', exact: true }).click();
  await expect(page.locator('iframe[title="Xem trước PDF report.pdf"]')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  expect(await page.evaluate(() => window.__save.picks)).toHaveLength(0);
  expect(browserDownloads).toBe(0);
});

test('capability missing and quarantined files expose metadata without content requests', async ({
  page,
}) => {
  const calls = await fixture(page, {
    capability: false,
    files: [
      metadata('blocked', {
        scan_status: 'quarantined',
        findings_count: 1,
        finding_types: ['EMAIL_ADDRESS'],
        quarantined_at: stamp,
      }),
    ],
  });
  await page.goto('/#/files');
  await page.getByRole('button', { name: 'blocked.txt', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Thông tin tệp' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tải xuống', exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('content failure stays in viewer with retry; image object URL is revoked on close', async ({
  page,
}) => {
  let shouldFail = true;
  await fixture(page, {
    files: [metadata('picture', { original_name: 'picture.png', content_type: 'image/png' })],
    content: async (route) => {
      if (shouldFail)
        return route.fulfill({
          status: 503,
          json: { detail: 'Tạm thời chưa đọc được nội dung' },
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      return route.fulfill({
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
          'base64',
        ),
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    },
  });
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL;
    window.__revoked = [];
    URL.revokeObjectURL = (url) => {
      window.__revoked.push(url);
      original.call(URL, url);
    };
  });
  await page.goto('/#/files');
  await page.getByRole('button', { name: 'Thao tác picture.png', exact: true }).press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Xem trước', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'picture.png', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'picture.png', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Tạm thời');
  shouldFail = false;
  await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(dialog.getByRole('img', { name: 'Xem trước picture.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__revoked.length)).toBe(1);
});

test('closing aborts pending content and stale response cannot reopen viewer', async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await fixture(page, {
    content: async (route) => {
      await pending;
      await route
        .fulfill({
          body: 'late text',
          contentType: 'text/plain',
          headers: { 'Access-Control-Allow-Origin': '*' },
        })
        .catch(() => {});
    },
  });
  await page.goto('/#/files');
  await page.getByRole('button', { name: 'Thao tác report.txt', exact: true }).press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Xem trước', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Xem trước', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Đang mở nội dung');
  const aborted = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().includes('/content?mode=preview'),
  });
  await page.keyboard.press('Escape');
  await aborted;
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('late text', { exact: true })).toHaveCount(0);
});

test('PDF has native blob viewer and safe status loss closes content for metadata', async ({
  page,
}, testInfo) => {
  const files = [
    metadata('document', { original_name: 'document.pdf', content_type: 'application/pdf' }),
  ];
  await fixture(page, {
    files,
    content: (route) =>
      route.fulfill({
        body: '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
        contentType: 'application/pdf',
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
  });
  await page.goto('/#/files');
  await page.getByRole('button', { name: 'Thao tác document.pdf', exact: true }).press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Xem trước', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'document.pdf', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'document.pdf', exact: true });
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await expect(dialog).toContainText('Nếu trình duyệt không hiển thị PDF');
  await page.screenshot({ path: testInfo.outputPath('pdf-native-viewer.png'), fullPage: true });
  files[0] = {
    ...files[0],
    scan_status: 'quarantined',
    findings_count: 1,
    finding_types: ['EMAIL_ADDRESS'],
    quarantined_at: '2026-10-27T04:00:00.000Z',
    updated_at: '2026-10-27T04:00:00.000Z',
  };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Thông tin tệp' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Thông tin tệp' })).toContainText('Đã cách ly');
});

test('two upload selections remain separate batches; cancel retries only eligible files without resending ambiguous outcomes', async ({
  page,
}) => {
  const attempts = new Map();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await fixture(page, {
    files: [],
    upload: async (route) => {
      const name = route
        .request()
        .postData()
        ?.match(/filename="([^"]+)"/)?.[1];
      attempts.set(name, (attempts.get(name) || 0) + 1);
      if (name === 'uncertain.txt') return route.abort('connectionreset');
      if (name === 'slow.txt' && attempts.get(name) === 1) {
        await pending;
        return route
          .fulfill({
            json: { id: 'slow', storage: 's3', upload_state: 'uploaded', scan_status: 'safe' },
            headers: { 'Access-Control-Allow-Origin': '*' },
          })
          .catch(() => {});
      }
      return route.fulfill({
        json: { id: name, storage: 's3', upload_state: 'uploaded', scan_status: 'safe' },
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    },
  });
  await page.goto('/#/uploads');
  const input = page.getByLabel('Chọn tệp để tải lên', { exact: true });
  const sample = (name) => ({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from('Batch integration'),
  });
  await input.setInputFiles([sample('good.txt'), sample('slow.txt')]);
  const batches = page.getByRole('region', { name: 'Các đợt tải lên' });
  await expect(batches.locator('.batch-row')).toHaveCount(1);
  await expect(batches.locator('.batch-row')).toContainText('2 tệp');
  await expect.poll(() => attempts.get('slow.txt')).toBe(1);
  await page.getByRole('button', { name: 'Hủy tất cả', exact: true }).first().click();
  await expect(batches).toContainText('1 đã hủy');
  await input.setInputFiles([sample('uncertain.txt')]);
  await expect(batches.locator('.batch-row')).toHaveCount(2);
  const initial = batches
    .locator('.batch-row')
    .filter({ has: page.getByRole('heading', { name: /2 tệp/ }) });
  const uncertain = batches
    .locator('.batch-row')
    .filter({ has: page.getByRole('heading', { name: /1 tệp/ }) });
  await expect(uncertain).toContainText('1 chưa rõ kết quả');
  await expect(uncertain.getByRole('button', { name: /Thử lại/ })).toBeDisabled();
  await initial.getByRole('button', { name: 'Thử lại 1 tệp trong đợt', exact: true }).click();
  await expect(initial).toContainText('2 đã tải xong');
  await expect(initial.getByRole('heading')).toContainText('2 tệp');
  expect(attempts.get('good.txt')).toBe(1);
  expect(attempts.get('slow.txt')).toBe(2);
  expect(attempts.get('uncertain.txt')).toBe(1);
  release();
});
