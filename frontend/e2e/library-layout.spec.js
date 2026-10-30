import { test, expect } from './support/built-app.js';

const API = 'http://127.0.0.1:8000';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6sAAAAASUVORK5CYII=',
  'base64',
);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
const items = [
  ['photo', 'Hình ảnh.png', 'image/png', 'safe', png.length],
  ['report', 'Báo cáo.pdf', 'application/pdf', 'safe', pdf.length],
  ['private', 'Thông tin riêng.png', 'image/png', 'quarantined', png.length],
  [
    'word',
    'Đề cương.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'unscanned',
    1024,
  ],
].map(([id, original_name, content_type, scan_status, size_bytes]) => ({
  id,
  original_name,
  content_type,
  scan_status,
  size_bytes,
  owner_id: 'dev-user',
  key: `uploads/dev-user/${id}/file`,
  storage: 's3',
  upload_state: 'uploaded',
  created_at: '2026-10-30T12:00:00Z',
  updated_at: '2026-10-30T12:00:00Z',
  findings_count: scan_status === 'quarantined' ? 1 : 0,
  finding_types: scan_status === 'quarantined' ? ['EMAIL'] : [],
  status_reason: scan_status === 'unscanned' ? 'unsupported_type_or_size' : null,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'maysec.preferences.v2',
      JSON.stringify({
        version: 2,
        mode: 'api',
        baseUrl: 'http://127.0.0.1:8000',
        theme: 'light',
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
          capabilities: { file_content: true, persistent_favorites: false },
        },
      });
    if (url.pathname === '/files') return route.fulfill({ json: { items, next_cursor: null } });
    const match = url.pathname.match(/^\/files\/([^/]+)\/content$/);
    if (match) {
      if (match[1] === 'photo') return route.fulfill({ contentType: 'image/png', body: png });
      if (match[1] === 'report')
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
      throw new Error('Blocked file content must never be requested');
    }
    return route.fulfill({ status: 404, json: { detail: 'Not found' } });
  });
  await page.goto('/#/files');
  await expect(page.locator('.file-table tbody tr')).toHaveCount(4);
});

test('header searches directly, preserves filters, works from another page and has one upload entry', async ({
  page,
}) => {
  const search = page.getByRole('searchbox', { name: 'Tìm kiếm tệp trên thanh đầu' });
  await expect(page.locator('.topbar').getByRole('button', { name: 'Tải tệp lên' })).toHaveCount(0);
  await expect(
    page.locator('.file-workspace').getByRole('button', { name: 'Tải tệp lên' }),
  ).toBeVisible();
  await expect(page.locator('.drive-toolbar-note')).toHaveCount(0);
  await search.fill('bao cao');
  await expect(page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true })).toHaveValue(
    'bao cao',
  );
  await expect(page.locator('.file-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.file-table tbody')).toContainText('Báo cáo.pdf');
  await expect(search).toBeFocused();
  await page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true }).fill('hinh');
  await expect(search).toHaveValue('hinh');
  await page.getByRole('button', { name: 'Xóa tìm kiếm trên thanh đầu', exact: true }).click();
  await page.getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await search.fill('hinh anh');
  await expect(page).toHaveURL(/#\/files\?q=hinh\+anh/);
  await expect(page.locator('.file-table tbody tr')).toHaveCount(1);
  await expect(search).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await page.getByLabel('Người dùng', { exact: true }).click();
  await expect(page.locator('.user-menu-panel')).toContainText('Chưa đăng nhập');
  await page.keyboard.press('Escape');
  await expect(page.locator('.user-menu')).not.toHaveAttribute('open', '');
});

test('sidebar shows the 1 GB free allowance, counts confirmed files independently of search and updates after sync', async ({
  page,
}) => {
  let records = items.map((file, index) => ({
    ...file,
    size_bytes: [250_000_000, 125_000_000, 200_000_000, 300_000_000][index],
    upload_state: ['uploaded', 'uploaded', 'uploading', 'failed'][index],
  }));
  await page.route(
    (url) => url.origin === API && url.pathname === '/files',
    (route) => route.fulfill({ json: { items: records, next_cursor: null } }),
  );
  await page.reload();
  const storage = page.locator('.sidebar-storage');
  const meter = storage.getByRole('progressbar');
  await expect(storage).toContainText('Đã sử dụng 375 MB trong tổng số 1 GB');
  await expect(storage).toContainText('Gói miễn phí');
  await expect(meter).toHaveAttribute('max', '1000000000');
  await expect(meter).toHaveAttribute('value', '375000000');
  expect((await page.locator('.sidebar').boundingBox()).width).toBe(276);
  await page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true }).fill('bao cao');
  await expect(page.locator('.file-table tbody tr')).toHaveCount(1);
  await expect(meter).toHaveAttribute('value', '375000000');
  records = records.map((file, index) =>
    index === 0 ? { ...file, size_bytes: 300_000_000 } : file,
  );
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(storage).toContainText('425 MB');
  await page.locator('.sidebar').screenshot({ path: 'test-results/sidebar-storage-light.png' });
  await page.getByRole('button', { name: 'Chọn giao diện' }).click();
  await page.getByRole('button', { name: 'Tối', exact: true }).click();
  await page.locator('.sidebar').screenshot({ path: 'test-results/sidebar-storage-dark.png' });
  await page.getByRole('button', { name: 'Thu gọn thanh điều hướng' }).click();
  expect((await page.locator('.sidebar').boundingBox()).width).toBe(64);
  await expect(storage.locator('progress')).toBeHidden();
  await expect(storage).toHaveAttribute('title', /425 MB.*1 GB/);
  await page.getByRole('button', { name: 'Mở rộng thanh điều hướng' }).click();
  await expect(storage.locator('progress')).toBeVisible();
});

test('storage indicator distinguishes unavailable usage and clamps its bar when the allowance is exceeded', async ({
  page,
}) => {
  await page.route(
    (url) => url.origin === API && url.pathname === '/files',
    (route) => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }),
  );
  await page.reload();
  const storage = page.locator('.sidebar-storage');
  await expect(storage).toContainText('Chưa đọc được dung lượng');
  await expect(storage).not.toContainText('Đã sử dụng 0 MB');
  await page.route(
    (url) => url.origin === API && url.pathname === '/files',
    (route) =>
      route.fulfill({
        json: { items: [{ ...items[0], size_bytes: 1_100_000_000 }], next_cursor: null },
      }),
  );
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(storage).toContainText('Đã sử dụng 1,1 GB trong tổng số 1 GB');
  await expect(storage.getByRole('progressbar')).toHaveAttribute('value', '1000000000');
  await expect(storage).toContainText('Đã dùng hết dung lượng miễn phí');
});

test('checkboxes open single and group panels without stealing focus; closing restores width', async ({
  page,
}) => {
  const layout = page.locator('.file-browser-layout');
  const library = page.locator('.file-workspace');
  const width = (await library.boundingBox()).width;
  await page.getByRole('checkbox', { name: 'Chọn Báo cáo.pdf', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Thông tin tệp', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Chọn Báo cáo.pdf', exact: true })).toBeFocused();
  expect((await library.boundingBox()).width).toBeLessThan(width - 250);
  await page.getByRole('checkbox', { name: 'Chọn Thông tin riêng.png', exact: true }).check();
  const group = page.getByRole('region', { name: 'Nhóm tệp đã chọn' });
  await expect(group).toBeVisible();
  await expect(group).toContainText('2 tệp');
  await expect(group).toContainText('1 / 2 tệp');
  await expect(group.getByRole('button', { name: 'Tải xuống Thông tin riêng.png' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Đóng chi tiết nhóm' }).click();
  await expect(layout).not.toHaveClass(/has-panel/);
  expect((await library.boundingBox()).width).toBeCloseTo(width, 0);
  await page.getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
  await expect(page.locator('.selection-toolbar')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
  await expect(group).toContainText('4 tệp');
});

test('scan reasons are short and readable; visible image and PDF actions open their viewers', async ({
  page,
}) => {
  const wordRow = page.locator('.file-table tbody tr').filter({ hasText: 'Đề cương.docx' });
  await wordRow.getByRole('button', { name: 'Chưa thể quét — xem lý do' }).click();
  const detail = page.getByRole('region', { name: 'Thông tin tệp', exact: true });
  await expect(detail.getByRole('tab', { name: 'Xử lý', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(detail).toContainText('Định dạng hoặc dung lượng chưa hỗ trợ.');
  await detail.getByRole('button', { name: 'Đóng thông tin tệp' }).click();
  await page
    .locator('.file-table')
    .getByRole('button', { name: 'Xem trước Hình ảnh.png', exact: true })
    .click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.getByRole('img', { name: 'Xem trước Hình ảnh.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .locator('.file-table')
    .getByRole('button', { name: 'Xem trước Báo cáo.pdf', exact: true })
    .click();
  await expect(page.locator('iframe[title="Xem trước PDF Báo cáo.pdf"]')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await page.keyboard.press('Escape');
  const blocked = page.locator('.file-table tbody tr').filter({ hasText: 'Thông tin riêng.png' });
  await expect(blocked.locator('.file-preview-shortcut')).toHaveCount(0);
});

test('library uses the available width and its panel stays in the content area in both themes', async ({
  page,
}) => {
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: 'Chọn giao diện' }).click();
    await page
      .getByRole('button', { name: theme === 'light' ? 'Sáng' : 'Tối', exact: true })
      .click();
    for (const width of [1920, 1440, 1280, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('checkbox', { name: 'Chọn Báo cáo.pdf', exact: true }).check();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      const main = await page.locator('main').boundingBox();
      expect(width - main.x - main.width).toBeLessThan(3);
      const panel = await page.locator('.inline-file-detail').boundingBox();
      const list = await page.locator('.file-workspace').boundingBox();
      if (width > 1000) expect(panel.x).toBeGreaterThanOrEqual(list.x + list.width);
      await page.getByRole('button', { name: 'Đóng thông tin tệp' }).click();
      await page.getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
    }
  }
  await page.screenshot({ path: 'test-results/library-layout-full.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('checkbox', { name: 'Chọn Báo cáo.pdf', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Chọn Thông tin riêng.png', exact: true }).check();
  await page.screenshot({ path: 'test-results/library-layout-group.png', fullPage: true });
});

test('tables share readable type and centered metadata; dates lead HH:mm without seconds', async ({
  page,
}) => {
  async function checkTable() {
    const row = page.locator('.file-table tbody tr').first();
    await expect(row).toBeVisible();
    const date = row.locator('.cell-date');
    const time = row.locator('.cell-time');
    await expect(date).toHaveText(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    await expect(time).toHaveText(/^\d{2}:\d{2}$/);
    expect((await date.boundingBox()).y).toBeLessThan((await time.boundingBox()).y);
    const styles = await row.evaluate((element) => {
      const style = (selector) => getComputedStyle(element.querySelector(selector));
      return {
        name: style('.file-name').fontSize,
        metadata: style('.metadata-column').fontSize,
        date: style('.cell-date').fontSize,
        dateWeight: style('.cell-date').fontWeight,
        dateUsesPrimaryColor: style('.cell-date').color === style('.metadata-column').color,
        time: style('.cell-time').fontSize,
        alignment: [...element.querySelectorAll('.metadata-column')].map(
          (cell) => getComputedStyle(cell).textAlign,
        ),
      };
    });
    expect(styles).toEqual({
      name: '16px',
      metadata: '15px',
      date: '15px',
      dateWeight: '600',
      dateUsesPrimaryColor: true,
      time: '13px',
      alignment: ['center', 'center', 'center', 'center'],
    });
    const headings = await page
      .locator('th.metadata-column')
      .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign));
    expect(headings).toEqual(['center', 'center', 'center', 'center']);
  }
  await checkTable();
  await expect(page.getByRole('button', { name: 'Tải tệp lên', exact: true })).toHaveAttribute(
    'title',
    'Tối đa 100 MB / tệp · có thể kéo thả vào danh sách',
  );
  await page.screenshot({ path: 'test-results/library-consistency.png', fullPage: true });
  await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  await checkTable();
  await page.getByRole('button', { name: 'Lưu trữ thật', exact: true }).click();
  await page.getByRole('radio', { name: /Trải nghiệm giao diện/ }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('An example document'),
  });
  await page.getByRole('link', { name: 'Hoạt động xử lý', exact: true }).click();
  await checkTable();
});

test('overview scan badges open the processing explanation directly', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  const row = page.locator('.file-table tbody tr').filter({ hasText: 'Đề cương.docx' });
  await row.getByRole('button', { name: 'Chưa thể quét — xem lý do' }).click();
  const detail = page.getByRole('region', { name: 'Thông tin tệp', exact: true });
  await expect(detail.getByRole('tab', { name: 'Xử lý', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(detail).toContainText('Định dạng hoặc dung lượng chưa hỗ trợ.');
  await detail.getByRole('tab', { name: 'Thông tin', exact: true }).click();
  await row.getByRole('button', { name: 'Chưa thể quét — xem lý do' }).click();
  await expect(detail.getByRole('tab', { name: 'Xử lý', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('menu and detail consistently block legacy files above 100 MB without requesting content', async ({
  page,
}) => {
  let contentRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/content')) contentRequests++;
  });
  await page.route(
    (url) => url.origin === API && url.pathname === '/files',
    (route) =>
      route.fulfill({
        json: { items: [{ ...items[1], size_bytes: 100_000_001 }], next_cursor: null },
      }),
  );
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(page.locator('.file-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Thao tác Báo cáo.pdf', exact: true }).click();
  const menuDownload = page.getByRole('menuitem', { name: 'Tải xuống', exact: true });
  await expect(menuDownload).toBeDisabled();
  const reason = 'Tải xuống tối đa 100 MB mỗi tệp';
  await expect(menuDownload).toHaveAttribute('title', reason);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Thông tin Báo cáo.pdf', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Thông tin tệp', exact: true });
  const detailDownload = detail.getByRole('button', { name: 'Tải xuống', exact: true });
  await expect(detailDownload).toBeDisabled();
  await expect(detailDownload).toHaveAttribute('title', reason);
  await expect(detail).toContainText('Tải xuống tối đa 100 MB mỗi tệp');
  expect(contentRequests).toBe(0);
});

test('overview keeps five newest files while statistics and the full library retain every record', async ({
  page,
}) => {
  const records = [
    ...items,
    ...Array.from({ length: 6 }, (_, index) => ({
      ...items[0],
      id: `old-${index}`,
      original_name: `Older ${index}.png`,
      created_at: '2025-01-01T12:00:00Z',
    })),
    { ...items[0], id: 'latest', original_name: 'Latest.png', created_at: '2026-10-31T12:00:00Z' },
  ];
  await page.route(
    (url) => url.origin === API && url.pathname === '/files',
    (route) => route.fulfill({ json: { items: records, next_cursor: null } }),
  );
  await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('button', { name: 'Làm mới danh sách', exact: true }).click();
  await expect(page.locator('.overview-stats .stat').first().locator('strong')).toHaveText('11');
  await expect(page.locator('.file-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.file-table tbody tr').first()).toContainText('Latest.png');
  await expect(page.locator('.files-heading')).toContainText('Tối đa 5 tệp gần nhất');
  await page.getByRole('link', { name: 'Xem tất cả', exact: true }).click();
  await expect(page.locator('.file-table tbody tr')).toHaveCount(11);
});

test('all workspace pages share full width and both themes; overview and uploads use inline single and group panels', async ({
  page,
}) => {
  const navigation = page.getByRole('navigation', { name: 'Điều hướng chính' });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: 'Chọn giao diện' }).click();
    await page
      .getByRole('button', { name: theme === 'light' ? 'Sáng' : 'Tối', exact: true })
      .click();
    let background;
    for (const path of ['files', 'overview', 'uploads']) {
      await navigation.locator(`a[href="#/${path}"]`).click();
      for (const width of [2560, 1280, 900]) {
        await page.setViewportSize({ width, height: 900 });
        const main = await page.locator('main').boundingBox();
        const sidebar = await page.locator('.sidebar').boundingBox();
        expect(main.x).toBe(sidebar.width);
        expect(main.width).toBe(width - sidebar.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      const current = await page
        .locator('.app-shell')
        .evaluate((shell) => getComputedStyle(shell).backgroundImage);
      if (background) expect(current).toBe(background);
      else {
        background = current;
        expect(current).toContain('linear-gradient');
      }
      await expect(page.locator('.page-heading h1')).toHaveCSS('font-size', '28px');
      await expect(page.locator('.files-heading h2')).toHaveCSS('font-size', '20px');
      await expect(page.getByRole('button', { name: 'Tải tệp lên', exact: true })).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (path !== 'files')
        await page.screenshot({
          path: `test-results/${path}-workspace-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await navigation.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Chọn Báo cáo.pdf', exact: true }).check();
  await expect(page.locator('.inline-file-detail')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Chọn Thông tin riêng.png', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Nhóm tệp đã chọn' })).toContainText('2 tệp');
  await page.getByRole('button', { name: 'Đóng chi tiết nhóm' }).click();
  await page.getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
  await page.getByRole('button', { name: 'Lưu trữ thật', exact: true }).click();
  await page.getByRole('radio', { name: /Trải nghiệm giao diện/ }).click();
  await page.locator('input[type=file]').setInputFiles(
    ['a.txt', 'b.txt'].map((name) => ({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('Sample'),
    })),
  );
  await navigation.getByRole('link', { name: 'Hoạt động xử lý', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Chọn a.txt', exact: true }).check();
  await expect(page.locator('.inline-file-detail')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Chọn b.txt', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Nhóm tệp đã chọn' })).toContainText('2 tệp');
  await page.getByRole('button', { name: 'Đóng chi tiết nhóm' }).click();
  await page.getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Các đợt tải lên' })).toBeVisible();
  const table = await page.locator('.file-browser-layout').boundingBox();
  const batches = await page.locator('.upload-batches').boundingBox();
  expect(batches.y).toBeGreaterThan(table.y + table.height);
  await page.locator('h1').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/uploads-workspace-with-batches.png',
    fullPage: false,
  });
});

test('file drag and drop uses the same upload flow once on all three workspace pages', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Lưu trữ thật', exact: true }).click();
  await page.getByRole('radio', { name: /Trải nghiệm giao diện/ }).click();
  let count = 0;
  for (const route of ['files', 'overview', 'uploads']) {
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .locator(`a[href="#/${route}"]`)
      .click();
    const transfer = await page.evaluateHandle((route) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(['Dropped content'], `drop-${route}.txt`, {
          type: 'text/plain',
          lastModified: 123,
        }),
      );
      return transfer;
    }, route);
    const workspace = page.locator('.drive-workspace');
    await expect(workspace.locator('.library-drop-hint')).toHaveText('Kéo thả tệp vào danh sách');
    await expect(workspace.locator('.library-drop-hint')).toBeVisible();
    await workspace.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(page.getByText('Thả tệp để tải lên', { exact: true })).toBeVisible();
    await expect(page.locator('.drive-drop-overlay')).toContainText('100 MB / tệp');
    await workspace.dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
    await expect(page.locator('.drive-drop-overlay')).toHaveCount(0);
    await expect(page.locator('.file-table tbody tr')).toHaveCount(++count);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
