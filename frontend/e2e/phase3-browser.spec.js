import { test, expect } from './support/built-app.js';

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
  await expect(page.locator('.selection-toolbar strong')).toContainText('3,1 KB');
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
  await expect(page.getByRole('region', { name: 'Nhóm tệp đã chọn' })).toHaveCount(0);
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
  await expect(resize).toHaveAttribute('aria-valuenow', await resize.getAttribute('aria-valuemax'));
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

test('name column really moves in both directions on wide screens and metadata stays centered', async ({
  page,
}) => {
  await setup(page);
  const heading = page.locator('.name-column-heading');
  const separator = page.getByRole('separator', { name: 'Độ rộng cột tên' });
  for (const width of [1920, 2560]) {
    await page.setViewportSize({ width, height: 1080 });
    await expect
      .poll(() =>
        page
          .locator('.processing-table')
          .evaluate((table) =>
            Math.abs(table.getBoundingClientRect().width - table.parentElement.clientWidth),
          ),
      )
      .toBeLessThan(1);
    const initial = await heading.boundingBox();
    const handle = await separator.boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 120, y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('maysec.preferences.v2')).nameColumnResized,
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => Math.round((await heading.boundingBox()).width))
      .toBeCloseTo(Math.round(initial.width - 120), 0);
    const smaller = await heading.boundingBox();
    const movedHandle = await separator.boundingBox();
    await page.mouse.move(movedHandle.x + movedHandle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(movedHandle.x + movedHandle.width / 2 + 80, y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.round((await heading.boundingBox()).width))
      .toBeCloseTo(Math.round(smaller.width + 80), 0);
    const savedWidth = (await heading.boundingBox()).width;
    await page.reload();
    await expect(rows(page)).toHaveCount(50);
    await expect
      .poll(async () => Math.round((await heading.boundingBox()).width))
      .toBeCloseTo(Math.round(savedWidth), 0);
    const differences = await page.locator('.processing-table').evaluate((table) => {
      const row = table.tBodies[0].rows[0];
      return [...table.tHead.rows[0].cells]
        .filter((cell) => cell.classList.contains('metadata-column'))
        .map((cell) => {
          const header = cell.getBoundingClientRect();
          const data = row.cells[cell.cellIndex].getBoundingClientRect();
          const badge = row.cells[cell.cellIndex]
            .querySelector('.status-badge')
            ?.getBoundingClientRect();
          return {
            header: Math.abs(header.x + header.width / 2 - data.x - data.width / 2),
            badge: badge ? Math.abs(badge.x + badge.width / 2 - data.x - data.width / 2) : 0,
          };
        });
    });
    expect(differences.every((value) => value.header < 1 && value.badge < 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/library-columns-${width}.png`, fullPage: false });
  }
});

test('file action menu stays above sticky rows while scrolling and supports keyboard and outside clicks', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await setup(page);
  const trigger = rows(page)
    .first()
    .getByRole('button', { name: /^Thao tác / });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const inspect = menu.getByRole('menuitem', { name: 'Thông tin tệp', exact: true });
  await expect(inspect).toBeFocused();
  async function expectUncovered() {
    expect(
      await menu.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [0.1, 0.5, 0.9].every((x) =>
          [0.1, 0.5, 0.9].every((y) =>
            element.contains(
              document.elementFromPoint(box.x + box.width * x, box.y + box.height * y),
            ),
          ),
        );
      }),
    ).toBe(true);
  }
  await expectUncovered();
  await page.locator('.file-table-scroll').evaluate((element) => {
    element.scrollLeft = 80;
  });
  await expectUncovered();
  await page.screenshot({ path: testInfo.outputPath('file-action-menu.png'), fullPage: true });
  await inspect.click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Thông tin tệp', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await trigger.click();
  await page.keyboard.press('End');
  await expect(inspect).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { name: /^Danh sách tệp/ }).click();
  await expect(menu).toHaveCount(0);
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
