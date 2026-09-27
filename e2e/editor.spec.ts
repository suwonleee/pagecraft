import { expect, test, type Page } from './korean-test.js';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\'">';
const SCRIPT = '<script>document.body.dataset.fixtureScript = "executed";</script>';
const SOURCE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">${CSP}<title>기획서 시험</title><link rel="stylesheet" href="./fixture.css"></head>
<body><!-- 원본 주석: 저장 후에도 유지 -->
<main id="page"><h1 id="heading">기획서 제목</h1>
<button id="cta" type="button" disabled>승인하기</button>
<section id="card"><strong id="nested">강조 문구</strong><p>상세 설명을 유지합니다.</p></section>
</main>${SCRIPT}</body></html>`;

let temporaryRoot: string;
let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'muse-html-editor-e2e-'));
  root = join(temporaryRoot, 'workspace');
  await mkdir(root);
  await Promise.all([
    ...['basic.html', 'nested.html', 'conflict.html', 'inline.html', 'switch.html'].map((name) => writeFile(join(root, name), SOURCE, 'utf8')),
    writeFile(join(root, 'fixture.css'), 'body{margin:32px;font-family:Arial,sans-serif}h1{color:#112233;margin:0;padding:0}button{margin:24px 0;padding:12px}section{padding:24px;border:1px solid #aaa}strong{display:block}', 'utf8'),
  ]);
  server = createHtmlEditorServer({ root });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function openFile(page: Page, file: string) {
  await page.goto(`${baseURL}/?file=${encodeURIComponent(file)}`);
  await expect(page.locator('#filename')).toHaveText(file.split('/').at(-1)!);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-fixture-script', 'executed');
}

test('edits text, color and spacing, restores history, and persists only source patches', async ({ page }) => {
  await openFile(page, 'basic.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await expect(heading).toHaveCSS('color', 'rgb(17, 34, 51)');
  await heading.click();
  await expect(page.getByLabel('선택한 요소의 텍스트')).toHaveValue('기획서 제목');

  await page.getByLabel('선택한 요소의 텍스트').fill('저장되는 기획서');
  await page.getByLabel('텍스트 색상', { exact: true }).fill('#7c3aed');
  await page.getByLabel('안쪽 여백', { exact: true }).fill('24');
  await expect(heading).toHaveText('저장되는 기획서');
  await expect(heading).toHaveCSS('color', 'rgb(124, 58, 237)');
  await expect(heading).toHaveCSS('padding-top', '24px');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');

  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(heading).toHaveCSS('padding-top', '0px');
  await expect(heading).toHaveText('저장되는 기획서');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(heading).toHaveCSS('padding-top', '24px');

  await page.getByRole('button', { name: '파일에 저장' }).click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.getByRole('status')).toContainText('저장했습니다.');
  await expect(page.getByRole('button', { name: '파일에 저장' })).toBeDisabled();

  const saved = await readFile(join(root, 'basic.html'), 'utf8');
  expect(saved).toContain('저장되는 기획서');
  expect(saved).toMatch(/color\s*:\s*#7c3aed/i);
  expect(saved).toMatch(/padding\s*:\s*24px/i);
  expect(saved).toContain(CSP);
  expect(saved).toContain(SCRIPT);
  expect(saved).toContain('<!-- 원본 주석: 저장 후에도 유지 -->');
  expect(saved).toContain('<section id="card"><strong id="nested">강조 문구</strong><p>상세 설명을 유지합니다.</p></section>');
  expect(saved).not.toContain('data-muse-edit-id');
  expect(saved).not.toContain('contenteditable');
  const backups = (await readdir(join(root, '.history'))).filter((file) => file.startsWith('basic.html.'));
  expect(backups).toHaveLength(1);
  expect(await readFile(join(root, '.history', backups[0]!), 'utf8')).toBe(SOURCE);

  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(heading).toHaveText('저장되는 기획서');
  await expect(heading).toHaveCSS('color', 'rgb(124, 58, 237)');
  await expect(heading).toHaveCSS('padding-top', '24px');
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-fixture-script', 'executed');
});

test('protects nested markup while allowing child text and disabled-button selection', async ({ page }) => {
  await openFile(page, 'nested.html');
  const preview = page.frameLocator('#preview');
  await preview.locator('#nested').click();
  await page.getByRole('button', { name: '상위 요소 ↑' }).click();
  await expect(page.locator('#selected-tag')).toHaveText('SECTION');
  await expect(page.getByLabel('선택한 요소의 텍스트')).toBeDisabled();
  await expect(page.locator('#text-hint')).toContainText('이 요소 안의 텍스트를 선택');

  await preview.locator('#nested').click();
  await expect(page.getByLabel('선택한 요소의 텍스트')).toBeEnabled();
  await page.getByLabel('선택한 요소의 텍스트').fill('수정한 강조 문구');
  await expect(preview.locator('#nested')).toHaveText('수정한 강조 문구');
  await expect(preview.locator('#card p')).toHaveText('상세 설명을 유지합니다.');

  // A real pointer click avoids Playwright waiting for the native disabled control to enable.
  const buttonBounds = await preview.locator('#cta').boundingBox();
  expect(buttonBounds).not.toBeNull();
  await page.mouse.click(buttonBounds!.x + buttonBounds!.width / 2, buttonBounds!.y + buttonBounds!.height / 2);
  await expect(page.locator('#selected-tag')).toHaveText('BUTTON');
  await expect(page.getByLabel('선택한 요소의 텍스트')).toHaveValue('승인하기');
});

test('keeps external file changes and unsaved edits when save detects a conflict', async ({ page }) => {
  await openFile(page, 'conflict.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.getByLabel('선택한 요소의 텍스트').fill('아직 저장하지 않은 문구');
  const externallyChanged = SOURCE.replace('기획서 제목', '다른 프로그램의 변경');
  await writeFile(join(root, 'conflict.html'), externallyChanged, 'utf8');

  const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
  await page.getByRole('button', { name: '파일에 저장' }).click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole('status')).toContainText('다른 프로그램에서 파일이 변경');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
  await expect(page.getByRole('button', { name: '파일에 저장' })).toBeEnabled();
  await expect(heading).toHaveText('아직 저장하지 않은 문구');
  expect(await readFile(join(root, 'conflict.html'), 'utf8')).toBe(externallyChanged);
});

test('imports an HTML copy, edits and saves it without changing the selected original', async ({ page }) => {
  await openFile(page, 'nested.html');
  const originalPath = join(temporaryRoot, 'upload.html');
  const original = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>가져오기</title></head><body><h1 id="imported-heading">가져온 기획서</h1></body></html>';
  await writeFile(originalPath, original, 'utf8');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'HTML 가져오기' }).click();
  await (await chooser).setFiles(originalPath);
  await expect(page.locator('#filename')).toHaveText('upload.html');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  const copiedFile = new URL(page.url()).searchParams.get('file');
  expect(copiedFile).toMatch(/^imports\/[^/]+\/upload\.html$/);
  const heading = page.frameLocator('#preview').locator('#imported-heading');
  await heading.click();
  await page.getByLabel('선택한 요소의 텍스트').fill('가져와서 저장한 기획서');
  await page.getByRole('button', { name: '파일에 저장' }).click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, copiedFile!), 'utf8')).toContain('가져와서 저장한 기획서');
  expect(await readFile(originalPath, 'utf8')).toBe(original);
  await page.reload();
  await expect(heading).toHaveText('가져와서 저장한 기획서');
});

test('edits directly with Enter, resizes by dragging, and retains the result across viewport changes and reload', async ({ page }) => {
  await openFile(page, 'inline.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await page.getByLabel('화면 너비').selectOption('390');
  await expect(page.locator('#preview')).toHaveCSS('width', '390px');
  await expect(page.locator('#dimensions')).toHaveText('390 px');

  await heading.dblclick();
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.insertText('직접 수정한 첫 줄');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('둘째 줄');
  await page.locator('.inspector-heading').click();
  const multilineText = '직접 수정한 첫 줄\n둘째 줄';
  await expect(heading).not.toHaveAttribute('contenteditable');
  await expect(heading).toHaveJSProperty('textContent', multilineText);
  await expect(page.getByLabel('선택한 요소의 텍스트')).toHaveValue(multilineText);

  const initialSize = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  });
  const handle = page.getByRole('button', { name: '선택 요소 크기 조절' });
  await expect(handle).toBeVisible();
  const handleBounds = await handle.boundingBox();
  expect(handleBounds).not.toBeNull();
  const startX = handleBounds!.x + handleBounds!.width / 2;
  const startY = handleBounds!.y + handleBounds!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 64, startY + 30, { steps: 6 });
  await page.mouse.up();
  const resizedWidth = `${Math.round(initialSize.width - 64)}px`;
  const resizedHeight = `${Math.round(initialSize.height + 30)}px`;
  await expect(heading).toHaveCSS('width', resizedWidth);
  await expect(heading).toHaveCSS('height', resizedHeight);
  await expect(page.getByLabel('너비', { exact: true })).toHaveValue(resizedWidth);

  await page.getByLabel('화면 너비').selectOption('1440');
  await expect(page.locator('#preview')).toHaveCSS('width', '1440px');
  await expect(page.locator('#dimensions')).toHaveText('1440 px');
  await expect(heading).toHaveCSS('width', resizedWidth);
  await page.getByRole('button', { name: '파일에 저장' }).click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(heading).toHaveJSProperty('textContent', multilineText);
  expect(await readFile(join(root, 'inline.html'), 'utf8')).toContain(multilineText);
  await expect(heading).toHaveCSS('white-space', 'pre-wrap');

  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(heading).toHaveJSProperty('textContent', multilineText);
  await expect(heading).toHaveCSS('white-space', 'pre-wrap');
  await expect(heading).toHaveCSS('width', resizedWidth);
  await expect(heading).toHaveCSS('height', resizedHeight);
});

test('requires an explicit discard decision before switching away from an unsaved document', async ({ page }) => {
  await openFile(page, 'switch.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.getByLabel('선택한 요소의 텍스트').fill('전환 전에 보존할 미저장 편집');
  await page.locator('#files button[title="nested.html"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '계속 편집', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#filename')).toHaveText('switch.html');
  await expect(heading).toHaveText('전환 전에 보존할 미저장 편집');
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');

  await page.locator('#files button[title="nested.html"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '변경 버리고 열기', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#filename')).toHaveText('nested.html');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(heading).toHaveText('기획서 제목');
  expect(await readFile(join(root, 'switch.html'), 'utf8')).toBe(SOURCE);
});
