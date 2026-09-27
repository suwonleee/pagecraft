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
    await page.locator('#language-cancel').click();
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
    await page.locator('#language-confirm').click();
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
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    // Language reload can overlap first activation: ready does not imply this
    // document is controlled, and an already-active worker may not claim again.
    // Navigate through the active worker before taking the actual origin offline.
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
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

for (const locale of [
  { code: 'en', label: 'Editor language', change: 'Change language', cancel: 'Cancel', padding: 'Space inside the border', flex: 'Row or column (flex)' },
  { code: 'ko', label: '편집기 언어', change: '언어 변경', cancel: '취소', padding: '테두리 안쪽의 여백', flex: '가로·세로 배치 (flex)' },
  { code: 'zh-CN', label: '编辑器语言', change: '更改语言', cancel: '取消', padding: '边框内侧的间距', flex: '按行或列排列（flex）' },
  { code: 'ja', label: 'エディターの言語', change: '言語を変更', cancel: 'キャンセル', padding: '境界線の内側の余白', flex: '横・縦に並べる（flex）' },
]) {
  test(`${locale.code} explains language changes for clean documents and preserves the file on Escape`, async ({ page }) => {
    await page.goto(baseURL);
    await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
    await page.locator('#language').selectOption(locale.code);
    const language = page.getByRole('combobox', { name: locale.label, exact: true });
    await expect(language).toHaveValue(locale.code);
    for (const code of ['en', 'ko', 'zh-CN', 'ja']) {
      await expect(language.locator(`option[value="${code}"]`)).toHaveAttribute('lang', code);
    }
    const source = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>My document</title></head><body><h1 id="title">My unchanged document · 한국어 · 中文 · 日本語</h1></body></html>';
    await page.locator('#file-input').setInputFiles({ name: 'original.html', mimeType: 'text/html', buffer: Buffer.from(source) });
    const heading = page.frameLocator('#preview').locator('#title');
    await expect(heading).toHaveText('My unchanged document · 한국어 · 中文 · 日本語');
    await expect(page.locator('#save')).toBeDisabled();
    await language.selectOption(locale.code === 'en' ? 'ko' : 'en');
    await expect(page.locator('#language-dialog')).toBeVisible();
    await expect(page.locator('#language-confirm')).toHaveText(locale.change);
    await expect(page.locator('#language-cancel')).toHaveText(locale.cancel);
    await expect(page.locator('#language-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(language).toBeFocused();
    await expect(language).toHaveValue(locale.code);
    await expect(heading).toHaveText('My unchanged document · 한국어 · 中文 · 日本語');
    await expect(page.locator('#save')).toBeDisabled();
    await heading.click();
    await expect(page.locator('[data-style="padding"]')).toHaveAccessibleDescription(locale.padding);
    await expect(page.locator('[data-style="display"] option[value="flex"]')).toHaveText(locale.flex);
    await page.locator('[data-style="display"]').selectOption('flex');
    await page.locator('[data-style="flex-direction"]').selectOption('column');
    await expect(heading).toHaveCSS('display', 'flex');
    await expect(heading).toHaveCSS('flex-direction', 'column');
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    await expect(page.locator('#save')).toBeDisabled();
    await expect(heading).toHaveCSS('display', 'block');
    await expect(heading).toHaveText('My unchanged document · 한국어 · 中文 · 日本語');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(language).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await language.selectOption(locale.code === 'en' ? 'ko' : 'en');
    await expect(page.locator('#language-cancel')).toBeInViewport();
    await expect(page.locator('#language-confirm')).toBeInViewport();
    await page.locator('#language-confirm').click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale.code === 'en' ? 'ko' : 'en');
    await expect(page.locator('#welcome-report')).toBeVisible();
  });
}

test('layout direction labels follow vertical writing and mixed selections without editing the document', async ({ page }) => {
  await page.goto(baseURL);
  const source = '<!doctype html><html><body><div id="vertical" style="display:flex;writing-mode:vertical-rl">Vertical text</div><div id="horizontal" style="display:flex">Horizontal text</div></body></html>';
  await page.locator('#file-input').setInputFiles({ name: 'writing-modes.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  const preview = page.frameLocator('#preview');
  const direction = page.getByRole('combobox', { name: 'Layout direction', exact: true });
  await preview.locator('#vertical').click();
  await expect(direction.locator('[value="row"]')).toHaveText('Vertical (row)');
  await expect(direction.locator('[value="column"]')).toHaveText('Horizontal (column)');
  await preview.locator('#horizontal').click({ modifiers: ['Shift'] });
  await expect(direction.locator('[value="row"]')).toHaveText('Row (text direction)');
  await expect(direction.locator('[value="column"]')).toHaveText('Column (across text)');
  await preview.locator('#horizontal').click();
  await expect(direction.locator('[value="row"]')).toHaveText('Horizontal (row)');
  await expect(direction.locator('[value="column"]')).toHaveText('Vertical (column)');
  await expect(page.locator('#save')).toBeDisabled();
});
