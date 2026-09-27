import { expect, test, type Locator, type Page } from './korean-test.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const SOURCE = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:32px}h1{margin:0;font:32px sans-serif}</style></head><body><h1 id="heading">기획서 제목</h1></body></html>';
type EditingContext = 'inspector' | 'inline';
type Key = Pick<KeyboardEventInit, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode' | 'repeat'> & { altGraph?: boolean };
let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'muse-html-keyboard-e2e-'));
  server = createHtmlEditorServer({ root });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(async ({ page }) => {
  await writeFile(join(root, 'keyboard.html'), SOURCE, 'utf8');
  await page.goto(`${baseURL}/?file=keyboard.html`);
  await expect(page.locator('#filename')).toHaveText('keyboard.html');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
});

test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

async function edit(page: Page, context: EditingContext, text: string) {
  const heading = page.frameLocator('#preview').locator('#heading');
  if (context === 'inline') {
    await heading.dblclick();
    await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only');
    await page.keyboard.insertText(text);
    return heading;
  }
  await heading.click();
  const field = page.getByLabel('선택한 요소의 텍스트');
  await field.fill(text);
  return field;
}

// Explicit key/code pairs cover layout mappings without changing the machine's OS input source.
async function keyDown(target: Locator, init: Key) {
  return target.evaluate((element, options) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
    if (options.altGraph) Object.defineProperty(event, 'getModifierState', { value: (key: string) => key === 'AltGraph' });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

async function saveKey(page: Page, target: Locator, key: Key, text: string) {
  const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
  expect(await keyDown(target, key)).toBe(true);
  expect((await response).status()).toBe(200);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await readFile(join(root, 'keyboard.html'), 'utf8')).toContain(text);
  await page.reload();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText(text);
}

for (const context of ['inspector', 'inline'] as const) {
  test(`saves the ${context} with Korean and Cyrillic physical S shortcuts`, async ({ page }) => {
    for (const layout of [{ name: 'Korean', key: 'ㄴ' }, { name: 'Cyrillic', key: 'ы' }]) {
      const text = `${layout.name} ${context} 저장`;
      const target = await edit(page, context, text);
      await saveKey(page, target, { key: layout.key, code: 'KeyS', metaKey: true }, text);
    }
  });

  test(`saves the ${context} with native Command/Control+Enter`, async ({ page }) => {
    for (const modifier of ['Meta', 'Control']) {
      const text = `${context} ${modifier} Enter 저장`;
      await edit(page, context, text);
      const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
      await page.keyboard.press(`${modifier}+Enter`);
      expect((await response).status()).toBe(200);
      await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
      expect(await readFile(join(root, 'keyboard.html'), 'utf8')).toContain(text);
    }
  });

  test(`claims Command/Control+S before a focused ${context} widget handles it`, async ({ page }) => {
    for (const modifier of ['Meta', 'Control']) {
      const text = `${context} ${modifier} 우선 저장`;
      const target = await edit(page, context, text);
      await page.locator('body').evaluate((body) => { body.dataset.widgetSaves = '0'; });
      await target.evaluate((element) => {
        element.addEventListener('keydown', (event) => {
          const key = event as KeyboardEvent;
          if ((key.metaKey || key.ctrlKey) && key.code === 'KeyS') {
            const body = window.top!.document.body;
            body.dataset.widgetSaves = String(Number(body.dataset.widgetSaves) + 1);
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        });
      });
      const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
      await page.keyboard.press(`${modifier}+s`);
      expect((await response).status()).toBe(200);
      await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
      await expect(page.locator('body')).toHaveAttribute('data-widget-saves', '0');
      expect(await readFile(join(root, 'keyboard.html'), 'utf8')).toContain(text);
    }
  });
}

test('respects semantic Latin shortcuts without executing conflicting physical commands', async ({ page }) => {
  let saveRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/save')) saveRequests++; });
  const target = await edit(page, 'inspector', 'Latin 배열 변경');
  expect(await keyDown(target, { key: 'z', code: 'KeyS', metaKey: true })).toBe(true);
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('기획서 제목');
  expect(saveRequests).toBe(0);
  const text = 'Dvorak 문자 S 저장';
  await target.fill(text);
  await saveKey(page, target, { key: 's', code: 'KeyO', ctrlKey: true }, text);
  expect(saveRequests).toBe(1);
});

test('saves from a Latin key when a virtual keyboard provides no code', async ({ page }) => {
  const text = 'code 없는 입력 장치 저장';
  const target = await edit(page, 'inspector', text);
  await saveKey(page, target, { key: 's', ctrlKey: true }, text);
});

test('handles Korean undo, redo and canvas tools while preserving IME and modified input', async ({ page }) => {
  let saveRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/save')) saveRequests++; });
  const target = await edit(page, 'inspector', '단축키 검증 문구');
  const heading = page.frameLocator('#preview').locator('#heading');
  const body = page.locator('body');
  const previewBody = page.frameLocator('#preview').locator('body');

  await keyDown(target, { key: 'ㅋ', code: 'KeyZ', metaKey: true });
  await expect(heading).toHaveText('기획서 제목');
  await keyDown(previewBody, { key: 'ㅋ', code: 'KeyZ', ctrlKey: true, shiftKey: true });
  await expect(heading).toHaveText('단축키 검증 문구');

  await keyDown(body, { key: 'ㅗ', code: 'KeyH' });
  await expect(page.locator('#tool-hand')).toHaveAttribute('aria-pressed', 'true');
  await keyDown(previewBody, { key: 'ㅍ', code: 'KeyV' });
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');

  for (const event of [
    { key: 'ㅗ', code: 'KeyH', isComposing: true },
    { key: 'Process', code: 'KeyH', keyCode: 229 },
    { key: ' ', code: 'Space', ctrlKey: true },
  ]) expect(await keyDown(body, event)).toBe(false);
  await expect(page.locator('#canvas')).not.toHaveClass(/hand-mode/);
  await keyDown(target, { key: 'ㅗ', code: 'KeyH' });
  await expect(page.locator('#tool-hand')).toHaveAttribute('aria-pressed', 'false');

  for (const event of [
    { key: 'ㄴ', code: 'KeyS', metaKey: true, altKey: true },
    { key: 'ㄴ', code: 'KeyS', ctrlKey: true, altGraph: true },
    { key: 'ㅋ', code: 'KeyZ', metaKey: true, isComposing: true },
  ]) expect(await keyDown(target, event)).toBe(false);
  await expect(heading).toHaveText('단축키 검증 문구');
  expect(saveRequests).toBe(0);
  expect(await readFile(join(root, 'keyboard.html'), 'utf8')).toBe(SOURCE);

  await heading.dblclick();
  expect(await keyDown(heading, { key: 'Escape', code: 'Escape', isComposing: true })).toBe(false);
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only');
});

for (const context of ['inspector', 'inline'] as const) {
  test(`waits for final IME input in the ${context} and coalesces save requests`, async ({ page }) => {
    let saveRequests = 0;
    page.on('request', (request) => { if (request.url().endsWith('/api/save')) saveRequests++; });
    const target = await edit(page, context, '조합 전');
    const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
    const finalText = '한글 마지막 음절 확정';
    const result = await target.evaluate((element, { context, finalText }) => {
      const setText = (text: string) => {
        if (element instanceof HTMLTextAreaElement) element.value = text;
        else element.textContent = text;
      };
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      setText('한글 마지막 음절 확ㅈ');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'ㅈ', isComposing: true }));
      for (let index = 0; index < 2; index++) element.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Process', code: 'KeyS', metaKey: true, isComposing: true,
      }));
      const editingAfterRequest = context !== 'inline' || element.hasAttribute('contenteditable');
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '정' }));
      // A blur can occur between compositionend and the final input. DOM teardown must wait.
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      const editingBeforeFinalInput = context !== 'inline' || element.hasAttribute('contenteditable');
      setText(finalText);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '정' }));
      return { editingAfterRequest, editingBeforeFinalInput };
    }, { context, finalText });
    expect(result).toEqual({ editingAfterRequest: true, editingBeforeFinalInput: true });
    expect((await response).status()).toBe(200);
    await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
    await expect(page.frameLocator('#preview').locator('#heading')).toHaveText(finalText);
    expect(await readFile(join(root, 'keyboard.html'), 'utf8')).toContain(finalText);
    expect(saveRequests).toBe(1);
  });
}

test('commits native Chromium IME composition before saving from either editing context', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  try {
    for (const context of ['inspector', 'inline'] as const) {
      const finalText = context === 'inspector' ? '한' : '글';
      const target = await edit(page, context, '조합 전');
      await target.focus();
      await page.keyboard.press('ControlOrMeta+A');
      expect(await target.evaluate((element) => {
        if (element.tagName === 'TEXTAREA') {
          const field = element as HTMLTextAreaElement;
          return field.value.slice(field.selectionStart, field.selectionEnd);
        }
        return element.ownerDocument.getSelection()?.toString();
      })).toBe('조합 전');
      await client.send('Input.imeSetComposition', { text: finalText, selectionStart: 1, selectionEnd: 1 });
      const response = page.waitForResponse((result) => result.url().endsWith('/api/save') && result.request().method() === 'POST');
      await client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'ㄴ', code: 'KeyS', modifiers: 4, windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 1,
      });
      expect((await response).status()).toBe(200);
      await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
      await expect(page.frameLocator('#preview').locator('#heading')).toHaveText(finalText);
      expect(await readFile(join(root, 'keyboard.html'), 'utf8')).toContain(`>${finalText}</h1>`);
    }
  } finally {
    if (!page.isClosed()) await client.detach();
  }
});
