import { expect, test, type Locator, type Page } from './korean-test.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const SOURCE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>구조 편집 시험</title>
<style>body{margin:0;font:16px Arial,sans-serif}.board{position:relative;width:900px;height:1200px}.item{position:absolute;box-sizing:border-box;padding:12px;background:#e9e3ff}.card{position:absolute;box-sizing:border-box;padding:20px;background:#dbeafe}.card strong{display:block;margin-bottom:16px}.card p{margin:0}</style></head>
<body><!-- 저장 후에도 보존할 문서 주석 -->
<main id="board" class="board">
<div id="alpha" class="item" style="left:50px;top:60px;width:100px;height:60px">첫째 요소</div>
<div id="beta" class="item" style="left:250px;top:190px;width:140px;height:90px">둘째 요소</div>
<div id="gamma" class="item" style="left:440px;top:90px;width:80px;height:120px">셋째 요소</div>
<section id="card" class="card" style="left:60px;top:430px;width:300px;height:150px"><strong id="child">카드 제목</strong><p id="description">카드 설명</p></section>
</main><script>window.fixtureWasExecuted = true;</script></body></html>`;

let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'muse-html-editor-structure-'));
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

async function bounds(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function positionDocument(page: Page) {
  const canvas = await bounds(page.locator('#canvas'));
  const preview = await bounds(page.locator('#preview'));
  await page.locator('#canvas').focus();
  await page.keyboard.down('Space');
  await drag(page, canvas.x + canvas.width / 2, canvas.y + canvas.height / 2,
    canvas.x + 28 - preview.x, canvas.y + 28 - preview.y);
  await page.keyboard.up('Space');
}

async function openFile(page: Page, file: string, source = SOURCE) {
  await writeFile(join(root, file), source, 'utf8');
  await page.goto(`${baseURL}/?file=${encodeURIComponent(file)}`);
  await expect(page.locator('#filename')).toHaveText(file);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.getByLabel('화면 너비').selectOption('1440');
  await page.locator('#zoom-reset').click();
  await expect(page.locator('#zoom-value')).toHaveText('100%');
  await positionDocument(page);
}

async function selectLayer(page: Page, htmlId: string, additive = false) {
  const id = await page.frameLocator('#preview').locator(`[id="${htmlId}"]`).getAttribute('data-muse-edit-id');
  expect(id).toBeTruthy();
  await page.locator(`#layers .layer[data-node-id="${id}"]`).click({ modifiers: additive ? ['Shift'] : [] });
}

async function save(page: Page) {
  const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
  await page.locator('#save').click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
}

async function localRects(page: Page, ids: string[]) {
  return page.frameLocator('#preview').locator('body').evaluate((body, selectedIds) => selectedIds.map((id) => {
    const box = body.ownerDocument.getElementById(id)!.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }), ids);
}

test('Shift selects and toggles elements, moves the whole selection, and undoes a drag in one step', async ({ page }) => {
  await openFile(page, 'multi-move.html');
  // Keep the original free-movement coordinate assertion; snapping has its own suite.
  await page.getByRole('button', { name: '드래그 자동 정렬', exact: true }).click();
  await expect(page.locator('#snap-toggle')).toHaveAttribute('aria-pressed', 'false');
  const preview = page.frameLocator('#preview');
  await preview.locator('#alpha').click();
  await preview.locator('#beta').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await expect(page.locator('#resize-handle')).toBeHidden();
  await preview.locator('#beta').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('1개 선택');
  await preview.locator('#beta').click({ modifiers: ['Shift'] });
  const initial = await localRects(page, ['alpha', 'beta', 'gamma']);
  const alpha = await bounds(preview.locator('#alpha'));
  await drag(page, alpha.x + 20, alpha.y + 20, 36, 24);
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await expect.poll(() => localRects(page, ['alpha', 'beta', 'gamma'])).toEqual([
    { ...initial[0]!, x: initial[0]!.x + 36, y: initial[0]!.y + 24 },
    { ...initial[1]!, x: initial[1]!.x + 36, y: initial[1]!.y + 24 },
    initial[2]!,
  ]);
  expect(await readFile(join(root, 'multi-move.html'), 'utf8')).toBe(SOURCE);
  await page.locator('#undo').click();
  await expect.poll(() => localRects(page, ['alpha', 'beta', 'gamma'])).toEqual(initial);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#save')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(preview.locator('#alpha')).toHaveCSS('translate', '36px 24px');
  await expect(preview.locator('#beta')).toHaveCSS('translate', '36px 24px');
});

test('duplicates the edited subtree as a snapshot, then independently edits and saves both copies', async ({ page }) => {
  await openFile(page, 'duplicate-snapshot.html');
  const preview = page.frameLocator('#preview');
  await selectLayer(page, 'child');
  await page.getByLabel('선택한 요소의 텍스트').fill('복제 시점의 제목');
  await selectLayer(page, 'card');
  await page.getByRole('button', { name: '선택 요소 복제', exact: true }).click();
  await expect(preview.locator('#card--c1')).toHaveCount(1);
  await expect(preview.locator('#child--c1')).toHaveText('복제 시점의 제목');
  await expect(preview.locator('#description--c1')).toHaveText('카드 설명');
  await selectLayer(page, 'child');
  await page.getByLabel('선택한 요소의 텍스트').fill('원본에서만 바꾼 제목');
  await expect(preview.locator('#child--c1')).toHaveText('복제 시점의 제목');
  expect(await readFile(join(root, 'duplicate-snapshot.html'), 'utf8')).toBe(SOURCE);
  await save(page);
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(preview.locator('#child')).toHaveText('원본에서만 바꾼 제목');
  await expect(preview.locator('#child--c1')).toHaveText('복제 시점의 제목');

  await selectLayer(page, 'child--c1');
  await page.getByLabel('선택한 요소의 텍스트').fill('복사본에서만 바꾼 제목');
  await save(page);
  await expect(preview.locator('#child')).toHaveText('원본에서만 바꾼 제목');
  await expect(preview.locator('#child--c1')).toHaveText('복사본에서만 바꾼 제목');
  await selectLayer(page, 'card--c1');
  await page.locator('#duplicate-selection').click();
  await expect(preview.locator('section.card')).toHaveCount(3);
  await page.locator('#delete-selection').click();
  await expect(preview.locator('section.card')).toHaveCount(2);
  // A clone created and immediately deleted leaves the persisted two cards intact.
  if (await page.locator('#save').isEnabled()) await save(page);
  await page.reload();
  await expect(preview.locator('section.card')).toHaveCount(2);
  await expect(preview.locator('#child--c1')).toHaveText('복사본에서만 바꾼 제목');
  const saved = await readFile(join(root, 'duplicate-snapshot.html'), 'utf8');
  expect(saved).toContain('<!-- 저장 후에도 보존할 문서 주석 -->');
  expect(saved).toContain('<script>window.fixtureWasExecuted = true;</script>');
  expect(saved).not.toMatch(/data-muse-|contenteditable/);
});

test('preserves ID selector appearance as the clone baseline without redundant inherited child overrides', async ({ page }, testInfo) => {
  const source = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>'
    + 'body{margin:24px;font:16px Arial,sans-serif}#card{color:red;padding:20px;width:320px;box-sizing:border-box}'
    + '#card h2{font-size:24px;line-height:30px;font-weight:600;margin:0}.line{margin:0;height:18px}'
    + '</style></head><body><section id="card"><h2 id="heading">ID 스타일 제목</h2>'
    + Array.from({ length: 1000 }, (_, index) => `<p class="line">상속 문구 ${index}</p>`).join('')
    + '</section></body></html>';
  await openFile(page, 'clone-appearance.html', source);
  const preview = page.frameLocator('#preview');
  await selectLayer(page, 'card');
  await page.locator('#duplicate-selection').click();
  const original = preview.locator('#card');
  const clone = preview.locator('#card--c1');
  const heading = preview.locator('#heading--c1');
  await expect(clone).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(clone).toHaveCSS('padding-top', '20px');
  await expect(clone).toHaveCSS('width', '320px');
  await expect(heading).toHaveCSS('font-size', '24px');
  await expect(heading).toHaveCSS('line-height', '30px');
  await expect(heading).toHaveCSS('font-weight', '600');
  await expect(clone.locator('p')).toHaveCount(1000);
  await expect(clone.locator('p[style]')).toHaveCount(0);

  await page.getByLabel('텍스트 색상', { exact: true }).fill('#0000ff');
  await expect(clone).toHaveCSS('color', 'rgb(0, 0, 255)');
  await expect(original).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.locator('#reset-selected').click();
  await expect(clone).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(clone).toHaveCSS('padding-top', '20px');
  await expect(clone).toHaveCSS('width', '320px');
  await expect(heading).toHaveCSS('font-size', '24px');
  expect(await readFile(join(root, 'clone-appearance.html'), 'utf8')).toBe(source);
  await save(page);
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(clone).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(clone).toHaveCSS('padding-top', '20px');
  await expect(clone).toHaveCSS('width', '320px');
  await expect(heading).toHaveCSS('font-size', '24px');
  await expect(heading).toHaveCSS('line-height', '30px');
  await expect(heading).toHaveCSS('font-weight', '600');
  await expect(original).not.toHaveAttribute('style');
  await expect(original.locator('#heading')).not.toHaveAttribute('style');
  await expect(clone.locator('p[style]')).toHaveCount(0);
  await expect(clone.locator('p').last()).toHaveCSS('color', 'rgb(255, 0, 0)');
  await testInfo.attach('inherited-clone-overrides', {
    body: JSON.stringify({ inheritedChildren: 1000, inlineChildOverrides: await clone.locator('p[style]').count() }, null, 2),
    contentType: 'application/json',
  });
});

test('avoids IDs reserved inside templates and preserves remapped local references across save', async ({ page }) => {
  const template = '<template id="reserved"><span id="title--c1">숨겨진 예약 ID</span></template>';
  const source = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:24px}section{padding:20px}</style></head>'
    + `<body>${template}<section id="card" aria-labelledby="title"><h2 id="title">참조 대상</h2>`
    + '<a id="jump" href="#title" aria-describedby="title">제목으로 이동</a></section></body></html>';
  await openFile(page, 'template-ids.html', source);
  const preview = page.frameLocator('#preview');
  await selectLayer(page, 'card');
  await page.locator('#duplicate-selection').click();
  const clone = preview.locator('#card--c1');
  await expect(clone.locator('#title--c1--2')).toHaveText('참조 대상');
  await expect(clone).toHaveAttribute('aria-labelledby', 'title--c1--2');
  await expect(clone.locator('#jump--c1')).toHaveAttribute('href', '#title--c1--2');
  await expect(clone.locator('#jump--c1')).toHaveAttribute('aria-describedby', 'title--c1--2');
  await expect(preview.locator('#card')).toHaveAttribute('aria-labelledby', 'title');
  await expect(preview.locator('#jump')).toHaveAttribute('href', '#title');
  expect(await readFile(join(root, 'template-ids.html'), 'utf8')).toBe(source);
  await save(page);
  expect(await readFile(join(root, 'template-ids.html'), 'utf8')).toContain(template);
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(clone.locator('#title--c1--2')).toHaveText('참조 대상');
  await expect(clone).toHaveAttribute('aria-labelledby', 'title--c1--2');
  await expect(clone.locator('#jump--c1')).toHaveAttribute('href', '#title--c1--2');
  await expect(clone.locator('#jump--c1')).toHaveAttribute('aria-describedby', 'title--c1--2');
  expect(await preview.locator('#reserved').evaluate((element) => (element as HTMLTemplateElement).content.querySelector('span')?.id)).toBe('title--c1');
});

test('normalizes a selected parent and child to one subtree for duplicate and delete', async ({ page }) => {
  await openFile(page, 'nested-selection.html');
  const preview = page.frameLocator('#preview');
  await selectLayer(page, 'card');
  await selectLayer(page, 'child', true);
  await page.locator('#duplicate-selection').click();
  await expect(preview.locator('section.card')).toHaveCount(2);
  await expect(preview.locator('strong')).toHaveCount(2);
  await expect(preview.locator('#card--c1 > #child--c1')).toHaveCount(1);
  await page.locator('#undo').click();
  await expect(preview.locator('section.card')).toHaveCount(1);
  await expect(preview.locator('strong')).toHaveCount(1);
  await expect(page.locator('#save')).toBeDisabled();
  await selectLayer(page, 'card');
  await selectLayer(page, 'child', true);
  await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
  await expect(preview.locator('#card')).toHaveCount(0);
  await expect(preview.locator('#child')).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(preview.locator('#card > #child')).toHaveText('카드 제목');
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readFile(join(root, 'nested-selection.html'), 'utf8')).toBe(SOURCE);
});

test('deletes multiple elements as one reversible action and persists only their source removal', async ({ page }) => {
  await openFile(page, 'multi-delete.html');
  const preview = page.frameLocator('#preview');
  await preview.locator('#alpha').click();
  await preview.locator('#beta').click({ modifiers: ['Shift'] });
  await page.locator('#delete-selection').click();
  await expect(preview.locator('#alpha, #beta')).toHaveCount(0);
  await expect(preview.locator('#gamma')).toHaveText('셋째 요소');
  expect(await readFile(join(root, 'multi-delete.html'), 'utf8')).toBe(SOURCE);
  await page.locator('#undo').click();
  await expect(preview.locator('#alpha, #beta')).toHaveCount(2);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(preview.locator('#alpha, #beta')).toHaveCount(0);
  await save(page);
  const expected = SOURCE.replace(/<div id="alpha"[^>]*>[^<]*<\/div>/, '').replace(/<div id="beta"[^>]*>[^<]*<\/div>/, '');
  expect(await readFile(join(root, 'multi-delete.html'), 'utf8')).toBe(expected);
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(preview.locator('#alpha, #beta')).toHaveCount(0);
  await expect(preview.locator('#gamma')).toHaveText('셋째 요소');
});

test('aligns all six edges and centers at 50% zoom with one undo per alignment', async ({ page }) => {
  await openFile(page, 'alignment.html');
  for (let attempt = 0; attempt < 20 && parseFloat(await page.locator('#zoom-value').innerText()) > 50; attempt++) {
    await page.locator('#zoom-out').click();
  }
  await expect(page.locator('#zoom-value')).toHaveText('50%');
  await positionDocument(page);
  const preview = page.frameLocator('#preview');
  await preview.locator('#alpha').click();
  await preview.locator('#beta').click({ modifiers: ['Shift'] });
  await preview.locator('#gamma').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('3개 선택');
  const ids = ['alpha', 'beta', 'gamma'];
  const initial = await localRects(page, ids);
  const left = Math.min(...initial.map((rect) => rect.x));
  const right = Math.max(...initial.map((rect) => rect.x + rect.width));
  const top = Math.min(...initial.map((rect) => rect.y));
  const bottom = Math.max(...initial.map((rect) => rect.y + rect.height));
  const targets = { left, center: (left + right) / 2, right, top, middle: (top + bottom) / 2, bottom };

  for (const alignment of ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const) {
    await test.step(alignment, async () => {
      await page.locator(`[data-align="${alignment}"]`).click();
      await expect.poll(async () => (await localRects(page, ids)).map((rect) => {
        const actual = alignment === 'left' ? rect.x : alignment === 'center' ? rect.x + rect.width / 2
          : alignment === 'right' ? rect.x + rect.width : alignment === 'top' ? rect.y
            : alignment === 'middle' ? rect.y + rect.height / 2 : rect.y + rect.height;
        return Math.abs(actual - targets[alignment]);
      })).toEqual([0, 0, 0]);
      await expect(page.locator('#selection-box')).toBeVisible();
      await page.locator('#undo').click();
      await expect.poll(() => localRects(page, ids)).toEqual(initial);
      await expect(page.locator('#undo')).toBeDisabled();
    });
  }
  await expect(page.locator('#save')).toBeDisabled();
  expect(await readFile(join(root, 'alignment.html'), 'utf8')).toBe(SOURCE);
});

test('leaves typing shortcuts in text fields and activates duplicate/delete only for canvas selection', async ({ page }) => {
  await openFile(page, 'structure-shortcuts.html');
  const preview = page.frameLocator('#preview');
  await preview.locator('#alpha').click();
  const text = page.getByLabel('선택한 요소의 텍스트');
  await text.fill('입력 보호');
  await text.press('End');
  await text.press('Backspace');
  await expect(text).toHaveValue('입력 보');
  await text.press('Meta+d');
  await text.press('Control+d');
  await expect(preview.locator('.item')).toHaveCount(3);
  // macOS Home scrolls a textarea without moving its caret. Set the caret directly
  // so this checks Delete routing rather than platform-specific cursor navigation.
  await text.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(0, 0));
  await text.press('Delete');
  await expect(text).toHaveValue('력 보');
  await expect(preview.locator('#alpha')).toHaveText('력 보');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+d');
  await expect(preview.locator('#alpha--c1')).toHaveText('력 보');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Delete');
  await expect(preview.locator('#alpha--c1')).toHaveCount(0);
  await expect(preview.locator('#alpha')).toHaveText('력 보');

  await preview.locator('#alpha').dblclick();
  await expect(preview.locator('#alpha')).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.insertText('직접 입력');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+d');
  await expect(preview.locator('#alpha')).toHaveText('직접 입');
  await expect(preview.locator('.item')).toHaveCount(3);
});

test('marquee selects from empty canvas, cancels with Escape, and leaves deletion as one undoable action', async ({ page }) => {
  await openFile(page, 'marquee.html');
  const preview = page.frameLocator('#preview');
  const canvas = await bounds(page.locator('#canvas'));
  const beta = await bounds(preview.locator('#beta'));
  const gamma = await bounds(preview.locator('#gamma'));
  const start = { x: canvas.x + 8, y: canvas.y + 8 };
  await drag(page, start.x, start.y, beta.x + beta.width + 8 - start.x, beta.y + beta.height + 8 - start.y);
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await expect(page.locator('#marquee')).toBeHidden();
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#save')).toBeDisabled();

  await page.keyboard.down('Shift');
  await drag(page, start.x, start.y, gamma.x + gamma.width + 8 - start.x, gamma.y + gamma.height + 8 - start.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('3개 선택');

  const alpha = await bounds(preview.locator('#alpha'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(alpha.x + alpha.width + 8, alpha.y + alpha.height + 8, { steps: 8 });
  await expect(page.locator('#selection-count')).toHaveText('1개 선택');
  await expect(page.locator('#marquee')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#selection-count')).toHaveText('3개 선택');
  await expect(page.locator('#marquee')).toBeHidden();

  await page.locator('#canvas').focus();
  await page.keyboard.press('Delete');
  await expect(preview.locator('.item')).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(preview.locator('.item')).toHaveCount(3);
  await expect(page.locator('#undo')).toBeDisabled();
  await selectLayer(page, 'alpha');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Backspace');
  await expect(preview.locator('#alpha')).toHaveCount(0);
  await expect(preview.locator('#beta, #gamma')).toHaveCount(2);
  await page.locator('#undo').click();
  await expect(preview.locator('#alpha')).toHaveText('첫째 요소');
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#save')).toBeDisabled();
  expect(await readFile(join(root, 'marquee.html'), 'utf8')).toBe(SOURCE);
});

test('retains Shift selection across a 2,001-element layer list without rendering all rows', async ({ page }, testInfo) => {
  const source = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>p{height:28px;margin:0}</style></head><body><main>'
    + Array.from({ length: 2000 }, (_, index) => `<p id="row-${index}">기획 문구 ${String(index).padStart(4, '0')}</p>`).join('')
    + '</main></body></html>';
  await openFile(page, 'large-selection.html', source);
  await expect(page.locator('#node-count')).toHaveText('2001');
  await page.getByLabel('요소 검색').fill('기획 문구 0000');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await page.locator('#layers .layer').click();
  await page.getByLabel('요소 검색').fill('기획 문구 1999');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await expect(page.locator('#layers .layer')).toContainText('기획 문구 1999');
  await page.locator('#layers .layer').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await expect(page.locator('#layers .layer')).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('요소 검색').fill('');
  await page.locator('#canvas').focus();
  await page.keyboard.press('ArrowRight');
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#row-0')).toHaveCSS('translate', '1px');
  await expect(preview.locator('#row-1999')).toHaveCSS('translate', '1px');
  await expect(preview.locator('#row-1000')).toHaveCSS('translate', 'none');
  await page.locator('#undo').click();
  await expect(preview.locator('#row-0')).toHaveCSS('translate', 'none');
  await expect(preview.locator('#row-1999')).toHaveCSS('translate', 'none');
  const metrics = await page.evaluate(() => ({
    layerButtons: document.querySelectorAll('#layers .layer').length,
    layerDescendants: document.querySelector('#layers')!.querySelectorAll('*').length,
  }));
  expect(metrics.layerButtons).toBeGreaterThan(0);
  expect(metrics.layerButtons).toBeLessThan(80);
  expect(metrics.layerDescendants).toBeLessThan(250);
  expect(await readFile(join(root, 'large-selection.html'), 'utf8')).toBe(source);
  await testInfo.attach('multi-selection-layer-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});
