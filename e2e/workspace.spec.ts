import { expect, test, type Page } from './korean-test.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const SOURCE = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:48px;font-family:Arial}h1{font-size:32px}article{height:200px;background:#ece7fb}</style></head><body><h1 id="heading">편집할 제목</h1><article>선택할 카드</article></body></html>';
let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'muse-workspace-'));
  await writeFile(join(root, '기획서.html'), SOURCE);
  server = createHtmlEditorServer({ root });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (root) await rm(root, { recursive: true, force: true });
});
async function open(page: Page) {
  await page.goto(baseURL);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
}
async function canvasWidth(page: Page) {
  return page.locator('#canvas').evaluate((element) => element.getBoundingClientRect().width);
}

test('desktop panels collapse, restore view preferences, and keep document edits intact', async ({ page }) => {
  await open(page);
  const before = await canvasWidth(page);
  await page.frameLocator('#preview').locator('#heading').click();
  await page.getByLabel('선택한 요소의 문구').fill('저장 전 편집');
  await expect(page.locator('#save-state')).toContainText('저장 전');
  await page.getByRole('button', { name: '파일·요소', exact: true }).click();
  await page.getByRole('button', { name: '속성', exact: true }).click();
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeHidden();
  expect(await canvasWidth(page)).toBeGreaterThan(before + 500);
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('저장 전 편집');
  await expect(page.locator('#undo')).toBeEnabled();
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
  await page.locator('#undo').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.reload();
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeHidden();
  await page.getByRole('button', { name: '파일·요소', exact: true }).click();
  await page.getByRole('button', { name: '속성', exact: true }).click();
  await expect(page.locator('#files-panel')).toBeVisible();
  await expect(page.locator('#inspector-panel')).toBeVisible();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
});

test('small screens retain visible save status and full-width canvas without horizontal page overflow', async ({ page }) => {
  await open(page);
  for (const width of [320, 390, 760, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#save-state')).toBeVisible();
    await expect(page.locator('#toggle-files')).toBeInViewport();
    await expect(page.locator('#toggle-inspector')).toBeInViewport();
    await expect(page.locator('#save')).toBeInViewport();
    await expect(page.locator('#zoom-selection')).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width <= 1120) {
      await expect(page.locator('#files-panel')).toBeHidden();
      await expect(page.locator('#inspector-panel')).toBeHidden();
      await expect.poll(() => canvasWidth(page)).toBe(width);
    }
  }
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
});

test('fresh laptop sessions reserve canvas space and respect an explicit file-panel preference', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeVisible();
  expect(await canvasWidth(page)).toBe(1000);
  await page.locator('#toggle-files').click();
  await expect(page.locator('#files-panel')).toBeVisible();
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#files-panel')).toBeVisible();
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
});

test('canvas focus mode restores the previous panels without changing edits or saved preferences', async ({ page }) => {
  await open(page);
  await page.locator('#toggle-files').click();
  await page.frameLocator('#preview').locator('#heading').click();
  await page.getByLabel('선택한 요소의 문구').fill('집중 모드에서 유지할 편집');
  const preference = await page.evaluate(() => localStorage.getItem('pagecraft.workspace.v1'));
  const before = await canvasWidth(page);
  const focus = page.getByRole('button', { name: '캔버스 집중 모드', exact: true });
  await focus.click();
  await expect(focus).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeHidden();
  expect(await canvasWidth(page)).toBe(before + 280);
  for (const selector of ['#save', '#undo', '#tool-hand', '#zoom-in', '#duplicate-selection']) {
    await expect(page.locator(selector)).toBeInViewport();
  }
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('집중 모드에서 유지할 편집');
  expect(await page.evaluate(() => localStorage.getItem('pagecraft.workspace.v1'))).toBe(preference);
  await focus.click();
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeVisible();
  expect(await canvasWidth(page)).toBe(before);
  await page.locator('#undo').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);

  // Opening a panel while focused exits the temporary view; drawers remain usable.
  await focus.click();
  await page.locator('#toggle-files').click();
  await expect(focus).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#files-panel')).toBeVisible();
  await focus.click();
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('#focus-canvas')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#toggle-inspector').click();
  await expect(page.locator('#inspector-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-panel')).toBeHidden();
});

test('status messages stay below the document and leave editing controls reachable', async ({ page }) => {
  await open(page);
  await page.frameLocator('#preview').locator('#heading').click();
  await page.locator('#duplicate-selection').click();
  await expect(page.locator('#toast')).toBeVisible();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return { canvas: rect('#canvas'), toast: rect('#toast'), zoom: rect('.zoom-controls') };
    });
    expect(bounds.toast.top).toBeGreaterThanOrEqual(bounds.canvas.bottom);
    expect(bounds.toast.top).toBeGreaterThanOrEqual(bounds.zoom.bottom);
    expect(bounds.toast.left).toBeGreaterThanOrEqual(0);
    expect(bounds.toast.right).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator('#zoom-in')).toBeInViewport();
  }
  await page.locator('#undo').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
});

test('short windows retain editing space with contextual actions and a usable resize target', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await open(page);
  const canvasHeight = () => page.locator('#canvas').evaluate((element) => element.getBoundingClientRect().height);
  await expect(page.locator('.selection-toolbar')).toBeHidden();
  expect(await canvasHeight()).toBeGreaterThanOrEqual(160);

  await page.frameLocator('#preview').locator('#heading').click();
  await expect(page.locator('.selection-toolbar')).toBeVisible();
  await expect(page.locator('.alignment-actions')).toBeHidden();
  expect(await canvasHeight()).toBeGreaterThanOrEqual(160);
  const handle = await page.locator('#resize-handle').boundingBox();
  expect(handle).not.toBeNull();
  expect(handle!.width).toBeGreaterThanOrEqual(23.9);
  expect(handle!.height).toBeGreaterThanOrEqual(23.9);

  await page.frameLocator('#preview').locator('article').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await expect(page.locator('.alignment-actions')).toBeVisible();
  expect(await canvasHeight()).toBeGreaterThanOrEqual(160);
  for (const selector of ['#save', '#undo', '#tool-hand', '#toggle-files', '#toggle-inspector', '#zoom-in', '#zoom-out', '#zoom-selection', '[data-align="right"]']) {
    await expect(page.locator(selector)).toBeInViewport();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(667);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
});

test('selection changes keep the canvas in place for the first double-click and drag', async ({ page }) => {
  for (const viewport of [{ width: 667, height: 375 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await open(page);
    // Compare exact free movement so alignment assistance cannot mask a shell jump.
    if (await page.locator('#snap-toggle').getAttribute('aria-pressed') === 'true') {
      await page.getByRole('button', { name: '드래그 자동 정렬', exact: true }).click();
    }
    const canvasTop = () => page.locator('#canvas').evaluate((element) => element.getBoundingClientRect().top);
    const beforeTop = await canvasTop();
    const heading = page.frameLocator('#preview').locator('#heading');
    await heading.dblclick();
    await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only');
    expect(await canvasTop()).toBe(beforeTop);
    await page.keyboard.press('Escape');

    await page.frameLocator('#preview').locator('article').click({ modifiers: ['Shift'], position: { x: 20, y: 20 } });
    await expect(page.locator('#selection-count')).toHaveText('2개 선택');
    expect(await canvasTop()).toBe(beforeTop);
    await page.locator('#canvas').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.selection-toolbar')).toBeHidden();
    expect(await canvasTop()).toBe(beforeTop);

    // Start dragging before any element is selected; compare physical movement,
    // not only CSS translate, so a shell-layout jump cannot mask the regression.
    const before = (await heading.boundingBox())!;
    const start = { x: before.x + 20, y: before.y + before.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 12, { steps: 6 });
    await page.mouse.up();
    const after = (await heading.boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(20, 0);
    expect(after.y - before.y).toBeCloseTo(12, 0);
    expect(await canvasTop()).toBe(beforeTop);
    await page.locator('#undo').click();
    await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  }
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
});

test('narrow panels open one at a time, close with Escape, and reveal selected elements', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await open(page);
  await page.locator('#toggle-files').click();
  await expect(page.locator('#files-panel')).toBeVisible();
  await expect(page.locator('#close-files')).toBeFocused();
  await expect(page.locator('.canvas-section')).toHaveAttribute('inert', '');
  await page.getByLabel('파일 검색', { exact: true }).fill('일치하지않음');
  await expect(page.locator('#file-empty')).toBeVisible();
  await page.getByLabel('파일 검색', { exact: true }).fill('');
  await page.getByLabel('요소 검색', { exact: true }).fill('편집할 제목');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await page.locator('#layers .layer').click();
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('.canvas-section')).not.toHaveAttribute('inert');
  await expect(page.locator('#selection-box')).toBeVisible();
  await page.locator('#toggle-inspector').click();
  await expect(page.getByLabel('선택한 요소의 문구')).toHaveValue('편집할 제목');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-panel')).toBeHidden();
  await expect(page.locator('#toggle-inspector')).toBeFocused();
  await page.locator('#toggle-files').click();
  // The backdrop is outside the panel and returns focus to its opener.
  await page.locator('#workspace-backdrop').click({ position: { x: 500, y: 300 } });
  await expect(page.locator('#files-panel')).toBeHidden();
  await expect(page.locator('#toggle-files')).toBeFocused();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
});

test('help dialog is keyboard accessible and restores focus without changing the document', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '편집 도움말', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '편집 도움말' })).toBeVisible();
  await expect(page.getByRole('button', { name: '도움말 닫기', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#shortcuts-dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: '편집 도움말', exact: true })).toBeFocused();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, '기획서.html'), 'utf8')).toBe(SOURCE);
});
