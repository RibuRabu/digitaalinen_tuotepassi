import { defineConfig, devices } from '@playwright/test';

// Target: production worker by default.
// Local dev: start wrangler dev, then WORKER_URL=http://localhost:8787 npm test
// Production: WORKER_URL=https://api.digitaalinentuotepassi.tulkintatila.fi npm run test:smoke
const BASE_URL = process.env.WORKER_URL || 'https://digitaalinen-tuotepassi.rkallio88.workers.dev';

// Optional: point at a pre-installed Chromium when the managed browser is absent
// (e.g. sandboxed CI). Leave unset to use Playwright's managed browser.
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  retries: 1,
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'Origin': BASE_URL },
  },
  projects: [
    // API/request tests — no browser needed.
    { name: 'api', testIgnore: '**/*.e2e.spec.js' },
    // Browser journey tests (public passport UI).
    {
      name: 'passport-ui',
      testMatch: '**/*.e2e.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
      },
    },
  ],
});
