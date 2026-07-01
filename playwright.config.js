import { defineConfig } from '@playwright/test';

// Target: production worker by default.
// Local dev: start wrangler dev, then WORKER_URL=http://localhost:8787 npm test
// Production: WORKER_URL=https://api.digitaalinentuotepassi.tulkintatila.fi npm run test:smoke
const BASE_URL = process.env.WORKER_URL || 'https://digitaalinen-tuotepassi.rkallio88.workers.dev';

export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  retries: 1,
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'Origin': BASE_URL },
  },
  projects: [{ name: 'api' }],
});
