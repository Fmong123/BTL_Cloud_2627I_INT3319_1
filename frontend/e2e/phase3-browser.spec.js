import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:8000';
const rows = (page) => page.locator('.file-table tbody tr');
const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function setup(page, capabilities = {}) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const old = new Date(today);
  old.setDate(old.getDate() - 10);
  const records = Array.from({ length: 70 }, (_, i) => ({
    id: `file-${i}`,
    owner_id: 'dev-user',
    key: `uploads/dev-user/file-${i}/sample.txt`,
    original_name: `${i < 5 || i >= 10 ? 'report' : 'note'}-${String(i).padStart(2, '0')}.txt`,
    size_bytes: 1024,
    content_type: 'text/plain',
    storage: 's3',
    upload_state: 'uploaded',
    scan_status: 'safe',
    created_at: (i < 10 ? today : old).toISOString(),
    updated_at: today.toISOString(),
    findings_count: 0,
    finding_types: [],
    starred: false,
  }));
  await page.addInitScript(
    () =>
      !localStorage.getItem('maysec.preferences.v2') &&
      localStorage.setItem(
        'maysec.preferences.v2',
        JSON.stringify({
          version: 2,
          mode: 'api',
          baseUrl: 'http://127.0.0.1:8000',
          theme: 'dark',
          view: 'list',
          sort: 'name',
        }),
      ),
  );
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/health')
      return route.fulfill({
        json: {
          status: 'ok',
          storage: 's3',
          storage_configured: true,
          metadata_mode: 'dynamodb',
          metadata_configured: true,
          max_file_size_bytes: 104857600,
          capabilities: { file_content: false, favorites: false, ...capabilities },
        },
      });
    if (url.pathname === '/files')
      return route.fulfill({ json: { items: records, next_cursor: null } });
    return route.fulfill({ status: 404, json: { detail: 'Unexpected request' } });
  });
  await page.goto('/#/files');
  await expect(rows(page)).toHaveCount(50);
  return today;
}
const localDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('date filters are inclusive, scoped saved filters survive reload and browser history restores URL filters', async ({
  page,
}) => {
  const today = await setup(page);
  await page.getByText('Bộ lọc thêm', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Ngày thêm tệp' }).selectOption('custom');
  await page.getByLabel('Từ ngày', { exact: true }).fill(localDate(today));
  await page.getByLabel('Đến ngày', { exact: true }).fill(localDate(today));
  await expect(rows(page)).toHaveCount(10);
  await page.getByRole('textbox', { name: 'Tìm kiếm tệp' }).fill('report');
  await expect(rows(page)).toHaveCount(5);
  await page.locator('.saved-filter-control > summary').click();
  await page.getByLabel('Lưu bộ lọc hiện tại').fill('Báo cáo hôm nay');
  await page.getByRole('button', { name: 'Lưu bộ lọc', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã lưu “Báo cáo hôm nay”' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(rows(page)).toHaveCount(50);
  await page.reload();
  await expect(rows(page)).toHaveCount(50);
  await page.locator('.saved-filter-control > summary').click();
  await page.getByRole('button', { name: 'Báo cáo hôm nay', exact: true }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByRole('textbox', { name: 'Tìm kiếm tệp' })).toHaveValue('report');
  await expect(page.getByLabel('Đến ngày', { exact: true })).toHaveValue(localDate(today));
  await page.getByRole('combobox', { name: 'Loại tệp', exact: true }).selectOption('image');
  await expect(rows(page)).toHaveCount(0);
  await page.goBack();
  await expect(rows(page)).toHaveCount(5);
  await page.goForward();
  await expect(rows(page)).toHaveCount(0);
  await page.locator('.saved-filter-control > summary').click();
  await page.getByRole('button', { name: 'Xóa bộ lọc Báo cáo hôm nay' }).click();
  await expect(page.getByRole('button', { name: 'Báo cáo hôm nay', exact: true })).toHaveCount(0);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('maysec.preferences.v2')).savedFilters,
  );
  expect(saved['api:http://127.0.0.1:8000']).toEqual([]);
});

test('current-page shift range, list-scoped select all, byte totals and layered Escape', async ({
  page,
}) => {
  await setup(page);
  const boxes = rows(page).getByRole('checkbox');
  await boxes.nth(0).click();
  await boxes.nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-toolbar strong')).toContainText('3 đã chọn');
  await expect(page.locator('.selection-toolbar strong')).toContainText('3 KiB');
  await expect(boxes.nth(1)).toBeChecked();
  await page.getByRole('textbox', { name: 'Tìm kiếm tệp' }).focus();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.selection-toolbar strong')).toContainText('3 đã chọn');
  await page.locator('#file-results').focus();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.selection-toolbar strong')).toContainText('50 đã chọn');
  await rows(page)
    .first()
    .getByRole('button', { name: /^Thao tác / })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.selection-toolbar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Trang sau' }).click();
  await expect(rows(page)).toHaveCount(20);
  await page.locator('#file-results').focus();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.selection-toolbar strong')).toContainText('20 đã chọn');
  await page.getByRole('button', { name: 'Trang trước' }).click();
  await expect(page.locator('.selection-toolbar')).toHaveCount(0);
});

test('density, hidden columns and keyboard/pointer resizing persist; header remains sticky', async ({
  page,
}) => {
  await setup(page);
  await page.locator('summary[title="Tùy chỉnh hiển thị"]').click();
  await page.getByRole('combobox', { name: 'Mật độ hiển thị' }).selectOption('compact');
  await page.getByRole('checkbox', { name: 'Cột kích thước' }).uncheck();
  await page.getByRole('checkbox', { name: 'Cột thời gian' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Kích thước' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Thời gian thêm' })).toHaveCount(0);
  const resize = page.getByRole('separator', { name: 'Độ rộng cột tên' });
  await resize.focus();
  await page.keyboard.press('End');
  await expect(resize).toHaveAttribute('aria-valuenow', '720');
  await page.keyboard.press('Home');
  await expect(resize).toHaveAttribute('aria-valuenow', '240');
  const box = await resize.boundingBox();
  await page.mouse.move(box.x + 7, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 107, box.y + 25);
  await page.mouse.up();
  await expect(resize).toHaveAttribute('aria-valuenow', '340');
  await page.reload();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.locator('.file-table-scroll')).toHaveClass(/density-compact/);
  await expect(page.getByRole('separator', { name: 'Độ rộng cột tên' })).toHaveAttribute(
    'aria-valuenow',
    '340',
  );
  const header = page.locator('.processing-table thead');
  const before = await header.boundingBox();
  await page.locator('.file-table-scroll').evaluate((el) => {
    el.scrollTop = 500;
  });
  const after = await header.boundingBox();
  // The cells, rather than thead box, own sticky positioning.
  const top = await page.locator('.processing-table th').first().boundingBox();
  expect(Math.abs(top.y - before.y)).toBeLessThan(2);
  expect(after.y).toBeLessThan(before.y);
});

test('unsupported content and favorite capabilities are explained while file information remains available', async ({
  page,
}) => {
  await setup(page);
  const first = rows(page).first();
  await expect(first.getByRole('button', { name: /^Đánh dấu / })).toBeDisabled();
  await first.getByRole('button', { name: /^Thao tác / }).click();
  await expect(page.getByRole('menuitem', { name: 'Xem trước' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Tải xuống' })).toBeDisabled();
  await expect(page.getByRole('menu')).toContainText('Máy chủ chưa hỗ trợ mở nội dung');
  await page.getByRole('menuitem', { name: 'Thông tin tệp' }).click();
  await expect(page.getByRole('region', { name: 'Thông tin tệp', exact: true })).toBeVisible();
});
