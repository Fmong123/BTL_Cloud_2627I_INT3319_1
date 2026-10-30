import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional offline browser checks: serve the production build through Playwright.
// Normal test runs still use the Vite server configured in playwright.config.js.
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
export async function serveBuiltApp(surface, baseURL) {
  if (process.env.MAYSEC_BUILT_APP === '1') {
    await surface.route(`${new URL(baseURL).origin}/**`, async (route) => {
      const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
      const file = resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!file.startsWith(resolve(dist) + sep)) return route.fulfill({ status: 403, body: '' });
      try {
        const body = await readFile(file);
        const contentType = file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.svg')
              ? 'image/svg+xml'
              : 'text/html';
        return route.fulfill({ body, contentType });
      } catch {
        return route.fulfill({ status: 404, body: '' });
      }
    });
  }
}
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await serveBuiltApp(page, baseURL);
    await use(page);
  },
});
export { expect };
