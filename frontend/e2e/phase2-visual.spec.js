import { test, expect } from './support/built-app.js';

const API = 'http://127.0.0.1:8000';
const stamp = '2026-10-27T03:00:00.000Z';
const states = [
  'safe',
  'scanning',
  'flagged',
  'quarantined',
  'quarantine_delete_failed',
  'unscanned',
  'error',
  'not_started',
];
const records = Array.from({ length: 1000 }, (_, index) => ({
  id: `visual-${index}`,
  owner_id: 'dev-user',
  original_name: `${String(index).padStart(4, '0')} — Báo cáo lưu trữ điện toán đám mây và kiểm tra dữ liệu nhạy cảm rất dài.txt`,
  key: `uploads/dev-user/visual-${index}/report.txt`,
  size_bytes: 1024 + index,
  content_type: 'text/plain',
  storage: 's3',
  upload_state: 'uploaded',
  scan_status: states[index % states.length],
  created_at: stamp,
  updated_at: stamp,
  findings_count: [2, 3, 4].includes(index % 8) ? 2 : 0,
  finding_types: [2, 3, 4].includes(index % 8) ? ['CCCD'] : [],
  status_reason:
    index % 8 === 4 ? 'quarantine_delete_failed' : index % 8 === 5 ? 'unsupported_type' : null,
  scanned_at: index % 8 === 1 || index % 8 === 7 ? null : stamp,
  quarantined_at: index % 8 === 3 ? stamp : null,
}));

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`1000 API files and processing drawer in both themes at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let pagesRead = 0;
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        'maysec.preferences.v1',
        JSON.stringify({
          version: 1,
          mode: 'api',
          baseUrl: 'http://127.0.0.1:8000',
          theme: 'system',
          sort: 'name',
          view: 'list',
        }),
      ),
    );
    await page.route(`${API}/**`, async (route) => {
      const url = new URL(route.request().url());
      const headers = { 'Access-Control-Allow-Origin': '*' };
      if (url.pathname === '/health')
        return route.fulfill({
          headers,
          json: {
            status: 'ok',
            storage: 's3',
            storage_configured: true,
            max_file_size_bytes: 104857600,
            metadata_mode: 'dynamodb',
            metadata_configured: true,
            scan_pipeline_enabled: true,
          },
        });
      if (url.pathname === '/files') {
        pagesRead++;
        const start = Number(url.searchParams.get('cursor') || 0);
        return route.fulfill({
          headers,
          json: {
            items: records.slice(start, start + 100),
            next_cursor: start + 100 < records.length ? String(start + 100) : null,
          },
        });
      }
      const id = url.pathname.match(/\/files\/([^/]+)\/status$/)?.[1];
      const record = records.find((file) => file.id === id);
      return route.fulfill({
        headers,
        status: record ? 200 : 404,
        json: record || { detail: 'Không tìm thấy tệp' },
      });
    });
    await page.goto('/#/files');
    await expect(page.getByRole('region', { name: 'Thư viện tệp' })).toContainText('1000 tệp');
    await expect(page.locator('tbody tr')).toHaveCount(50);
    expect(pagesRead).toBeGreaterThanOrEqual(10);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(
        page.getByRole('button', { name: `Thao tác ${records[0].original_name}`, exact: true }),
      ).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-${viewport.width}-library.png`),
        fullPage: false,
      });
      await page.getByRole('button', { name: records[3].original_name, exact: true }).click();
      const drawer = page.getByRole('region', { name: 'Thông tin tệp', exact: true });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('tab', { name: 'Xử lý', exact: true }).click();
      await expect(drawer).toContainText('Đã cách ly');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${viewport.width}-drawer.png`) });
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      const action = page.getByRole('button', {
        name: `Thao tác ${records[1].original_name}`,
        exact: true,
      });
      await action.focus();
      const box = await action.boundingBox();
      const dock = await page.locator('.upload-dock').boundingBox();
      const overlap =
        box &&
        dock &&
        box.x < dock.x + dock.width &&
        box.x + box.width > dock.x &&
        box.y < dock.y + dock.height &&
        box.y + box.height > dock.y;
      expect(overlap, 'Focused file action must remain clear of the progress dock').toBeFalsy();
    }
    expect(errors).toEqual([]);
  });
}
