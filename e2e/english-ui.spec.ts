import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
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

test('English first run edits, downloads, and reopens a report without changing its print rules', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Start with a report', exact: true })).toBeVisible();
  const screenshots = process.env.PAGECRAFT_SCREENSHOTS === '1' && ['chrome', 'chromium'].includes(info.project.name);
  const capture = async (name: string) => {
    if (!screenshots) return;
    const directory = new URL('../docs/images/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL(name, directory)), animations: 'disabled' });
  };
  await capture('start.png');
  await page.getByRole('button', { name: 'Start with a report', exact: true }).click();
  await expect(page.locator('#report-prompt')).toHaveValue(/^Create an HTML report/);
  await capture('report-templates.png');
  await page.locator('[data-report-template="weekly"]').click();
  const report = page.frameLocator('#preview');
  await expect(report.locator('#weekly-title')).toHaveText('Product operations weekly report');
  await report.locator('#weekly-title').click();
  await page.getByLabel('Selected element text', { exact: true }).fill('A clearer update. In your own words.');
  await page.getByLabel('Font size', { exact: true }).fill('32px');
  await page.getByLabel('Font size', { exact: true }).press('Tab');
  await expect(report.locator('#weekly-title')).toHaveText('A clearer update. In your own words.');
  await expect(page.locator('#save')).toBeEnabled();
  await capture('edit-report.png');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download HTML/ }).click();
  const download = await pending;
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain('A clearer update. In your own words.');
  expect(html).toContain('id="weekly-summary-lead"');
  expect(html).toContain('@media print');
  expect(html).toContain('Fictional example.');
  expect(html).not.toContain('data-muse-edit-id');
  const original = await readFile(new URL('../fixtures/reports/weekly-report.html', import.meta.url), 'utf8');
  expect(html.match(/<style>[\s\S]*?<\/style>/)?.[0]).toBe(original.match(/<style>[\s\S]*?<\/style>/)?.[0]);
  await page.locator('#file-input').setInputFiles({ name: 'reviewed-report.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await page.getByRole('button', { name: 'Discard and open', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('reviewed-report.html');
  await expect(report.locator('#weekly-title')).toHaveText('A clearer update. In your own words.');
  expect(errors).toEqual([]);
});

test('language choice persists and cancelling a switch preserves unsaved document text', async ({ page }) => {
  await page.goto(baseURL);
  await expect(page.locator('#save-state')).not.toHaveAttribute('data-state', 'loading');
  await page.getByLabel('Language', { exact: true }).selectOption('ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.getByRole('button', { name: '보고서로 시작', exact: true }).click();
  await page.locator('[data-report-template="decision"]').click();
  const report = page.frameLocator('#preview');
  await expect(report.locator('#decision-title')).toHaveText('보고서 편집 도입 검토');
  await report.locator('#decision-title').click();
  await page.getByLabel('선택한 요소의 문구', { exact: true }).fill('Keep my unsaved document — 한글도 보존');
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await page.locator('#discard-cancel').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.locator('#language')).toHaveValue('ko');
  await expect(report.locator('#decision-title')).toHaveText('Keep my unsaved document — 한글도 보존');
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await page.locator('#discard-confirm').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Start with a report', exact: true })).toBeVisible();
});

test('English shell works on a narrow screen and stays usable when preferences are blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL);
  await expect(page.getByRole('button', { name: 'Start with a report', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.getByLabel('Language', { exact: true }).selectOption('ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#toast')).toHaveText('Allow browser storage to remember your language.');
});

test('the English sample can be revised and exported as an ordinary landing page', async ({ page }, info) => {
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'Try the sample', exact: true }).click();
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#hero-title')).toHaveText('Find your kind of weekend.');
  await preview.locator('#hero-title').click();
  await page.getByLabel('Selected element text', { exact: true }).fill('Less scrolling. More exploring.');
  await page.getByLabel('Selected element text', { exact: true }).press('Tab');
  await expect(preview.locator('#hero-title')).toHaveText('Less scrolling. More exploring.');
  if (process.env.PAGECRAFT_SCREENSHOTS === '1' && ['chrome', 'chromium'].includes(info.project.name)) {
    await mkdir(new URL('../docs/images/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../docs/images/edit-landing.png', import.meta.url)), animations: 'disabled' });
  }
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download HTML/ }).click();
  const html = await readFile((await (await pending).path())!, 'utf8');
  expect(html).toContain('Less scrolling. More exploring.');
  expect(html).toContain('Explore this week’s picks');
  expect(html).not.toContain('data-muse-edit-id');
});
