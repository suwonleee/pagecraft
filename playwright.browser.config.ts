import { defineConfig } from '@playwright/test';

const asideExecutable = process.env.PAGECRAFT_ASIDE_PATH;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['browser-mode.spec.ts', 'english-ui.spec.ts', 'localization.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  outputDir: './test-results/browser-mode',
  use: {
    headless: true,
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: process.env.CI ? 'chromium' : 'chrome', use: { browserName: 'chromium', channel: process.env.CI ? 'chromium' : 'chrome' } },
    ...(asideExecutable ? [{
      name: 'aside',
      use: { browserName: 'chromium' as const, launchOptions: { executablePath: asideExecutable } },
    }] : []),
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
