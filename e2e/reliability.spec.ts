import { expect, test } from './korean-test.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const SOURCE = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:32px;font:16px Arial}h1{margin:0}p{margin-top:30px}</style></head><body><h1 id="heading">기획서 제목</h1><p id="description">상세 설명</p></body></html>';
let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'muse-editor-reliability-'));
  server = createHtmlEditorServer({ root });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(async ({ page }) => {
  await Promise.all(['current.html', 'other.html'].map((file) => writeFile(join(root, file), SOURCE)));
  await page.goto(`${baseURL}/?file=current.html`);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

test('locks edits during a slow save, retains the view and selection, and rebases source IDs for the next save', async ({ page }) => {
  const preview = page.frameLocator('#preview');
  const field = page.getByLabel('선택한 요소의 문구');
  await preview.locator('#heading').click();
  await field.fill('원본보다 길어진 기획서 제목');
  await preview.locator('#description').click();
  await field.fill('첫 번째 설명 수정');
  const oldId = await preview.locator('#description').getAttribute('data-muse-edit-id');
  await page.getByRole('button', { name: '실제 크기 100%', exact: true }).click();
  await page.getByRole('button', { name: '축소', exact: true }).click();
  const view = await page.locator('#frame-wrap').evaluate((element) => getComputedStyle(element).transform);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/save', async (route) => { await gate; await route.continue(); }, { times: 1 });
  await field.focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('저장 중…');
  await expect(field).toBeDisabled();
  await expect(page.getByLabel('글자 크기', { exact: true })).toBeDisabled();
  await expect(page.locator('#canvas')).toHaveAttribute('inert', '');
  await expect(page.locator('#save')).toBeDisabled();
  release();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(field).toBeEnabled();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('첫 번째 설명 수정');
  expect(await page.locator('#frame-wrap').evaluate((element) => getComputedStyle(element).transform)).toBe(view);
  expect(await preview.locator('#description').getAttribute('data-muse-edit-id')).not.toBe(oldId);

  await field.fill('저장한 뒤 이어서 편집한 설명');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, 'current.html'), 'utf8')).toBe(SOURCE.replace('기획서 제목', '원본보다 길어진 기획서 제목').replace('상세 설명', '저장한 뒤 이어서 편집한 설명'));
});

test('keeps unsaved edits and a persistent error after save failure, then retries successfully', async ({ page }) => {
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.getByLabel('선택한 요소의 문구').fill('실패해도 남는 수정');
  await page.route('**/api/save', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '시험 서버 일시 중단' }) }), { times: 1 });
  await page.getByRole('button', { name: '파일에 저장' }).click();
  await expect(page.locator('#operation-error')).toBeVisible();
  await expect(page.locator('#operation-error-message')).toHaveText('시험 서버 일시 중단');
  await expect(page.locator('#save-state')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
  await expect(heading).toHaveText('실패해도 남는 수정');
  expect(await readFile(join(root, 'current.html'), 'utf8')).toBe(SOURCE);
  await expect(page.getByLabel('선택한 요소의 문구')).toBeEnabled();

  await page.locator('#retry-operation').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#operation-error')).toBeHidden();
  expect(await readFile(join(root, 'current.html'), 'utf8')).toContain('실패해도 남는 수정');
});

test('finishes an active drag before saving so Escape cannot restore stale source IDs afterward', async ({ page }) => {
  const heading = page.frameLocator('#preview').locator('#heading');
  const bounds = (await heading.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 40, { steps: 5 });
  await expect(page.locator('#save-state')).toContainText('저장 전');
  const translate = await heading.evaluate((element) => getComputedStyle(element).translate);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(heading).toHaveCSS('translate', translate);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await heading.click();
  await page.getByLabel('선택한 요소의 문구').fill('드래그 저장 이후의 편집');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  const contents = await readFile(join(root, 'current.html'), 'utf8');
  expect(contents).toContain('드래그 저장 이후의 편집');
  expect(contents).toContain(`translate: ${translate}`);
});

test('preserves the current edited document when the next HTML preview fails to load', async ({ page }) => {
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.getByLabel('선택한 요소의 문구').fill('열기 실패에도 유지할 내용');
  await page.route('**/preview/other.html*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"preview unavailable"}' }));
  await page.locator('#files button[title="other.html"]').click();
  await page.getByRole('button', { name: '변경 버리고 열기', exact: true }).click();
  await expect(page.locator('#operation-error')).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('current.html');
  await expect(heading).toHaveText('열기 실패에도 유지할 내용');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
  expect(await page.locator('iframe').count()).toBe(1);
  await page.getByRole('button', { name: '파일에 저장' }).click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, 'current.html'), 'utf8')).toContain('열기 실패에도 유지할 내용');
  expect(await readFile(join(root, 'other.html'), 'utf8')).toBe(SOURCE);
});
