import { defineConfig } from '@playwright/test';

// Stamp one run id into the environment of the main process before workers are
// forked. Worker processes inherit this value, so every worker in a run shares
// it; the `??=` prevents a worker from overwriting the inherited value when it
// re-evaluates this config file.
process.env.TODOIST_TEST_RUN_ID ??= Date.now().toString(36);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Capped everywhere: each worker creates its own project, and the free
  // Todoist plan limits an account to 5 active projects. Left at `undefined`
  // locally, Playwright would default to half the logical cores, which sits
  // exactly on (or over) that cap on anything with 10+ cores — so pin it
  // below the limit instead of relying on the machine's core count.
  workers: process.env.CI ? 2 : 3,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalTeardown: './src/global-teardown.ts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./reporting/summary-reporter.ts'],
  ],
});
