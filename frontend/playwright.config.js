import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'edge', use: { channel: 'msedge' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
  },
});
