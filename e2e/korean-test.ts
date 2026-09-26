import { test as base } from '@playwright/test';
export { expect, chromium } from '@playwright/test';
export type { Download, Page, BrowserContext, Worker, Locator } from '@playwright/test';
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      // Preference belongs only to the app; opaque previews and initial blank tabs have no storage.
      if (window !== window.top || !['http:', 'https:', 'chrome-extension:'].includes(location.protocol)) return;
      localStorage.setItem('pagecraft-language', 'ko');
    });
    await use(page);
  },
});
