import { test, expect } from './support/built-app.js';

const sample = (name = 'Báo cáo.txt', content = 'Tài liệu thử nghiệm') => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(content),
});
const filesInput = (page) => page.locator('input[type="file"]');
const nav = (page) => page.getByRole('navigation', { name: 'Điều hướng chính' });

const runtimeErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(runtimeErrors.get(page)).toEqual([]));

test('storage badge opens an inline menu without navigating or clearing file filters', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'maysec.preferences.v1',
      JSON.stringify({ version: 1, mode: 'api', baseUrl: 'http://127.0.0.1:8000', theme: 'dark' }),
    ),
  );
  await page.goto('/#/files?q=bao%20cao');
  const url = page.url();
  const trigger = page.getByRole('button', { name: 'Lưu trữ thật', exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Cài đặt kết nối', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tệp của tôi');
  await expect(page).toHaveURL(url);
  await page.screenshot({ path: testInfo.outputPath('connection-menu.png') });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('radio', { name: /Trải nghiệm giao diện/ }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true })).toHaveValue(
    'bao cao',
  );
  const demo = page.getByRole('button', { name: 'Trải nghiệm', exact: true });
  await demo.click();
  await page.getByRole('radio', { name: /Lưu trữ thật/ }).click();
  await trigger.click();
  await page.getByRole('link', { name: 'Cài đặt kết nối', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await trigger.click();
  await page
    .locator('#storage-options')
    .getByRole('radio', { name: /Trải nghiệm giao diện/ })
    .click();
  await expect(
    page.locator('.mode-option').getByRole('radio', { name: /Trải nghiệm giao diện/ }),
  ).toBeChecked();
});

test('storage menu cannot change connection while a queue is running', async ({ page }) => {
  await page.goto('/#/files');
  await filesInput(page).setInputFiles(
    Array.from({ length: 5 }, (_, index) => sample(`menu-${index}.txt`)),
  );
  await page.getByRole('button', { name: 'Trải nghiệm', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Lưu trữ thật/ })).toBeDisabled();
  await expect(page.getByText('Chờ hoặc hủy lượt tải trước khi đổi chế độ.')).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(page.getByRole('link', { name: 'Cài đặt kết nối', exact: true })).toHaveCount(0);
});

test('200-file selection, cancellation, grid and undo remain usable', async ({ page }) => {
  await page.goto('/#/uploads');
  await filesInput(page).setInputFiles(
    Array.from({ length: 200 }, (_, i) => sample(`Tài liệu ${i}.txt`)),
  );
  await page.getByRole('button', { name: 'Hủy tất cả', exact: true }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await expect(page.locator('.file-pagination')).toContainText('Trang 1 / 4');
  await expect(page.getByRole('region', { name: 'Tiến trình tải lên' })).toHaveCount(0);
  await nav(page).locator('a[href="#/files"]').click();
  await page.getByRole('button', { name: 'Dạng lưới', exact: true }).click();
  // Selection applies to the 50 visible records, not hidden pages. Star all four pages.
  for (let current = 1; current <= 4; current++) {
    await expect(page.locator('.file-card')).toHaveCount(50);
    await expect(page.locator('.file-pagination')).toContainText(`Trang ${current} / 4`);
    await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
    await page
      .getByLabel('Thao tác với tệp đã chọn')
      .getByRole('button', { name: 'Đánh dấu', exact: true })
      .click();
    if (current < 4) await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  }
  await page.locator('.extra-file-filters > summary').click();
  await page.getByRole('combobox', { name: 'Nhóm tệp' }).selectOption('starred');
  await expect(page.locator('.file-card')).toHaveCount(50);
  await expect(page.locator('.file-pagination')).toContainText('Trang 1 / 4');
  const removedNames = await page.locator('.file-card .file-name').allTextContents();
  await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
  await page.getByRole('button', { name: 'Bỏ khỏi danh sách', exact: true }).click();
  await expect(page.locator('.file-pagination')).toContainText('Trang 1 / 3');
  const remainingNames = await page.locator('.file-card .file-name').allTextContents();
  expect(remainingNames.every((name) => !removedNames.includes(name))).toBe(true);
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(page.locator('.file-card')).toHaveCount(50);
  await expect(page.locator('.file-pagination')).toContainText('Trang 1 / 4');
  await expect(page.locator('.file-card .file-name')).toHaveText(removedNames);
});

test('enlarged desktop text, reduced motion and detail drawer keyboard behavior', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const factor of [1.25, 1.5]) {
    await page.setViewportSize({
      width: Math.floor(1280 / factor),
      height: Math.floor(720 / factor),
    });
    for (const route of ['overview', 'files', 'uploads', 'settings', 'help']) {
      await page.goto(`/#/${route}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.goto('/#/files');
  await filesInput(page).setInputFiles(sample());
  await expect(page.locator('tbody .status-badge.demo')).toHaveCount(1);
  const trigger = page.getByRole('button', {
    name: 'Thông tin Báo cáo.txt',
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole('region', { name: 'Thông tin tệp', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Thông tin tệp', exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('link', { name: 'Đến nội dung chính' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/files/);
  await expect(page.locator('main')).toBeFocused();
});

test('a cancelled health request cannot overwrite a changed address', async ({ page }) => {
  await page.route('http://127.0.0.1:8000/health', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route
      .fulfill({
        json: {
          status: 'ok',
          storage: 'local',
          storage_configured: true,
          max_file_size_bytes: 42,
        },
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
      .catch(() => {});
  });
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: /Lưu trữ thật/ }).check();
  const address = page.getByRole('textbox', { name: 'Địa chỉ máy chủ' });
  await address.fill('http://127.0.0.1:8000');
  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await address.fill('http://127.0.0.1:8001');
  await expect(page.getByText('Chưa có kết quả kiểm tra cho địa chỉ này.')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText('Máy chủ phản hồi', { exact: true })).toHaveCount(0);
});

test('queue survives navigation; search, bulk selection and undo share the same files', async ({
  page,
}) => {
  await page.goto('/');
  await filesInput(page).setInputFiles(
    Array.from({ length: 8 }, (_, i) => sample(`Báo cáo ${i}.txt`)),
  );
  await nav(page).getByRole('link', { name: 'Hướng dẫn' }).click();
  await expect(page.getByRole('region', { name: 'Tiến trình tải lên' })).toBeVisible();
  await nav(page)
    .getByRole('link', { name: /Tệp của tôi/ })
    .click();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await expect(page.locator('tbody .status-badge.demo')).toHaveCount(8, {
    timeout: 20000,
  });
  await page.getByRole('textbox', { name: 'Tìm kiếm tệp', exact: true }).fill('bao cao 2');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Chọn tất cả tệp đang hiển thị' }).check();
  await page.getByRole('button', { name: 'Bỏ khỏi danh sách', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Không có tệp phù hợp' })).toBeVisible();
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.getByRole('checkbox', { name: 'Chọn Báo cáo 0.txt', exact: true }).check();
  await page.getByRole('combobox', { name: 'Loại tệp' }).selectOption('image');
  await expect(page.getByLabel('Thao tác với tệp đã chọn')).toHaveCount(0);
});

test('invalid files cannot retry; duplicates default to skip; cancellation can retry', async ({
  page,
}) => {
  await page.goto('/#/files');
  await filesInput(page).setInputFiles(sample('empty.txt', ''));
  await expect(
    page.getByText('Tệp trống — hãy chọn một tệp có nội dung', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử lại empty.txt', exact: true })).toHaveCount(0);
  await filesInput(page).setInputFiles(sample('same.txt'));
  await expect(page.getByRole('button', { name: 'Thông tin same.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Thao tác same.txt', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Hủy tải lên', exact: true }).click();
  await page.getByRole('button', { name: 'Thao tác same.txt', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Thử tải lại', exact: true }).click();
  await expect(page.locator('tbody .status-badge.demo')).toHaveCount(1);
  // A File object's lastModified is stable for repeated native selections of a disk file.
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['duplicate'], 'duplicate.txt', { lastModified: 123 }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['duplicate'], 'duplicate.txt', { lastModified: 123 }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ qua tệp trùng' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'duplicate.txt' })).toHaveCount(1);
});

test('theme persists, follows system, and keyboard navigation respects text inputs', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: /Sáng Sáng nhẹ/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: /Theo hệ thống Đổi/ }).check();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: /Lưu trữ thật/ }).check();
  await page.getByRole('textbox', { name: 'Địa chỉ máy chủ' }).focus();
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/settings/);
  await page.getByRole('heading', { name: 'Cài đặt', exact: true }).focus();
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/settings/);
  await expect(
    page.getByRole('searchbox', { name: 'Tìm kiếm tệp trên thanh đầu', exact: true }),
  ).toBeFocused();
  await page.goto('/#/missing');
  await expect(
    page.getByRole('heading', { name: 'Không tìm thấy trang', exact: true }),
  ).toBeVisible();
});

test('health and real-upload contract work, client validation uses server limit', async ({
  page,
}) => {
  let uploadCalls = 0;
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    const health = route.request().url().endsWith('/health');
    if (route.request().method() === 'POST') uploadCalls++;
    return route.fulfill({
      status: health ? 200 : 201,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: health
        ? {
            status: 'ok',
            storage: 'local',
            storage_configured: true,
            max_file_size_bytes: 100,
            metadata_mode: 'disabled',
            metadata_configured: false,
          }
        : {
            id: 'server-file',
            key: 'uploads/file.txt',
            storage: 'local',
            scan_status: 'not_started',
          },
    });
  });
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: /Lưu trữ thật/ }).check();
  await page.getByRole('textbox', { name: 'Địa chỉ máy chủ' }).fill('http://127.0.0.1:8000');
  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(page.getByText('Máy chủ phản hồi', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lưu kết nối' }).click();
  await nav(page)
    .getByRole('link', { name: /Tệp của tôi/ })
    .click();
  await filesInput(page).setInputFiles([
    sample('real.txt'),
    sample('oversized.txt', 'x'.repeat(101)),
  ]);
  await expect(page.getByText('Đã lưu local', { exact: true })).toBeVisible();
  await expect(page.getByText('Tệp vượt quá giới hạn 100 B', { exact: true })).toBeVisible();
  expect(uploadCalls).toBe(1);
  await page.getByRole('button', { name: 'Thông tin real.txt', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Thông tin tệp', exact: true });
  await expect(detail).toContainText('Chưa quét');
  await detail.getByRole('tab', { name: 'Xử lý', exact: true }).click();
  await expect(detail).toContainText(
    'Máy chủ đã xác nhận lưu nội dung. Kết quả quét là bước riêng.',
  );
  await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thông tin real.txt', exact: true })).toBeFocused();
});

test('storage failures fall back gracefully and health errors can be recovered', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/#/settings');
  await expect(page.getByText(/Không thể ghi nhớ tùy chọn/)).toBeVisible();
  await page.getByRole('radio', { name: /Lưu trữ thật/ }).check();
  await page.getByRole('textbox', { name: 'Địa chỉ máy chủ' }).fill('http://127.0.0.1:8999');
  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('radio', { name: /Tối Tím than/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`desktop layouts and both themes at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/files');
    await filesInput(page).setInputFiles(
      Array.from({ length: 5 }, (_, i) =>
        sample(
          `${i} — Báo cáo rất dài về điện toán đám mây và thiết kế giao diện người dùng với nhiều thông tin chi tiết.txt`,
        ),
      ),
    );
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of ['overview', 'files', 'uploads', 'settings', 'help']) {
        await nav(page).locator(`a[href="#/${route}"]`).click();
        await expect(page).toHaveURL(new RegExp(`#/${route}$`));
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          {
            overview: 'Tổng quan',
            files: 'Tệp của tôi',
            uploads: 'Hoạt động xử lý',
            settings: 'Cài đặt',
            help: 'Hướng dẫn',
          }[route],
        );
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await nav(page).locator('a[href="#/files"]').click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tệp của tôi');
      await page.screenshot({
        path: testInfo.outputPath(`${scheme}-${viewport.width}.png`),
        fullPage: true,
      });
    }
  });
}
