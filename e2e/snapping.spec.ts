import { expect, test, type Locator, type Page } from './korean-test.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const SOURCE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font:16px Arial}.board{position:relative;width:900px;height:1000px}.item{position:absolute;box-sizing:border-box;background:#e9e3ff;padding:10px}
</style></head><body><!-- Preserve this unrelated comment. --><main class="board">
<div id="moving" class="item" style="left:60px;top:80px;width:100px;height:60px">이동 요소</div>
<div id="member" class="item" style="left:180px;top:80px;width:80px;height:60px">동행 요소</div>
<div id="target" class="item" style="left:300px;top:260px;width:100px;height:60px">기준 요소</div>
</main><script>window.originalScript = true;</script></body></html>`;
let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pagecraft-snapping-'));
  server = createHtmlEditorServer({ root });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  if (root) await rm(root, { recursive: true, force: true });
});

async function bounds(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}
async function position(page: Page, scale = 1) {
  await page.locator('#zoom-reset').click();
  if (scale === .5) { await page.locator('#zoom-out').click(); await page.locator('#zoom-out').click(); }
  await expect(page.locator('#zoom-value')).toHaveText(`${scale * 100}%`);
  const canvas = await bounds(page.locator('#canvas'));
  const preview = await bounds(page.locator('#preview'));
  const x = canvas.x + canvas.width / 2, y = canvas.y + canvas.height / 2;
  await page.locator('#canvas').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + canvas.x + 28 - preview.x, y + canvas.y + 28 - preview.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
}
async function open(page: Page, name: string, source = SOURCE, scale = 1) {
  await writeFile(join(root, name), source);
  await page.goto(`${baseURL}/?file=${name}`);
  await expect(page.locator('#filename')).toHaveText(name);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await position(page, scale);
}
async function startDrag(page: Page, selector: string, dx: number, dy: number, scale = 1) {
  const rect = await bounds(page.frameLocator('#preview').locator(selector));
  const x = rect.x + 12 * scale, y = rect.y + 12 * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 8 });
  return { x, y };
}
async function save(page: Page) {
  const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
  await page.locator('#save').click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
}

for (const scale of [1, .5]) test(`snaps edges at ${scale * 100}% and saves one reversible source edit`, async ({ page }) => {
  const name = `edges-${scale}.html`;
  await open(page, name, SOURCE, scale);
  await startDrag(page, '#moving', 137, 123, scale);
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(2);
  const moving = page.frameLocator('#preview').locator('#moving');
  await expect(moving).toHaveCSS('translate', '140px 120px');
  await page.mouse.up();
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(moving).toHaveCSS('translate', 'none');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(moving).toHaveCSS('translate', '140px 120px');
  await save(page);
  const source = await readFile(join(root, name), 'utf8');
  expect(source).toContain('<!-- Preserve this unrelated comment. -->');
  expect(source).toContain('<script>window.originalScript = true;</script>');
  expect(source).not.toMatch(/snap-guide|data-muse-|contenteditable/);
  await page.reload();
  await expect(page.frameLocator('#preview').locator('#moving')).toHaveCSS('translate', '140px 120px');
});

test('snaps a multi-selection as one box and preserves its internal spacing', async ({ page }) => {
  await open(page, 'multiple.html');
  const preview = page.frameLocator('#preview');
  await preview.locator('#moving').click();
  await preview.locator('#member').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await startDrag(page, '#moving', 37, 123);
  await page.mouse.up();
  await expect(preview.locator('#moving')).toHaveCSS('translate', '40px 120px');
  await expect(preview.locator('#member')).toHaveCSS('translate', '40px 120px');
  await page.locator('#undo').click();
  await expect(preview.locator('#moving')).toHaveCSS('translate', 'none');
  await expect(preview.locator('#member')).toHaveCSS('translate', 'none');
  await expect(page.locator('#undo')).toBeDisabled();
});

for (const scale of [1, .5]) test(`center snapping uses a six-screen-pixel threshold at ${scale * 100}%`, async ({ page }) => {
  const source = SOURCE.replace('left:300px;top:260px;width:100px;height:60px', 'left:300px;top:260px;width:300px;height:300px');
  await open(page, `centers-${scale}.html`, source, scale);
  const moving = page.frameLocator('#preview').locator('#moving');
  await startDrag(page, '#moving', 340 - 5 / scale, 300 + 5 / scale, scale);
  await expect(moving).toHaveCSS('translate', '340px 300px');
  await page.mouse.up();
  await page.locator('#undo').click();
  const dx = 340 - 7 / scale, dy = 300 + 7 / scale;
  await startDrag(page, '#moving', dx, dy, scale);
  await expect(moving).toHaveCSS('translate', `${dx}px ${dy}px`);
  await page.mouse.up();
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(0);
});

test('Alt bypasses snapping during a drag and Shift keeps the other axis fixed', async ({ page }) => {
  await open(page, 'modifiers.html', SOURCE.replace('top:260px', 'top:84px'));
  const moving = page.frameLocator('#preview').locator('#moving');
  await page.keyboard.down('Shift');
  await startDrag(page, '#moving', 137, 7);
  await expect(moving).toHaveCSS('translate', /^140px(?: 0px)?$/);
  await expect(page.locator('.snap-guide-y')).toBeHidden();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.locator('#undo').click();

  const start = await startDrag(page, '#moving', 137, 7);
  await expect(moving).toHaveCSS('translate', '140px 4px');
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x + 138, start.y + 8);
  await expect(moving).toHaveCSS('translate', '138px 8px');
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up('Alt');
});

test('toggle persists without dirtying HTML and allows exact free movement', async ({ page }) => {
  await open(page, 'toggle.html');
  await page.getByRole('button', { name: '드래그 자동 정렬', exact: true }).click();
  await expect(page.locator('#snap-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readFile(join(root, 'toggle.html'), 'utf8')).toBe(SOURCE);
  await page.reload();
  await expect(page.locator('#snap-toggle')).toHaveAttribute('aria-pressed', 'false');
  await position(page);
  await startDrag(page, '#moving', 137, 123);
  await page.mouse.up();
  await expect(page.frameLocator('#preview').locator('#moving')).toHaveCSS('translate', '137px 123px');
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(0);
});

test('Escape cancels a snapped drag and clears its guides and undo entry', async ({ page }) => {
  await open(page, 'cancel.html');
  await startDrag(page, '#moving', 137, 123);
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.frameLocator('#preview').locator('#moving')).toHaveCSS('translate', 'none');
  await expect(page.locator('.snap-guide:not([hidden])')).toHaveCount(0);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#save')).toBeDisabled();
});

test('snaps near the end of a 10,000-node document with bounded stationary geometry reads', async ({ page }, testInfo) => {
  const filler = Array.from({ length: 9996 }, (_, index) => `<div class="filler" id="filler-${index}" style="position:absolute;left:0;top:2000px;width:20px;height:20px">${index}</div>`).join('');
  const source = SOURCE.replace('<div id="moving"', filler + '<div id="moving"');
  await open(page, 'dense.html', source);
  const moving = page.frameLocator('#preview').locator('#moving');
  await moving.click();
  await page.frameLocator('#preview').locator('html').evaluate((html) => {
    const win = html.ownerDocument.defaultView! as Window & typeof globalThis & { snapReads?: Record<string, number> };
    const original = win.Element.prototype.getBoundingClientRect;
    win.snapReads = {};
    win.Element.prototype.getBoundingClientRect = function () {
      const key = this.id || this.localName;
      win.snapReads![key] = (win.snapReads![key] || 0) + 1;
      return original.call(this);
    };
  });
  await startDrag(page, '#moving', 137, 123);
  await expect(moving).toHaveCSS('translate', '140px 120px');
  const before = await page.frameLocator('#preview').locator('html').evaluate((html) => {
    const reads = (html.ownerDocument.defaultView! as unknown as Window & { snapReads: Record<string, number> }).snapReads;
    return Object.fromEntries(Object.entries(reads).filter(([id]) => id !== 'moving'));
  });
  const count = Object.values(before).reduce((sum, item) => sum + item, 0);
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(200);
  const rect = await bounds(moving);
  await page.mouse.move(rect.x + 14, rect.y + 12, { steps: 12 });
  const after = await page.frameLocator('#preview').locator('html').evaluate((html) => {
    const reads = (html.ownerDocument.defaultView! as unknown as Window & { snapReads: Record<string, number> }).snapReads;
    return Object.fromEntries(Object.entries(reads).filter(([id]) => id !== 'moving'));
  });
  expect(after).toEqual(before);
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(2);
  await testInfo.attach('snapping-geometry', { body: JSON.stringify({ totalNodes: 10000, stationaryRectReads: count, subsequentMoveReads: 0 }), contentType: 'application/json' });
});
