import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ExtensionChrome = {
  runtime: { getManifest(): Record<string, unknown>; getURL(path: string): string };
  tabs: { create(options: { url: string }): Promise<unknown> };
};
type ExtensionScope = typeof globalThis & { chrome: ExtensionChrome };
const extensionPath = fileURLToPath(new URL('../extension-dist/', import.meta.url));
const test = base.extend<{ extensionContext: BrowserContext; extensionWorker: Worker }>({
  extensionContext: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'pagecraft-extension-e2e-'));
    const context = await chromium.launchPersistentContext(profile, {
      // Bundled Chromium supports extension-loading flags; branded Chrome does not.
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1100 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.addInitScript(() => {
      // Preference belongs only to the app; opaque previews and initial blank tabs have no storage.
      if (window !== window.top || !['http:', 'https:', 'chrome-extension:'].includes(location.protocol)) return;
      if (!localStorage.getItem('pagecraft-language')) localStorage.setItem('pagecraft-language', 'ko');
    });
    try { await use(context); }
    finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  },
  extensionWorker: async ({ extensionContext }, use) => {
    const worker = extensionContext.serviceWorkers()[0] || await extensionContext.waitForEvent('serviceworker');
    expect(worker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
    await use(worker);
  },
});

test('loads the permission-free Manifest V3 package without automatically opening a tab', async ({ extensionContext, extensionWorker }) => {
  const manifest = await extensionWorker.evaluate(() => (globalThis as ExtensionScope).chrome.runtime.getManifest());
  expect(manifest).toMatchObject({ manifest_version: 3, name: 'Pagecraft', action: { default_title: 'Open Pagecraft' }, background: { service_worker: 'background.js' } });
  for (const field of ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable']) expect(manifest[field]).toBeUndefined();
  expect(extensionContext.pages().filter((page) => page.url().startsWith('chrome-extension:'))).toHaveLength(0);
});

test('opens an extension tab and edits an HTML copy offline without changing the original source', async ({ extensionContext, extensionWorker }) => {
  const pendingPage = extensionContext.waitForEvent('page');
  // Exercise the same tabs.create operation as the toolbar action. The toolbar UI is browser-owned.
  await extensionWorker.evaluate(() => {
    const chrome = (globalThis as ExtensionScope).chrome;
    return chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  });
  const page = await pendingPage;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#browser-welcome')).toBeVisible();
  await expect(page.locator('#install-app')).toBeHidden();
  await extensionContext.setOffline(true);
  const source = '<!doctype html>\n<html><head><style>body{margin:32px;font-family:sans-serif}</style></head><body><!-- keep --><h1 id="title">Original heading</h1><p data-spacing = "keep">Unchanged paragraph.</p><script>document.body.dataset.executed="yes";</script></body></html>';
  await page.locator('#file-input').setInputFiles({ name: 'extension-fixture.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  await expect(page.locator('#filename')).toHaveText('extension-fixture.html');
  const heading = page.frameLocator('#preview').locator('#title');
  await expect(heading).toHaveText('Original heading');
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-executed', 'yes');
  await heading.click();
  await page.getByLabel('선택한 요소의 텍스트').fill('Edited from the extension');
  await expect(heading).toHaveText('Edited from the extension');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('extension-fixture.html');
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const output = Buffer.concat(chunks).toString('utf8');
  expect(output).toBe(source.replace('Original heading', 'Edited from the extension'));
  expect(output).not.toContain('data-muse-edit-id');
  await expect(page.locator('#save-state')).toContainText('저장 전');
  expect(errors).toEqual([]);
});

test('opens a bundled report offline and exports a fresh template without requiring an edit', async ({ extensionContext, extensionWorker }) => {
  const url = await extensionWorker.evaluate(() => (globalThis as ExtensionScope).chrome.runtime.getURL('index.html'));
  const page = await extensionContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await extensionContext.setOffline(true);
  await page.locator('#welcome-report').click();
  await page.locator('[data-report-template="decision"]').click();
  await expect(page.locator('#filename')).toHaveText('의사결정-보고서.html');
  await expect(page.frameLocator('#preview').locator('#decision-title')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.locator('#save').click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const source = Buffer.concat(chunks).toString('utf8');
  expect(source).toContain('id="decision-title"');
  expect(source).toContain('@media print');
  expect(source).not.toContain('data-muse-edit-id');
  expect(errors).toEqual([]);
});

for (const [locale, title] of [['zh-CN', '更好的报告编辑方式'], ['ja', 'レポート編集をより良くする']] as const) {
  test(`switches to ${locale} and loads its packaged report offline`, async ({ extensionContext, extensionWorker }) => {
    const url = await extensionWorker.evaluate(() => (globalThis as ExtensionScope).chrome.runtime.getURL('index.html'));
    const page = await extensionContext.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
    await extensionContext.setOffline(true);
    await page.locator('#language').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.locator('#welcome-report').click();
    await page.locator('[data-report-template="decision"]').click();
    await expect(page.frameLocator('#preview').locator('#decision-title')).toHaveText(title);
    expect(errors).toEqual([]);
  });
}
