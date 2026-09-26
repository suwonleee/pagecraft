import { defineConfig } from '@playwright/test';

// Opt in where Aside is installed; ordinary development/CI still needs only Chrome.
const asideExecutable = process.env.PAGECRAFT_ASIDE_PATH;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/browser-mode.spec.ts', '**/english-ui.spec.ts', '**/localization.spec.ts', '**/extension.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  outputDir: './test-results',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1100 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: process.env.CI ? 'chromium' : 'chrome', use: { channel: process.env.CI ? 'chromium' : 'chrome' } },
    ...(asideExecutable ? [{
      name: 'aside',
      use: { launchOptions: { executablePath: asideExecutable } },
    }] : []),
  ],
});
