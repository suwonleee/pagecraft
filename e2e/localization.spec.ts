import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../src/static-server.js';

let server: Server;
let baseURL: string;
test.beforeAll(async () => {
  server = createStaticServer({ root: fileURLToPath(new URL('../web-dist/', import.meta.url)) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

for (const locale of [
  { code: 'zh-CN', start: '从报告开始', title: '产品运营周报', decision: '更好的报告编辑方式', sample: '找到属于您的周末。', prompt: '请创建一份 HTML 报告', invalid: '请选择 HTML 文件（.html 或 .htm）。' },
  { code: 'ja', start: 'レポートから始める', title: 'プロダクト運用週次レポート', decision: 'レポート編集をより良くする', sample: '自分らしい週末を見つけよう。', prompt: 'Pagecraft で人が編集でき', invalid: 'HTML ファイル（.html または .htm）を選択してください。' },
]) {
  test(`${locale.code} persists, exports Unicode, and protects unsaved edits during a language change`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
    await page.locator('#language').selectOption(locale.code);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.code);
    await page.reload();
    await expect(page.getByRole('button', { name: locale.start, exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('pagecraft-language'))).toBe(locale.code);
    await page.locator('#file-input').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
    await expect(page.locator('#toast')).toHaveText(locale.invalid);
    await page.locator('#welcome-report').click();
    await expect(page.locator('#report-prompt')).toHaveValue(new RegExp(`^${locale.prompt}`));
    await page.locator('[data-report-template="weekly"]').click();
    const preview = page.frameLocator('#preview');
    await expect(preview.locator('#weekly-title')).toHaveText(locale.title);
    await preview.locator('#weekly-title').click();
    const text = 'My report · 한국어 · 中文 · 日本語 <keep> & {0}';
    await page.locator('#text-value').fill(text);
    await page.locator('#text-value').press('Tab');
    await expect(preview.locator('#weekly-title')).toHaveText(text);
    await page.locator('#language').selectOption('en');
    await page.locator('#discard-cancel').click();
    await expect(page.locator('#language')).toHaveValue(locale.code);
    await expect(preview.locator('#weekly-title')).toHaveText(text);
    const pending = page.waitForEvent('download');
    await page.locator('#save').click();
    const html = await readFile((await (await pending).path())!, 'utf8');
    expect(html).toContain('My report · 한국어 · 中文 · 日本語 &lt;keep&gt; &amp; {0}');
    expect(html).toContain(`lang="${locale.code}"`);
    expect(html).toContain('@media print');
    expect(html).not.toContain('data-muse-edit-id');
    await page.locator('#language').selectOption('en');
    await page.locator('#discard-confirm').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('#file-input').setInputFiles({ name: 'saved.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    await expect(preview.locator('#weekly-title')).toHaveText(text);
    await expect(preview.locator('html')).toHaveAttribute('lang', locale.code);
    expect(errors).toEqual([]);
  });

  test(`${locale.code} opens the localized sample and decision report with the origin offline`, async ({ page }) => {
    await page.goto(baseURL);
    await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
    await page.locator('#language').selectOption(locale.code);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.code);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    const port = (server.address() as AddressInfo).port;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      expect(await page.evaluate(async () => {
        try { await fetch('./uncached-locale-probe', { cache: 'no-store' }); return false; } catch { return true; }
      })).toBe(true);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', locale.code);
      await page.locator('#try-sample').click();
      await expect(page.frameLocator('#preview').locator('#hero-title')).toHaveText(locale.sample);
      await page.frameLocator('#preview').locator('#hero-title').click();
      await page.locator('#text-value').fill('Offline edit · 中文 · 日本語');
      await page.locator('#text-value').press('Tab');
      await page.locator('#new-report').click();
      await page.locator('[data-report-template="decision"]').click();
      await page.locator('#discard-confirm').click();
      await expect(page.frameLocator('#preview').locator('#decision-title')).toHaveText(locale.decision);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
    }
  });

  test(`${locale.code} fits the language selector and report dialog on a narrow screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseURL);
    await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
    await page.locator('#language').selectOption(locale.code);
    await expect(page.getByRole('button', { name: locale.start, exact: true })).toBeVisible();
    await expect(page.locator('#language')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.locator('#welcome-report').click();
    const bounds = await page.locator('#report-dialog').boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.height).toBeLessThanOrEqual(844);
  });
}

test('unknown stored language falls back to English and can be replaced', async ({ page }) => {
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.setItem('pagecraft-language', 'constructor'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
  await page.locator('#language').selectOption('ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});
