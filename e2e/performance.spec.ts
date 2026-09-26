import { expect, test } from './korean-test.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const ROWS = 2000;
const SOURCE = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:24px;font:16px Arial}p{margin:0;height:28px}</style></head><body><main>'
  + Array.from({ length: ROWS }, (_, index) => `<p id="row-${index}">기획 문구 ${String(index).padStart(4, '0')}</p>`).join('')
  + '</main></body></html>';

let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'muse-editor-performance-'));
  await Promise.all(['navigation.html', 'undo.html', 'marquee.html'].map((file) => writeFile(join(root, file), SOURCE, 'utf8')));
  server = createHtmlEditorServer({ root });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test('keeps a 2,001-node document navigable with a bounded layer DOM and saves without reloading the preview', async ({ page }, testInfo) => {
  const started = performance.now();
  await page.goto(`${baseURL}/?file=navigation.html`);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#node-count')).toHaveText(String(ROWS + 1));
  const readyMs = performance.now() - started;
  const initialMetrics = await page.evaluate(() => ({
    layerButtons: document.querySelectorAll('#layers .layer').length,
    layerDescendants: document.querySelector('#layers')!.querySelectorAll('*').length,
  }));
  expect(initialMetrics.layerButtons).toBeGreaterThan(0);
  expect(initialMetrics.layerButtons).toBeLessThan(80);
  expect(initialMetrics.layerDescendants).toBeLessThan(250);

  const first = page.locator('#layers .layer').first();
  await first.focus();
  await page.keyboard.press('End');
  const last = page.locator('#layers .layer.active');
  await expect(last).toContainText('기획 문구 1999');
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-posinset', String(ROWS + 1));
  await expect(page.getByLabel('선택한 요소의 문구')).toHaveValue('기획 문구 1999');
  expect(await page.locator('#layers .layer').count()).toBeLessThan(80);

  await page.getByLabel('선택한 요소의 문구').fill('마지막 요소를 수정했습니다');
  await expect(last).toContainText('마지막 요소를 수정했습니다');
  await expect(last).toHaveClass(/dirty/);
  await page.getByLabel('요소 검색').fill('마지막 요소');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await page.getByLabel('요소 검색').fill('찾을 수 없는 문구');
  await expect(page.locator('#layers .layer')).toHaveCount(0);
  await expect(page.locator('.layers-empty')).toBeVisible();
  await page.getByLabel('요소 검색').fill('마지막 요소');
  await expect(page.locator('#layers .layer')).toHaveCount(1);

  const preview = page.frameLocator('#preview');
  await preview.locator('html').evaluate((html) => { (html as HTMLElement).dataset.testDocumentIdentity = 'retained'; });
  const requests: string[] = [];
  page.on('request', (request) => { requests.push(new URL(request.url()).pathname); });
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/save') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '파일에 저장' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(preview.locator('html')).toHaveAttribute('data-test-document-identity', 'retained');
  await expect(page.getByLabel('선택한 요소의 문구')).toHaveValue('마지막 요소를 수정했습니다');
  expect(requests.filter((path) => path === '/api/document' || path.startsWith('/preview/'))).toEqual([]);
  const contents = await readFile(join(root, 'navigation.html'), 'utf8');
  expect(contents).toBe(SOURCE.replace('기획 문구 1999', '마지막 요소를 수정했습니다'));

  await testInfo.attach('large-document-metrics', {
    body: JSON.stringify({ sourceBytes: Buffer.byteLength(SOURCE), editableNodes: ROWS + 1, readyMs, ...initialMetrics }, null, 2),
    contentType: 'application/json',
  });
});

test('undo touches only edited preview elements and preserves virtual-list keyboard behavior', async ({ page }, testInfo) => {
  await page.goto(`${baseURL}/?file=undo.html`);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.getByLabel('요소 검색').fill('기획 문구 0000');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await page.locator('#layers .layer').click();
  await page.getByLabel('선택한 요소의 문구').fill('처음 수정');
  await page.getByLabel('요소 검색').fill('기획 문구 1999');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await expect(page.locator('#layers .layer')).toContainText('기획 문구 1999');
  await page.locator('#layers .layer').click();
  await page.getByLabel('선택한 요소의 문구').fill('마지막 수정');
  await page.getByLabel('요소 검색').fill('');
  await expect(page.locator('#layers .layer.active')).toContainText('마지막 수정');

  const result = await page.evaluate(() => {
    const preview = (document.querySelector('#preview') as HTMLIFrameElement).contentDocument!;
    const observer = new MutationObserver(() => undefined);
    observer.observe(preview.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const started = performance.now();
    (document.querySelector('#undo') as HTMLButtonElement).click();
    const undoMs = performance.now() - started;
    const mutations = observer.takeRecords();
    observer.disconnect();
    const targetIds = [...new Set(mutations.map((mutation) => {
      // Elements belong to the iframe realm, so use nodeType instead of instanceof Element.
      const element = mutation.target.nodeType === 1 ? mutation.target as Element : mutation.target.parentElement;
      return element?.id;
    }))];
    return { undoMs, mutations: mutations.length, targetIds };
  });
  expect(result.targetIds.length).toBeGreaterThan(0);
  expect(result.targetIds).toEqual(['row-1999']);
  expect(result.mutations).toBeLessThan(12);
  await expect(page.frameLocator('#preview').locator('#row-0')).toHaveText('처음 수정');
  await expect(page.frameLocator('#preview').locator('#row-1999')).toHaveText('기획 문구 1999');
  await expect(page.locator('#layers .layer.active')).toContainText('기획 문구 1999');
  await page.locator('#layers .layer.active').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#layers .layer.active')).toContainText('기획 문구 1998');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
  await page.keyboard.press('Home');
  await expect(page.locator('#layers .layer.active')).toContainText('main');
  await expect(page.locator('#layers .layer.active')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
  await expect(page.frameLocator('#preview').locator('main')).toHaveCSS('translate', 'none');
  await page.keyboard.press('Space');
  await expect(page.locator('#tool-hand')).not.toHaveClass(/active/);
  expect(await page.locator('#layers .layer').count()).toBeLessThan(80);
  await testInfo.attach('undo-metrics', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

type GeometryAuditWindow = Window & {
  __pagecraftGeometryAudit: {
    snapshot(): { total: number; unique: number; lastRow: number };
    restore(): void;
  };
};

test('blank clicks avoid whole-document geometry reads until a real marquee drag begins', async ({ page }, testInfo) => {
  await page.goto(`${baseURL}/?file=marquee.html`);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#node-count')).toHaveText(String(ROWS + 1));
  const canvas = await page.locator('#canvas').boundingBox();
  const firstRow = await page.frameLocator('#preview').locator('#row-0').boundingBox();
  expect(canvas).not.toBeNull();
  expect(firstRow).not.toBeNull();
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const frame = document.querySelector('#preview') as HTMLIFrameElement;
    const view = frame.contentWindow as Window & typeof globalThis;
    const prototype = view.Element.prototype;
    const original = prototype.getBoundingClientRect;
    const calls = new Map<string, number>();
    const lastId = frame.contentDocument!.querySelector('#row-1999')!.getAttribute('data-muse-edit-id')!;
    prototype.getBoundingClientRect = function (this: Element) {
      const id = this.getAttribute('data-muse-edit-id');
      if (id) calls.set(id, (calls.get(id) ?? 0) + 1);
      return original.call(this);
    };
    (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit = {
      snapshot: () => ({ total: [...calls.values()].reduce((sum, count) => sum + count, 0), unique: calls.size, lastRow: calls.get(lastId) ?? 0 }),
      restore: () => { prototype.getBoundingClientRect = original; },
    };
  });
  try {
    const start = { x: canvas!.x + 8, y: canvas!.y + 8 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    expect(await page.evaluate(() => (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit.snapshot())).toEqual({ total: 0, unique: 0, lastRow: 0 });
    await page.mouse.move(start.x + 2, start.y + 1);
    expect(await page.evaluate(() => (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit.snapshot())).toEqual({ total: 0, unique: 0, lastRow: 0 });
    await page.mouse.up();
    await expect(page.locator('#selection-count')).toHaveText('선택 없음');

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(firstRow!.x + firstRow!.width + 1, firstRow!.y + firstRow!.height + 1, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#selection-count')).toHaveText('1개 선택');
    await expect(page.getByLabel('선택한 요소의 문구')).toHaveValue('기획 문구 0000');
    const geometry = await page.evaluate(() => (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit.snapshot());
    expect(geometry.unique).toBe(ROWS + 1);
    expect(geometry.lastRow).toBe(1);
    expect(geometry.total).toBeLessThan(ROWS + 30);
    await expect(page.locator('#save')).toBeDisabled();
    await expect(page.locator('#undo')).toBeDisabled();
    expect(await readFile(join(root, 'marquee.html'), 'utf8')).toBe(SOURCE);
    await testInfo.attach('marquee-geometry-metrics', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  } finally {
    await page.mouse.up();
    await page.evaluate(() => (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit.restore());
  }
});

test('camera navigation retains selection outlines without remeasuring document elements', async ({ page }) => {
  await page.goto(`${baseURL}/?file=marquee.html`);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.locator('#preview').evaluate((frame) => {
    const preview = (frame as HTMLIFrameElement).contentDocument!;
    const view = preview.defaultView as Window & typeof globalThis;
    for (let index = 0; index < 100; index++) {
      preview.querySelector(`#row-${index}`)!.dispatchEvent(new view.MouseEvent('click', { bubbles: true, shiftKey: index > 0 }));
    }
  });
  await expect(page.locator('#selection-count')).toHaveText('100개 선택');
  await expect(page.locator('.multi-selection-outline')).toHaveCount(100);
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const preview = (document.querySelector('#preview') as HTMLIFrameElement).contentDocument!;
    const prototype = (preview.defaultView as Window & typeof globalThis).Element.prototype;
    const original = prototype.getBoundingClientRect;
    let total = 0;
    prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute('data-muse-edit-id')) total++;
      return original.call(this);
    };
    (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit = {
      snapshot: () => ({ total, unique: 0, lastRow: 0 }),
      restore: () => { prototype.getBoundingClientRect = original; },
    };
  });
  try {
    await page.evaluate(async () => {
      const canvas = document.querySelector('#canvas')!;
      for (let index = 0; index < 12; index++) {
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: index < 6 ? 8 : -8, bubbles: true, cancelable: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
    });
    await page.locator('#zoom-in').click();
    await page.locator('#zoom-out').click();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit.snapshot().total)).toBe(0);

    // Both boxes must still occupy the same screen coordinates after camera changes.
    const element = await page.frameLocator('#preview').locator('#row-0').boundingBox();
    const outline = await page.locator('.multi-selection-outline').first().boundingBox();
    expect(element).not.toBeNull();
    expect(outline).not.toBeNull();
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(element![key] - outline![key])).toBeLessThan(1);

    // Actual document changes must continue to update the selection box.
    await page.frameLocator('#preview').locator('#row-0').evaluate(element => (element as HTMLElement).click());
    await page.locator('[data-style="width"]').fill('300px');
    await expect(page.locator('#selection-box')).toHaveCSS('width', '300px');
    await expect(page.frameLocator('#preview').locator('#row-0')).toHaveCSS('width', '300px');
    await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
  } finally {
    await page.evaluate(() => (window as unknown as GeometryAuditWindow).__pagecraftGeometryAudit.restore());
  }
});
