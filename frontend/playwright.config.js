import { defineConfig } from '@playwright/test';

// Independent suites can use distinct servers and artifact directories.
const port = Number(process.env.MAYSEC_TEST_PORT || 5174);

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'edge', use: { channel: 'msedge' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
