import { defineConfig } from '@playwright/test';

/**
 * BASE_URL must point at the page your component is actually on -- an Experience site page, or a
 * Lightning app page. Pointing it at the org's home page is the single most common reason an e2e
 * suite "passes" while testing nothing.
 *
 * Credentials and URLs live in e2e/.env, which is gitignored. Never commit an org login.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL,
    // Evidence, automatically, for failures only. Screenshots of passing tests are noise.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // A logged-in session saved once, so each test does not re-authenticate.
    storageState: process.env.STORAGE_STATE || undefined
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
