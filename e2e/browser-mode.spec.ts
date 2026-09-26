import { expect, test, type Download, type Locator, type Page } from './korean-test.js';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../src/static-server.js';

const SCRIPT = '<script>document.body.dataset.fixtureScript = "executed";</script>';
const UNCHANGED = '<p id="untouched" data-spacing = "keep">An untouched paragraph.</p>';
const SOURCE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Browser fixture</title>
<style>body{margin:32px;font-family:Arial,sans-serif}h1{margin:0;padding:0;font-size:32px}p{margin-top:32px}</style></head>
<body><!-- Preserve the original comment and whitespace. -->
<main id="document"><h1 id="heading">Original heading</h1>
${UNCHANGED}</main>${SCRIPT}</body></html>`;

type FileHarness = {
  pickerCalls: number;
  denyWrites: boolean;
  cancelPicker: boolean;
  read(): Promise<string>;
  replace(source: string): Promise<void>;
};
type HarnessWindow = Window & { __pagecraftFileTest: FileHarness };

let root: string;
let server: Server;
let baseURL: string;
const apiRequests = new WeakMap<Page, string[]>();
const pageErrors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pagecraft-browser-e2e-'));
  const nestedRoot = join(root, 'tools', 'pagecraft');
  await mkdir(nestedRoot, { recursive: true });
  await cp(fileURLToPath(new URL('../web-dist/', import.meta.url)), nestedRoot, { recursive: true });
  server = createStaticServer({ root });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tools/pagecraft/`;
});

test.beforeEach(async ({ page }) => {
  const requests: string[] = [];
  apiRequests.set(page, requests);
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.split('/').includes('api')) requests.push(request.url());
  });
});

test.afterEach(async ({ page }) => {
  expect(apiRequests.get(page), 'The static app must not call the local editor API.').toEqual([]);
  expect(pageErrors.get(page), 'Browser errors must be handled without losing the editor.').toEqual([]);
});

test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

async function openFallback(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.goto(baseURL);
  await expect(page.locator('#browser-welcome')).toBeVisible();
}

async function importCopy(page: Page) {
  await page.locator('#file-input').setInputFiles({ name: 'browser-fixture.html', mimeType: 'text/html', buffer: Buffer.from(SOURCE) });
  await expect(page.locator('#filename')).toHaveText('browser-fixture.html');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Original heading');
  await expect(page.locator('#browser-welcome')).toBeHidden();
}

type DroppedFile = { name: string; content: string; type?: string };

async function dropFiles(target: Locator, files: DroppedFile[]) {
  // Use each document's own constructors: parent and preview are separate realms.
  // This verifies event routing and navigation prevention, not OS drag initiation.
  return target.evaluate((element, entries) => {
    const view = element.ownerDocument.defaultView as Window & typeof globalThis;
    const transfer = new view.DataTransfer();
    for (const entry of entries) transfer.items.add(new view.File([entry.content], entry.name, { type: entry.type ?? 'text/html' }));
    const dragover = new view.DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    const drop = new view.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    element.dispatchEvent(dragover);
    element.dispatchEvent(drop);
    return { dragoverPrevented: dragover.defaultPrevented, dropPrevented: drop.defaultPrevented };
  }, files);
}

async function editHeading(page: Page, text: string) {
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.getByLabel('선택한 요소의 문구').fill(text);
  await expect(heading).toHaveText(text);
  await expect(page.locator('#save')).toBeEnabled();
}

async function downloadedText(download: Download) {
  // Mark the browser limitation only at the download boundary: failures in the
  // preceding editing, offline, or security assertions must still fail normally.
  test.fail(test.info().project.name === 'aside', 'Aside cancels Playwright Blob downloads, including an independently verified blank-page <a download> control.');
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function installNativeFileFixture(page: Page) {
  // This supplies a genuine browser file handle without automating an OS dialog.
  // User activation and the platform's native picker UI still require manual verification.
  await page.addInitScript((source) => {
    const harnessWindow = window as unknown as HarnessWindow;
    let handlePromise: Promise<FileSystemFileHandle> | undefined;
    let writeOriginal: FileSystemFileHandle['createWritable'];
    const ensureHandle = () => handlePromise ??= (async () => {
      const directory = await navigator.storage.getDirectory();
      const handle = await directory.getFileHandle('native-fixture.html', { create: true });
      writeOriginal = handle.createWritable.bind(handle);
      const writable = await writeOriginal();
      await writable.write(source);
      await writable.close();
      Object.defineProperty(handle, 'createWritable', {
        value: async (...args: Parameters<FileSystemFileHandle['createWritable']>) => {
          if (harnessWindow.__pagecraftFileTest.denyWrites) throw new DOMException('Write permission denied by the test fixture.', 'NotAllowedError');
          return writeOriginal(...args);
        },
      });
      return handle;
    })();
    harnessWindow.__pagecraftFileTest = {
      pickerCalls: 0,
      denyWrites: false,
      cancelPicker: false,
      read: async () => (await (await ensureHandle()).getFile()).text(),
      replace: async (next) => {
        await ensureHandle();
        const writable = await writeOriginal();
        await writable.write(next);
        await writable.close();
      },
    };
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => {
        harnessWindow.__pagecraftFileTest.pickerCalls++;
        if (harnessWindow.__pagecraftFileTest.cancelPicker) throw new DOMException('The file picker was canceled.', 'AbortError');
        return [await ensureHandle()];
      },
    });
  }, SOURCE);
}

async function openNative(page: Page) {
  await installNativeFileFixture(page);
  await page.goto(baseURL);
  await expect(page.locator('#open-file')).toBeVisible();
  await page.locator('#open-file').click();
  await expect(page.locator('#filename')).toHaveText('native-fixture.html');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Original heading');
}

async function browserBackups(page: Page) {
  return page.evaluate(() => new Promise<Array<{ name: string; source: string; createdAt: number }>>((resolve, reject) => {
    const request = indexedDB.open('pagecraft-backups', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('backups', 'readonly');
      const records = transaction.objectStore('backups').getAll();
      records.onerror = () => { database.close(); reject(records.error); };
      records.onsuccess = () => { database.close(); resolve(records.result); };
    };
  }));
}

test('opens under a URL subpath with an empty landing page and no local API', async ({ page }) => {
  await openFallback(page);
  await expect(page).toHaveTitle(/Pagecraft/);
  await expect(page.locator('#import')).toBeEnabled();
  await expect(page.locator('#open-file')).toBeHidden();
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveCount(0);
});

test('onboarding: edits a bundled sample without personal files, then downloads and reopens the result', async ({ page }) => {
  await openFallback(page);
  await expect(page.locator('#try-sample')).toBeEnabled();
  await expect(page.locator('#welcome-import')).toBeEnabled();
  await page.locator('#try-sample').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#filename')).toHaveText('Pagecraft-sample.html');
  await expect(page.locator('#browser-welcome')).toBeHidden();
  await expect(page.locator('#compatibility-notice')).toBeHidden();
  await expect(page.locator('#browser-draft-hint')).toBeVisible();
  expect(await page.locator('#file-input').evaluate(input => (input as HTMLInputElement).files?.length)).toBe(0);
  const heading = page.frameLocator('#preview').locator('#hero-title');
  await heading.click();
  await page.getByLabel('선택한 요소의 문구').fill('My first Pagecraft edit');
  await expect(heading).toHaveText('My first Pagecraft edit');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('Pagecraft-sample.html');
  const editedSource = await downloadedText(download);
  expect(editedSource).toContain('My first Pagecraft edit');
  expect(editedSource).toContain('Pagecraft sample document. All names and content are fictional.');
  expect(editedSource).not.toContain('data-muse-edit-id');
  await page.locator('#file-input').setInputFiles({ name: 'reopened-sample.html', mimeType: 'text/html', buffer: Buffer.from(editedSource) });
  await expect(page.locator('#discard-dialog')).toBeVisible();
  await page.locator('#discard-confirm').click();
  await expect(page.locator('#filename')).toHaveText('reopened-sample.html');
  await expect(heading).toHaveText('My first Pagecraft edit');
  await expect(page.locator('#save')).toBeDisabled();
});

test('inspector shows custom and mixed values without changing the document', async ({ page }) => {
  await openFallback(page);
  await page.locator('#try-sample').click();
  const heading = page.frameLocator('#preview').locator('#hero-title');
  const intro = page.frameLocator('#preview').locator('.intro');
  const weight = page.getByLabel('글자 굵기', { exact: true });
  await heading.click();
  await expect(weight).toHaveValue('650');
  await expect(weight.locator('option:checked')).toHaveText('현재 · 650');
  await expect(page.getByLabel('글자 정렬', { exact: true })).toHaveValue('start');
  await expect(page.locator('#save')).toBeDisabled();
  await intro.click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-count')).toHaveText('2개 선택');
  await expect(weight.locator('option:checked')).toHaveText('혼합');
  await expect(page.locator('#save')).toBeDisabled();
  await weight.selectOption('700');
  await expect(heading).toHaveCSS('font-weight', '700');
  await expect(intro).toHaveCSS('font-weight', '700');
  await page.locator('#undo').click();
  await expect(heading).toHaveCSS('font-weight', '650');
  await expect(intro).toHaveCSS('font-weight', '400');
  await expect(weight.locator('option:checked')).toHaveText('혼합');
  await heading.click();
  await expect(weight).toHaveValue('650');
  await weight.selectOption('700');
  await weight.selectOption('');
  await expect(heading).toHaveCSS('font-weight', '650');
  await expect(page.locator('#save')).toBeDisabled();
});

test('copy export status persists and distinguishes later edits without clearing undo history', async ({ page }) => {
  // Downloads can throttle WebKit's wall-clock timers. Advance the actual notification
  // timer deterministically, then verify that the persistent export status survives it.
  await page.clock.install();
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Exported revision');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  await pendingDownload;
  // Observe the app's request state, independently of browser download completion.
  await expect(page.locator('#save-state')).toContainText('사본 다운로드 요청됨');
  await expect(page.locator('#save-state')).toHaveAttribute('data-state', 'dirty');
  await page.clock.fastForward(5000);
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('#save-state')).toContainText('사본 다운로드 요청됨');
  await expect(page.locator('#browser-draft-hint')).toContainText('다운로드 목록');
  const heading = page.frameLocator('#preview').locator('#heading');
  const bounds = (await heading.boundingBox())!;
  await page.mouse.move(bounds.x + 25, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 55, bounds.y + 30, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(heading).toHaveCSS('translate', 'none');
  await expect(page.locator('#save-state')).toContainText('사본 다운로드 요청됨');
  await page.locator('#zoom-in').click();
  await expect(page.locator('#save-state')).toContainText('사본 다운로드 요청됨');
  await page.locator('#duplicate-selection').click();
  await expect(page.locator('#save-state')).toContainText('다운로드 요청 후 변경');
  await page.locator('#undo').click();
  await expect(page.frameLocator('#preview').locator('h1')).toHaveCount(1);
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Exported revision');
  await page.getByLabel('선택한 요소의 문구').fill('A later edit');
  await expect(page.locator('#save-state')).toContainText('다운로드 요청 후 변경');
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#reload').click();
  await page.locator('#discard-confirm').click();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Original heading');
  await expect(page.locator('#save-state')).not.toContainText('요청');
});

async function waitForDraft(page: Page) {
  await expect(page.locator('#draft-status')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
}

async function reloadWithDraft(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.locator('#browser-welcome')).toBeVisible();
  await expect(page.locator('#welcome-recovery')).toBeVisible();
}

test('recovery: restores Korean text and structural edits as a downloadable copy after reload', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, '복구할 한글 기획서');
  await page.locator('#duplicate-selection').click();
  await page.getByLabel('선택한 요소의 문구').fill('복구할 두 번째 제목');
  await waitForDraft(page);
  await reloadWithDraft(page);
  await page.locator('#welcome-recovery').click();
  await page.getByRole('button', { name: 'browser-fixture.html 복구', exact: true }).click();
  await expect(page.frameLocator('#preview').locator('h1')).toHaveText(['복구할 한글 기획서', '복구할 두 번째 제목']);
  await expect(page.locator('#save-state')).toContainText('복구한 사본');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-fixture-script', 'executed');
  await waitForDraft(page);
  await page.locator('#show-drafts').click();
  await expect(page.locator('.draft-item')).toHaveCount(2);
  await page.locator('#close-recovery').click();
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  const source = await downloadedText(await pendingDownload);
  expect(source).toContain('복구할 한글 기획서');
  expect(source).toContain('복구할 두 번째 제목');
  expect(source).toContain(UNCHANGED);
  expect(source).toContain(SCRIPT);
  expect(source).not.toContain('data-muse-edit-id');
});

test('recovery: captures idle direct typing and removes a canceled unsaved edit', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.dblclick();
  await page.keyboard.insertText('아직 직접 입력 중인 문구');
  await waitForDraft(page);
  // Saving the safety copy must not end the current text-editing interaction.
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.press('Escape');
  await expect(heading).toHaveText('Original heading');
  await expect(page.locator('#save')).toBeDisabled();
  await page.locator('#show-drafts').click();
  await expect(page.locator('#draft-list-empty')).toBeVisible();
  await page.locator('#close-recovery').click();
  await heading.dblclick();
  await page.keyboard.insertText('자동 보관 후 복구하는 입력');
  await waitForDraft(page);
  await reloadWithDraft(page);
  await page.locator('#welcome-recovery').click();
  await page.getByRole('button', { name: 'browser-fixture.html 복구', exact: true }).click();
  await expect(heading).toHaveText('자동 보관 후 복구하는 입력');
});

test('recovery: canceled replacement and canceled gestures retain the last useful draft', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Keep this draft');
  await waitForDraft(page);
  await page.locator('#reload').click();
  await page.locator('#discard-cancel').click();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep this draft');
  const bounds = (await page.frameLocator('#preview').locator('#heading').boundingBox())!;
  await page.mouse.move(bounds.x + 20, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 50, bounds.y + 25, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await waitForDraft(page);
  await reloadWithDraft(page);
  await page.locator('#welcome-recovery').click();
  await page.getByRole('button', { name: 'browser-fixture.html 복구', exact: true }).click();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep this draft');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveCSS('translate', 'none');
});

test('recovery: unavailable browser storage leaves editing and explicit download available', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, ...args) {
      if (name === 'pagecraft-drafts') throw new DOMException('Storage is denied by test policy', 'SecurityError');
      return original.call(this, name, ...args);
    };
  });
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Storage denial must keep my work');
  await expect(page.locator('#draft-status')).toHaveAttribute('data-state', 'error', { timeout: 10000 });
  await expect(page.locator('#retry-draft')).toBeVisible();
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toHaveAttribute('data-state', 'dirty');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Storage denial must keep my work');
  await page.locator('#retry-draft').click();
  await expect(page.locator('#draft-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#operation-error')).toBeHidden();
});

test('recovery: native editing does not autosave the original and explicit save removes its draft', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file handles are exercised in Chromium-based browsers.');
  await openNative(page);
  await editHeading(page, 'An explicit save is still required');
  await waitForDraft(page);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toBe(SOURCE);
  await page.locator('#save').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.locator('#show-drafts').click();
  await expect(page.locator('#draft-list-empty')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toContain('An explicit save is still required');
});

test('recovery: canceled inline revisions cannot hide different later text from persistence', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.getByLabel('글자 색상', { exact: true }).fill('#6d4c9b');
  await waitForDraft(page);
  await heading.dblclick();
  await page.keyboard.insertText('Canceled text A');
  await waitForDraft(page);
  await page.keyboard.press('Escape');
  await heading.dblclick();
  await page.keyboard.insertText('Keep later text B');
  await waitForDraft(page);
  await reloadWithDraft(page);
  await page.locator('#welcome-recovery').click();
  await page.getByRole('button', { name: 'browser-fixture.html 복구', exact: true }).click();
  await expect(heading).toHaveText('Keep later text B');
  await expect(heading).toHaveCSS('color', 'rgb(109, 76, 155)');
});

test('recovery: another tab restores a copy without consuming the active draft and missing records are disclosed', async ({ page, context }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Active tab draft');
  await waitForDraft(page);
  const other = await context.newPage();
  await other.goto(baseURL);
  await other.locator('#welcome-recovery').click();
  await other.getByRole('button', { name: 'browser-fixture.html 복구', exact: true }).click();
  await expect(other.locator('#filename')).toHaveText('browser-fixture.recovered.html');
  await expect(other.frameLocator('#preview').locator('#heading')).toHaveText('Active tab draft');
  await waitForDraft(other);
  await other.locator('#show-drafts').click();
  await expect(other.locator('.draft-item')).toHaveCount(2);
  const remove = other.getByRole('button', { name: 'browser-fixture.html 임시 보관본 삭제', exact: true });
  await remove.click();
  await expect(other.locator('.draft-item')).toHaveCount(2);
  await remove.click();
  await expect(other.locator('.draft-item')).toHaveCount(1);
  await page.bringToFront();
  await page.locator('#show-drafts').click();
  await expect(page.locator('#draft-status')).toHaveAttribute('data-state', 'missing');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Active tab draft');
  await page.locator('#close-recovery').click();
  await page.locator('#retry-draft').click();
  await waitForDraft(page);
  await page.locator('#show-drafts').click();
  await expect(page.locator('.draft-item')).toHaveCount(2);
  await other.close({ runBeforeUnload: false });
});

test('recovery: a native-file draft restores without acquiring or overwriting its externally changed original', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file handles are exercised in Chromium-based browsers.');
  await openNative(page);
  await editHeading(page, 'Recover separately from disk');
  await waitForDraft(page);
  const external = SOURCE.replace('Original heading', 'Changed outside Pagecraft');
  await page.evaluate(source => (window as unknown as HarnessWindow).__pagecraftFileTest.replace(source), external);
  await reloadWithDraft(page);
  await page.locator('#welcome-recovery').click();
  await page.getByRole('button', { name: 'native-fixture.html 복구', exact: true }).click();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Recover separately from disk');
  await expect(page.locator('#save')).toHaveText('HTML 내려받기');
  await expect(page.locator('#export-file')).toBeHidden();
  const readOriginal = () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle('native-fixture.html')).getFile()).text();
  });
  expect(await readOriginal()).toBe(external);
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  await pendingDownload;
  expect(await readOriginal()).toBe(external);
});

for (const realm of ['parent', 'preview'] as const) {
  test(`onboarding: dropping HTML on the ${realm} document opens a copy without navigation`, async ({ page }) => {
    await openFallback(page);
    await importCopy(page);
    const destination = realm === 'parent' ? page.locator('#canvas') : page.frameLocator('#preview').locator('#heading');
    const result = await dropFiles(destination, [{ name: `${realm}-drop.html`, content: '<!doctype html><h1 id="dropped-title">Dropped document</h1>' }]);
    expect(result).toEqual({ dragoverPrevented: true, dropPrevented: true });
    await expect(page.locator('#filename')).toHaveText(`${realm}-drop.html`);
    await expect(page.frameLocator('#preview').locator('#dropped-title')).toHaveText('Dropped document');
    await expect(page.locator('#save-state')).toContainText('사본');
    await expect(page.locator('#compatibility-notice')).toBeHidden();
    await expect(page).toHaveURL(baseURL);
    await expect(page.locator('#discard-dialog')).toBeHidden();
  });
}

test('onboarding: rejects invalid and multiple drops before discard confirmation and preserves the draft', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Keep my current draft');
  const invalidSets: DroppedFile[][] = [
    [{ name: 'not-html.txt', content: '<p>Wrong extension</p>', type: 'text/plain' }],
    [{ name: 'first.html', content: '<p>One</p>' }, { name: 'second.html', content: '<p>Two</p>' }],
  ];
  for (const target of [page.locator('#canvas'), page.frameLocator('#preview').locator('#heading')]) {
    for (const files of invalidSets) {
      expect((await dropFiles(target, files)).dropPrevented).toBe(true);
      await expect(page.locator('#toast.error')).toBeVisible();
      await expect(page.locator('#toast.error')).toHaveText(files.length > 1 ? 'HTML 파일을 한 번에 하나만 놓아 주세요.' : 'HTML 파일(.html 또는 .htm)을 선택하세요.');
      await expect(page.locator('#operation-error')).toBeHidden();
      await expect(page.locator('#discard-dialog')).toBeHidden();
      await expect(page.locator('#filename')).toHaveText('browser-fixture.html');
      await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep my current draft');
      await expect(page.locator('#save')).toBeEnabled();
      await expect(page).toHaveURL(baseURL);
    }
  }
});

test('onboarding: canceling a valid dropped replacement keeps unsaved changes', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Do not discard this draft');
  expect((await dropFiles(page.frameLocator('#preview').locator('#heading'), [{ name: 'replacement.html', content: '<p>Replacement</p>' }])).dropPrevented).toBe(true);
  await expect(page.locator('#discard-dialog')).toBeVisible();
  await page.locator('#discard-cancel').click();
  await expect(page.locator('#discard-dialog')).toBeHidden();
  await expect(page.locator('#filename')).toHaveText('browser-fixture.html');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Do not discard this draft');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#operation-error')).toBeHidden();
  await expect(page).toHaveURL(baseURL);
});

test('onboarding: explains limited HTML references and hides diagnostics for self-contained data content', async ({ page }) => {
  await openFallback(page);
  const linkedSource = `<!doctype html><head>
    <link rel="stylesheet" href="https://pagecraft-network.invalid/style.css"><link rel="stylesheet" href="./local.css">
    <script type="application/ld+json">{}</script><script>document.body.dataset.ran="yes"</script>
    </head><body><h1>Resources</h1><img src="//pagecraft-network.invalid/remote.png"><img src="./local.png"></body>`;
  await page.locator('#file-input').setInputFiles({ name: 'linked-assets.html', mimeType: 'text/html', buffer: Buffer.from(linkedSource) });
  await expect(page.locator('#filename')).toHaveText('linked-assets.html');
  await expect(page.locator('#compatibility-notice')).toBeVisible();
  await expect(page.locator('#compatibility-summary')).toBeVisible();
  if (await page.locator('#compatibility-notice').getAttribute('open') === null) await page.locator('#compatibility-summary').click();
  await expect(page.locator('#compatibility-list')).toBeVisible();
  await expect(page.locator('#compatibility-list li')).toHaveText([
    /스크립트 1개/, /외부 스타일 1개/, /외부 이미지·미디어 1개/, /별도 CSS 파일 1개/, /별도 이미지·미디어 파일 1개/,
  ]);
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-ran', 'yes');

  const embeddedSource = `<!doctype html><style>body{color:#123456}</style><script type="application/json">{"draft":true}</script>
    <script type="application/ld+json">{}</script><h1>Self-contained</h1><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
    <svg><defs><path id="line" d="M0 0L1 1"/></defs><use href="#line"/></svg>`;
  await page.locator('#file-input').setInputFiles({ name: 'embedded-assets.html', mimeType: 'text/html', buffer: Buffer.from(embeddedSource) });
  await expect(page.locator('#filename')).toHaveText('embedded-assets.html');
  await expect(page.locator('#compatibility-notice')).toBeHidden();
  await expect(page.frameLocator('#preview').locator('h1')).toHaveText('Self-contained');
});

test('imports, edits and duplicates an HTML copy, then downloads source-preserving patches', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-fixture-script', 'executed');
  await editHeading(page, 'Edited in the browser');
  await page.getByLabel('글자 색상', { exact: true }).fill('#7c3aed');
  await page.locator('#duplicate-selection').click();
  await expect(page.frameLocator('#preview').locator('h1')).toHaveCount(2);
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const result = await downloadedText(download);
  expect(result).toContain('Edited in the browser');
  expect(result).toMatch(/color\s*:\s*#7c3aed/i);
  expect(result.match(/<h1\b/g)).toHaveLength(2);
  expect(result).toContain('<!-- Preserve the original comment and whitespace. -->');
  expect(result).toContain(UNCHANGED);
  expect(result).toContain(SCRIPT);
  expect(result).toMatch(/^<!doctype html>\n<html lang="en">/);
  expect(result).not.toContain('data-muse-edit-id');
  expect(result).not.toContain('contenteditable');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toContainText('저장 전');
});

test('Control+S downloads edits without marking an unconfirmed download as saved', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Keyboard download');
  const pendingDownload = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await pendingDownload;
  expect(await downloadedText(download)).toContain('Keyboard download');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toContainText('저장 전');
});

test('canceling a fallback download retains unsaved edits and permits another save', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Keep edits after a canceled download');
  const pendingCanceledDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  await (await pendingCanceledDownload).cancel();
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toContainText('저장 전');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep edits after a canceled download');
});

test('nudges and drags at half zoom while Space-drag pans without changing document edits', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  // This regression checks exact free movement, independently of alignment assistance.
  await page.getByRole('button', { name: '드래그 자동 정렬', exact: true }).click();
  await expect(page.locator('#snap-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#zoom-fit').click();
  await page.locator('#zoom-out').click();
  await expect(page.locator('#zoom-value')).toHaveText('50%');
  await expect(page.locator('#preview')).toHaveCSS('width', '1440px');
  await expect(page.locator('#save')).toBeDisabled();
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(heading).toHaveCSS('translate', '1px 10px');
  const beforeMove = await heading.boundingBox();
  expect(beforeMove).not.toBeNull();
  await page.mouse.move(beforeMove!.x + 20, beforeMove!.y + beforeMove!.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeMove!.x + 40, beforeMove!.y + beforeMove!.height / 2 + 15, { steps: 8 });
  await page.mouse.up();
  await expect(heading).toHaveCSS('translate', '41px 40px');

  const beforePan = await page.locator('#preview').boundingBox();
  const panStart = await heading.boundingBox();
  expect(beforePan).not.toBeNull();
  expect(panStart).not.toBeNull();
  await page.locator('#canvas').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(panStart!.x + 20, panStart!.y + panStart!.height / 2);
  await page.mouse.down();
  await page.mouse.move(panStart!.x + 60, panStart!.y + panStart!.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const afterPan = await page.locator('#preview').boundingBox();
  expect(afterPan!.x - beforePan!.x).toBeCloseTo(40, 0);
  expect(afterPan!.y - beforePan!.y).toBeCloseTo(25, 0);
  await expect(heading).toHaveCSS('translate', '41px 40px');
  await expect(page.locator('#selection-count')).toHaveText('1개 선택');
  await page.locator('#undo').click();
  await expect(heading).toHaveCSS('translate', '1px 10px');
  await page.locator('#undo').click();
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#undo')).toBeDisabled();
});

test('reloads the cached application with its server unavailable, then imports, edits and downloads HTML', async ({ page }) => {
  await openFallback(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
  });
  // Stop the real origin instead of using browser-specific offline emulation.
  // The server is isolated to this serial test worker and restored in finally.
  const port = (server.address() as AddressInfo).port;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  try {
    await page.reload();
    await expect(page.locator('#browser-welcome')).toBeVisible();
    // navigator.onLine is a browser heuristic; prove an uncached network request
    // is unavailable instead of relying on its reported connectivity state.
    expect(await page.evaluate(async () => {
      try { await fetch(`./offline-network-probe?${crypto.randomUUID()}`, { cache: 'no-store' }); return false; }
      catch { return true; }
    })).toBe(true);
    await importCopy(page);
    await editHeading(page, 'Edited while offline');
    const pendingDownload = page.waitForEvent('download');
    await page.locator('#save').click();
    expect(await downloadedText(await pendingDownload)).toContain('Edited while offline');
    const cachedURLs = await page.evaluate(async () => {
      const keys = await caches.keys();
      const requests = await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()));
      return requests.flat().map((request) => request.url);
    });
    expect(cachedURLs.length).toBeGreaterThan(0);
    expect(cachedURLs.every((url) => new URL(url).pathname.startsWith('/tools/pagecraft/'))).toBe(true);
    expect(cachedURLs.some((url) => /browser-fixture|blob:|\/api\//.test(url))).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  }
});

test('blocks scripts and remote resources in imported HTML while preserving them in the export', async ({ page, context }) => {
  const remoteRequests: string[] = [];
  const popups: Page[] = [];
  page.on('popup', (popup) => { popups.push(popup); });
  await context.route('https://pagecraft-network.invalid/**', async (route) => {
    remoteRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'blocked fixture' });
  });
  await openFallback(page);
  const external = '<link rel="stylesheet" href="https://pagecraft-network.invalid/theme.css"><script src="https://pagecraft-network.invalid/tracker.js"></script>';
  const image = '<img src="https://pagecraft-network.invalid/pixel.png" onerror="document.body.dataset.imageError=\'executed\';parent.document.body.dataset.compromised=\'yes\'">';
  // The abrupt comment closer must not trick a prefix regex into placing the
  // trusted policy after attacker-controlled scripts or a nested document.
  const attack = '<!--><script>parent.document.body.dataset.compromised="yes";document.querySelectorAll("meta[http-equiv]").forEach(meta=>meta.remove());window.open("https://pagecraft-network.invalid/popup");fetch("https://pagecraft-network.invalid/fetch")</script><!-- -->';
  const nested = '<iframe srcdoc="&lt;script&gt;parent.parent.document.body.dataset.nestedCompromised=\'yes\'&lt;/script&gt;"></iframe>';
  const hostile = attack + SOURCE.replace('</head>', `${external}</head>`).replace('</main>', `${image}<iframe src="https://pagecraft-network.invalid/frame"></iframe>${nested}</main>`);
  await page.locator('#file-input').setInputFiles({ name: 'remote-resources.html', mimeType: 'text/html', buffer: Buffer.from(hostile) });
  await expect(page.locator('#filename')).toHaveText('remote-resources.html');
  await editHeading(page, 'Safe static preview');
  const body = page.frameLocator('#preview').locator('body');
  await expect(body).not.toHaveAttribute('data-fixture-script', 'executed');
  await expect(body).not.toHaveAttribute('data-image-error', 'executed');
  await expect(page.locator('body')).not.toHaveAttribute('data-compromised', 'yes');
  await expect(page.locator('body')).not.toHaveAttribute('data-nested-compromised', 'yes');
  expect(popups).toEqual([]);
  expect(remoteRequests).toEqual([]);
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save').click();
  const result = await downloadedText(await pendingDownload);
  expect(result).toContain(external);
  expect(result).toContain(image);
  expect(result).toContain(SCRIPT);
  expect(result).toContain(attack);
  expect(result).toContain(nested);
  expect(popups).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

test('writes source patches through a native file handle and supports a second save', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file-picker mode is available in Chromium-based browsers.');
  await openNative(page);
  await editHeading(page, 'First native save');
  await page.locator('#save').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#save')).toBeDisabled();
  const first = await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read());
  expect(first).toContain('First native save');
  expect(first).toContain(SCRIPT);
  expect(first).toContain(UNCHANGED);
  expect(first).not.toContain('data-muse-edit-id');
  const backups = await browserBackups(page);
  expect(backups).toHaveLength(1);
  expect(backups[0]).toMatchObject({ name: 'native-fixture.html', source: SOURCE });
  expect(backups[0]!.createdAt).toBeGreaterThan(0);
  await editHeading(page, 'Second native save');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toContain('Second native save');
  expect((await browserBackups(page)).map((backup) => backup.source)).toEqual(expect.arrayContaining([SOURCE, first]));
});

test('an imported copy says where its save will go and offers the original', async ({ page, browserName }) => {
  // Only Chromium can reopen the original, so only it gets the file-handle fixture.
  if (browserName === 'chromium') await installNativeFileFixture(page);
  await page.goto(baseURL);
  await importCopy(page);
  const hint = page.locator('#storage-hint');
  await expect(hint).toBeVisible();
  await expect(page.locator('#save')).toHaveText('HTML 내려받기');
  await expect(page.locator('#save-state')).toHaveText('사본 편집 · 다운로드로 저장');
  if (browserName === 'chromium') {
    await expect(hint).toContainText('저장하면 원본 대신 새 HTML이 내려받아집니다');
    await page.locator('#open-original').click();
    await expect(page.locator('#filename')).toHaveText('native-fixture.html');
    await expect(page.locator('#save')).toHaveText('원본 파일에 저장');
    await expect(hint).toBeHidden();
  } else {
    await expect(hint).toContainText('이 브라우저는 원본 파일에 저장할 수 없어');
    await expect(page.locator('#open-original')).toBeHidden();
  }
});

test('a dropped file saves back into itself instead of downloading a copy', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dropped files carry a file handle in Chromium-based browsers.');
  await installNativeFileFixture(page);
  await page.goto(baseURL);
  await expect(page.locator('#browser-welcome')).toBeVisible();
  // Chromium exposes the dropped file's handle on the DataTransferItem, but its own
  // DataTransfer cannot be given one from script, so the transfer is supplied here.
  // The drop routing itself has separate coverage; this asserts where the save goes.
  await page.evaluate(async () => {
    const [handle] = await (window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker();
    if (!handle) throw new Error('the fixture supplied no file handle');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [await handle.getFile()], items: [{ kind: 'file', getAsFileSystemHandle: async () => handle }] },
    });
    document.dispatchEvent(event);
  });
  await expect(page.locator('#filename')).toHaveText('native-fixture.html');
  await expect(page.locator('#save')).toHaveText('원본 파일에 저장');
  await editHeading(page, 'Saved through the dropped file');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toContain('Saved through the dropped file');
});

test('an installed app launched from the OS file association opens that file for direct saving', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'File handling launches carry a file handle in Chromium-based browsers.');
  await installNativeFileFixture(page);
  // Chromium queues launch files on window.launchQueue; the OS launch itself cannot be
  // automated, so the queue is supplied and delivers the fixture handle to the consumer.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {
        setConsumer: (consumer: (launch: { files: FileSystemFileHandle[] }) => void) => {
          void (window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker()
            .then((handles) => consumer({ files: handles }));
        },
      },
    });
  });
  await page.goto(baseURL);
  await expect(page.locator('#filename')).toHaveText('native-fixture.html');
  await expect(page.locator('#save')).toHaveText('원본 파일에 저장');
  await editHeading(page, 'Saved through the file association');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toContain('Saved through the file association');
});

test('origin-private fixture files are never offered as recent files', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'File handles are available in Chromium-based browsers.');
  // The recent list reopens the person's own files. The only genuine handle this
  // harness can make is origin-private, which is browser storage they cannot find
  // again — and which Chrome 153 crashes on when read back out of IndexedDB.
  // Reopening a picked or dropped file therefore has manual verification only.
  await openNative(page);
  await expect(page.locator('#recent-section')).toBeHidden();
  await page.goto(baseURL);
  await expect(page.locator('#browser-welcome')).toBeVisible();
  await expect(page.locator('#welcome-recent')).toBeHidden();
  await expect(page.locator('#welcome-recent-files button')).toHaveCount(0);
});

test('a recent list that crashed the browser while reading is dropped, not read again', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'File handles are available in Chromium-based browsers.');
  await page.goto(baseURL);
  await expect(page.locator('#browser-welcome')).toBeVisible();
  // Deserializing a stored handle crashes some browser builds, and a crash cannot be
  // caught. An unfinished read is what is left behind, and it must disable the list.
  await page.evaluate(async () => {
    localStorage.setItem('pagecraft-recent-read', '1');
    await new Promise((resolve) => {
      const request = indexedDB.open('pagecraft-recent', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles', { keyPath: 'id' }).createIndex('openedAt', 'openedAt');
      request.onsuccess = () => {
        const transaction = request.result.transaction('handles', 'readwrite');
        transaction.objectStore('handles').put({ id: '1', name: 'crashed.html', openedAt: Date.now() });
        transaction.oncomplete = () => resolve(undefined);
      };
    });
  });
  await page.reload();
  await expect(page.locator('#browser-welcome')).toBeVisible();
  await expect(page.locator('#welcome-recent')).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pagecraft-recent-read'))).toBeNull();
  // The store itself is cleared, so a later visit starts over instead of retrying it.
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some((item) => item.name === 'pagecraft-recent'))).toBe(false);
});

test('exports an edited native document as a copy without overwriting the selected file', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file-picker mode is available in Chromium-based browsers.');
  await openNative(page);
  await expect(page.locator('#export-file')).toBeEnabled();
  await editHeading(page, 'Export a separate copy');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#export-file').click();
  expect(await downloadedText(await pendingDownload)).toContain('Export a separate copy');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toBe(SOURCE);
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toContainText('저장 전');
});

test('refuses to overwrite an external change and retains the unsaved editor state', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file-picker mode is available in Chromium-based browsers.');
  await openNative(page);
  await editHeading(page, 'Unsaved editor change');
  const external = SOURCE.replace('Original heading', 'Changed by another program');
  await page.evaluate((source) => (window as unknown as HarnessWindow).__pagecraftFileTest.replace(source), external);
  await page.locator('#save').click();
  await expect(page.locator('#operation-error')).toBeVisible();
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toContainText('저장 전');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toBe(external);
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Unsaved editor change');
});

test('retains edits and the original file when write access is denied', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file-picker mode is available in Chromium-based browsers.');
  await openNative(page);
  await editHeading(page, 'Keep this unsaved edit');
  await page.evaluate(() => { (window as unknown as HarnessWindow).__pagecraftFileTest.denyWrites = true; });
  await page.locator('#save').click();
  await expect(page.locator('#operation-error')).toBeVisible();
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toContainText('저장 전');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toBe(SOURCE);
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep this unsaved edit');
});

test('canceling the native picker preserves the current unsaved document', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native file-picker mode is available in Chromium-based browsers.');
  await openNative(page);
  await editHeading(page, 'Keep edits when picker closes');
  await page.evaluate(() => { (window as unknown as HarnessWindow).__pagecraftFileTest.cancelPicker = true; });
  await page.locator('#open-file').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.pickerCalls)).toBe(2);
  await expect(page.locator('#discard-dialog')).not.toBeVisible();
  await expect(page.locator('#operation-error')).toBeHidden();
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep edits when picker closes');
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__pagecraftFileTest.read())).toBe(SOURCE);
});

async function openReportPaste(page: Page) {
  await page.locator('#new-report').click();
  await page.locator('#paste-details summary').click();
}

test('reports: starts a report on demand and can export it before making an edit', async ({ page }) => {
  await openFallback(page);
  expect(page.workers()).toHaveLength(0);
  await page.locator('#welcome-report').click();
  expect(page.workers()).toHaveLength(0);
  await page.locator('[data-report-template="weekly"]').click();
  await expect(page.locator('#filename')).toHaveText('주간-보고서.html');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save-state')).toHaveText('새 HTML · 내려받기 전');
  const report = page.frameLocator('#preview');
  await expect(report.locator('#weekly-title')).toBeVisible();
  await expect(report.locator('#weekly-summary-lead')).toHaveAttribute('data-muse-edit-id', /^e\d+$/);
  const pending = page.waitForEvent('download');
  await page.locator('#save').click();
  const source = await downloadedText(await pending);
  expect(source).toContain('id="weekly-title"');
  expect(source).toContain('@media print');
  expect(source).not.toContain('data-muse-edit-id');
  await page.locator('#file-input').setInputFiles({ name: 'reopened-report.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  await page.locator('#discard-confirm').click();
  await expect(report.locator('#weekly-title')).toBeVisible();
});

test('reports: imports fenced HTML without evaluating source and preserves it for export', async ({ page }) => {
  await openFallback(page);
  await openReportPaste(page);
  await page.locator('#report-filename').fill('AI-보고서.html');
  await page.locator('#report-html').fill('```html\n' + SOURCE + '\n```');
  await page.locator('#import-report-html').click();
  await expect(page.locator('#filename')).toHaveText('AI-보고서.html');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Original heading');
  await expect(page.frameLocator('#preview').locator('body')).not.toHaveAttribute('data-fixture-script', 'executed');
  await expect(page.locator('#save')).toBeEnabled();
  const pending = page.waitForEvent('download');
  await page.locator('#save').click();
  expect(await downloadedText(await pending)).toBe(SOURCE.trim());
});

test('reports: rejects invalid paste before discard and retains text when replacement is canceled', async ({ page }) => {
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Keep the human edit');
  await openReportPaste(page);
  await page.locator('#report-html').fill('AI explanation only, not HTML.');
  await page.locator('#import-report-html').click();
  await expect(page.locator('#report-status')).toContainText('완전한 HTML');
  await expect(page.locator('#discard-dialog')).not.toBeVisible();
  await page.locator('#report-html').fill(SOURCE);
  await page.locator('#report-filename').fill('../outside.html');
  await page.locator('#import-report-html').click();
  await expect(page.locator('#report-status')).toContainText('파일 이름');
  await page.locator('#report-filename').fill('report.html');
  // Dialog shortcuts must not save or undo the active document underneath it.
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep the human edit');
  await expect(page.locator('#save-state')).not.toContainText('다운로드 요청');
  // Native undo affects the dialog inputs. Re-enter the replacement before testing cancellation.
  await page.locator('#report-html').fill(SOURCE);
  await page.locator('#report-filename').fill('report.html');
  await page.locator('#import-report-html').click();
  await page.locator('#discard-cancel').click();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep the human edit');
  await page.locator('#new-report').click();
  await expect(page.locator('#report-html')).toHaveValue(SOURCE);
});

test('reports: clipboard denial offers selectable instructions without uploading document contents', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } });
  });
  await openFallback(page);
  await page.locator('#welcome-report').click();
  await page.locator('#prompt-details summary').click();
  await page.locator('#copy-report-prompt').click();
  await expect(page.locator('#report-status')).toContainText('⌘/Ctrl+C');
  await expect(page.locator('#report-prompt')).toBeFocused();
  expect(await page.locator('#report-prompt').evaluate((input: HTMLTextAreaElement) => input.selectionEnd - input.selectionStart)).toBeGreaterThan(300);
  expect(page.workers()).toHaveLength(0);
});

test('reports: canceling a delayed template load cannot replace the current document later', async ({ page }) => {
  // This test needs a pending request, rather than a service-worker cache hit.
  await page.addInitScript(() => { navigator.serviceWorker.register = async () => { throw new Error('Registration disabled for delayed-fetch test'); }; });
  await openFallback(page);
  await importCopy(page);
  await editHeading(page, 'Keep while loading a template');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/reports/ko/weekly-report.html', async route => { await held; await route.abort().catch(() => undefined); });
  await page.locator('#new-report').click();
  await page.locator('[data-report-template="weekly"]').click();
  await page.locator('#close-report').click();
  await page.locator('#new-report').click();
  release();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await expect(page.locator('#report-status')).toBeEmpty();
  await expect(page.frameLocator('#preview').locator('#heading')).toHaveText('Keep while loading a template');
  await expect(page.locator('#discard-dialog')).not.toBeVisible();
});

test('reports: bundled templates remain usable offline and the starter fits short windows', async ({ page }) => {
  await openFallback(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  // Stop the actual origin: WebKit offline emulation can bypass service-worker fetches.
  const port = (server.address() as AddressInfo).port;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    expect(await page.evaluate(async () => {
      try { await fetch('./uncached-report-probe', { cache: 'no-store' }); return false; } catch { return true; }
    })).toBe(true);
    await page.setViewportSize({ width: 667, height: 375 });
    await page.locator('#welcome-report').click();
    const bounds = await page.locator('#report-dialog').boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(343);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(667);
    await page.locator('[data-report-template="decision"]').click();
    await expect(page.locator('#filename')).toHaveText('의사결정-보고서.html');
    await expect(page.frameLocator('#preview').locator('#decision-title')).toBeVisible();
    await expect(page.locator('#save')).toBeEnabled();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  }
});
