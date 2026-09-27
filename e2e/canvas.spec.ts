import { expect, test, type Locator, type Page } from './korean-test.js';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHtmlEditorServer } from '../src/server.js';

const SOURCE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>캔버스 편집 시험</title>
<style>body{margin:64px;font-family:Arial,sans-serif;min-height:1600px}h1{margin:0;width:340px;font-size:28px;line-height:40px}#movable{width:280px;height:160px;margin-top:64px;background:#e9e3ff;border:1px solid #7650c4}#movable p{margin:16px}#other{width:300px;margin-top:64px;padding:16px;background:#f3f4f6}</style></head>
<body><!-- 원본 구조와 스타일 유지 -->
<h1 id="heading">기획서 첫 제목</h1>
<article id="movable" style="transform: rotate(2deg)"><p>이동할 카드</p></article>
<section id="other">두 번째 선택 요소</section>
</body></html>`;

// Slide decks built on `100vh` need the frame to stay a browser-sized window; a
// frame grown to its own content would redefine the unit the document measures with.
const VIEWPORT_DECK = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>화면 높이 장표</title>
<style>body{margin:0}.slide{width:100%;height:100vh;display:flex;align-items:center;justify-content:center;font-size:48px}#s2{background:#e9e3ff}</style></head>
<body><section class="slide" id="s1">슬라이드 1</section><section class="slide" id="s2">슬라이드 2</section></body></html>`;

// `margin:0 auto` re-centers the deck every time the frame grows, and `bleed`
// adds a child wider than the deck so the centering keeps shifting it right.
const deckSource = (width: number, bleed = 0) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>장표 보고</title>
<style>body{margin:0;background:#e9e8e3}.deck{width:${width}px;margin:0 auto;padding:28px 0}.slide{width:${width}px;height:900px;position:relative;background:#fff}#edge{position:absolute;right:56px;top:44px;width:220px;background:#e9e3ff}#bleed{width:${width + bleed}px;height:40px;background:#e9e3ff}</style></head>
<body><div class="deck"><section class="slide" id="s1"><div id="edge">오른쪽 끝 항목</div>${bleed ? '<div id="bleed"></div>' : ''}</section></div></body></html>`;

let temporaryRoot: string;
let root: string;
let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'muse-html-editor-canvas-'));
  root = join(temporaryRoot, 'workspace');
  await mkdir(root);
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

async function openFile(page: Page, file: string, source = SOURCE) {
  await writeFile(join(root, file), source, 'utf8');
  await page.goto(`${baseURL}/?file=${encodeURIComponent(file)}`);
  await expect(page.locator('#filename')).toHaveText(file);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await page.getByLabel('화면 너비').selectOption('1440');
  await page.locator('#zoom-reset').click();
  await expect(page.locator('#zoom-value')).toHaveText('100%');
  // Zoom is anchored at the viewport center. Bring the fixture's upper-left corner
  // back into view with the same real gesture available to a person editing it.
  const canvas = await bounds(page.locator('#canvas'));
  const preview = await bounds(page.locator('#preview'));
  await page.locator('#canvas').focus();
  await page.keyboard.down('Space');
  await drag(page, canvas.x + canvas.width / 2, canvas.y + canvas.height / 2,
    canvas.x + 28 - preview.x, canvas.y + 28 - preview.y);
  await page.keyboard.up('Space');
  const positioned = await bounds(page.locator('#preview'));
  expect(positioned.x).toBeCloseTo(canvas.x + 28, 0);
  expect(positioned.y).toBeCloseTo(canvas.y + 28, 0);
}

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

async function useFreeMovement(page: Page) {
  // These coordinate tests intentionally exercise unconstrained movement.
  // Snapping-on behavior has separate zoom, geometry, and persistence coverage.
  await page.getByRole('button', { name: '드래그 자동 정렬', exact: true }).click();
  await expect(page.locator('#snap-toggle')).toHaveAttribute('aria-pressed', 'false');
}

async function zoomValue(page: Page) {
  return parseFloat(await page.locator('#zoom-value').innerText());
}

async function zoomToHalf(page: Page) {
  await page.locator('#zoom-reset').click();
  for (let attempt = 0; attempt < 20 && await zoomValue(page) > 50; attempt++) {
    await page.locator('#zoom-out').click();
  }
  await expect(page.locator('#zoom-value')).toHaveText('50%');
}

async function expectUnchanged(page: Page, file: string) {
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readFile(join(root, file), 'utf8')).toBe(SOURCE);
  if ((await readdir(root)).includes('.history')) {
    expect((await readdir(join(root, '.history'))).filter((name) => name.startsWith(`${file}.`))).toHaveLength(0);
  }
}

async function expectOverlayAligned(page: Page, element: Locator) {
  await expect(page.locator('#selection-box')).toBeVisible();
  await expect.poll(async () => {
    const target = await bounds(element);
    const overlay = await bounds(page.locator('#selection-box'));
    return Math.max(...(['x', 'y', 'width', 'height'] as const).map((key) => Math.abs(target[key] - overlay[key])));
  }).toBeLessThan(3);
}

test('zoom controls scale the canvas from 25% to 300% without resizing or writing the document', async ({ page }) => {
  await openFile(page, 'zoom.html');
  const preview = page.locator('#preview');
  await expect(preview).toHaveCSS('width', '1440px');
  await expect(page.locator('#dimensions')).toHaveText('1440 px');
  await zoomToHalf(page);
  expect((await bounds(preview)).width).toBeCloseTo(720, 0);
  await expect(preview).toHaveCSS('width', '1440px');
  await expect(page.locator('#dimensions')).toHaveText('1440 px');

  for (let attempt = 0; attempt < 35 && await zoomValue(page) > 25; attempt++) await page.locator('#zoom-out').click();
  await expect(page.locator('#zoom-value')).toHaveText('25%');
  expect((await bounds(preview)).width).toBeCloseTo(360, 0);
  for (let attempt = 0; attempt < 60 && await zoomValue(page) < 300; attempt++) await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-value')).toHaveText('300%');
  expect((await bounds(preview)).width).toBeCloseTo(4320, 0);

  await page.locator('#zoom-fit').click();
  expect(await zoomValue(page)).toBeGreaterThanOrEqual(25);
  expect(await zoomValue(page)).toBeLessThan(100);
  const fitted = await bounds(preview);
  const canvas = await bounds(page.locator('#canvas'));
  expect(fitted.width).toBeLessThanOrEqual(canvas.width);
  expect(fitted.x).toBeGreaterThanOrEqual(canvas.x);
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
  await page.locator('#zoom-reset').click();
  expect((await bounds(preview)).width).toBeCloseTo(1440, 0);
  await expectUnchanged(page, 'zoom.html');
});

// The preview cannot scroll, so a document wider than the chosen width has to widen
// the frame, at whatever size the document is, instead of clipping its right side.
for (const [deckWidth, bleed] of [[1600, 0], [6400, 0], [2400, 240]] as const) {
  test(`a ${deckWidth}px slide deck keeps its right edge and fits on screen at every document width`, async ({ page }) => {
    const file = `deck-${deckWidth}-${bleed}.html`;
    const source = deckSource(deckWidth, bleed);
    await openFile(page, file, source);
    const preview = page.locator('#preview');
    const frameWidth = await preview.evaluate((element) => (element as HTMLIFrameElement).clientWidth);
    expect(frameWidth).toBeGreaterThanOrEqual(deckWidth + bleed);
    await expect(page.locator('#dimensions')).toHaveText(`${frameWidth} px · 내용 너비`);

    for (const width of ['390', '768', '1440']) {
      await page.getByLabel('화면 너비').selectOption(width);
      const geometry = await preview.evaluate((element) => {
        const document_ = (element as HTMLIFrameElement).contentDocument!;
        return {
          frame: (element as HTMLIFrameElement).clientWidth,
          deckRight: document_.querySelector('#s1')!.getBoundingClientRect().right,
          scrollWidth: document_.documentElement.scrollWidth,
        };
      });
      expect(geometry.frame).toBeGreaterThanOrEqual(deckWidth + bleed);
      expect(geometry.scrollWidth).toBe(geometry.frame);
      expect(geometry.deckRight).toBeLessThanOrEqual(geometry.frame);
    }

    // Fit has to reach the whole document even when that needs less than 25%.
    await page.locator('#zoom-fit').click();
    const canvas = await bounds(page.locator('#canvas'));
    const fitted = await bounds(preview);
    expect(fitted.width).toBeLessThanOrEqual(canvas.width);
    expect(fitted.x).toBeGreaterThanOrEqual(canvas.x - 1);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(await zoomValue(page)).toBeGreaterThan(0);

    await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
    await expect(page.locator('#save')).toBeDisabled();
    expect(await readFile(join(root, file), 'utf8')).toBe(source);
  });
}

test('a 100vh deck opens in screen mode, scrolls inside a browser-sized frame, and can be switched back', async ({ page }) => {
  await openFile(page, 'viewport-deck.html', VIEWPORT_DECK);
  const preview = page.locator('#preview');
  const screenMode = page.locator('#screen-mode');
  await expect(screenMode).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toHaveCSS('width', '1440px');
  await expect(preview).toHaveCSS('height', '900px');
  await expect(page.locator('#dimensions')).toHaveText('1440 × 900 px · 화면');
  await expect(page.locator('#compatibility-list li')).toHaveText([
    '화면 높이 단위(vh 등) 1곳을 사용합니다. 화면 모드로 선택한 화면 크기 안에서 스크롤하며 편집합니다.',
  ]);

  // `100vh` resolves against the frame, so each slide is exactly one screen tall.
  const slides = await preview.evaluate((element) => {
    const document_ = (element as HTMLIFrameElement).contentDocument!;
    return ['#s1', '#s2'].map((selector) => Math.round(document_.querySelector(selector)!.getBoundingClientRect().height));
  });
  expect(slides).toEqual([900, 900]);

  // An ordinary wheel over the document scrolls it instead of panning the canvas.
  const framed = await bounds(preview);
  await page.mouse.move(framed.x + framed.width / 2, framed.y + 200);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => preview.evaluate((element) =>
    (element as HTMLIFrameElement).contentDocument!.documentElement.scrollTop)).toBeGreaterThan(300);
  const afterScroll = await bounds(preview);
  expect(afterScroll.y).toBeCloseTo(framed.y, 0);

  const second = page.frameLocator('#preview').locator('#s2');
  await second.click();
  await expect(page.locator('#selected-tag')).toHaveText('SECTION');
  await expectOverlayAligned(page, second);

  await screenMode.click();
  await expect(screenMode).toHaveAttribute('aria-pressed', 'false');
  await expect(preview).toHaveCSS('width', '1440px');
  await expect(page.locator('#dimensions')).toHaveText('1440 px');
  expect(await readFile(join(root, 'viewport-deck.html'), 'utf8')).toBe(VIEWPORT_DECK);
});

// A document drawn rather than marked up: it renders and is preserved, but holds no
// HTML element to select, which the editor has to say rather than look broken.
const DRAWN = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>SVG 마인드맵</title><style>body{margin:0}</style></head>
<body><svg width="800" height="400"><rect x="40" y="40" width="200" height="60" rx="10" fill="#5b50bd"/><text x="140" y="78" text-anchor="middle" fill="#fff">중심 주제</text></svg></body></html>`;

test('a view left fitted refits when the canvas resizes, and a zoomed view is left alone', async ({ page }) => {
  await openFile(page, 'refit.html', deckSource(2400));
  await page.locator('#zoom-fit').click();
  const fitted = await zoomValue(page);
  expect(fitted).toBeLessThan(100);

  // Collapsing a panel widens the canvas: a fitted view follows it.
  await page.locator('#toggle-files').click();
  await expect.poll(() => zoomValue(page)).toBeGreaterThan(fitted);
  const widened = await zoomValue(page);
  const bounds = await page.locator('#preview').boundingBox();
  const canvas = await page.locator('#canvas').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);

  // Once the person picks a zoom, the same resize must not move their view.
  await page.locator('#zoom-in').click();
  const chosen = await zoomValue(page);
  expect(chosen).toBeGreaterThan(widened);
  await page.locator('#toggle-files').click();
  await page.waitForTimeout(100);
  expect(await zoomValue(page)).toBe(chosen);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readFile(join(root, 'refit.html'), 'utf8')).toBe(deckSource(2400));
});

test('the inspector shows values a person could type, not the browser\'s resolved ones', async ({ page }) => {
  await openFile(page, 'values.html');
  // A heading with no background of its own: the field stays empty so its own
  // placeholder can name the default instead of showing `rgba(0, 0, 0, 0)`.
  await page.frameLocator('#preview').locator('#heading').click();
  await expect(page.locator('#selected-tag')).toHaveText('H1');
  await expect(page.getByLabel('배경 색상', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('배경 색상', { exact: true })).toHaveAttribute('placeholder', 'transparent');
  // An element that does have one shows a hex colour, not an rgb() triple.
  await page.frameLocator('#preview').locator('#other').click();
  await expect(page.locator('#selected-tag')).toHaveText('SECTION');
  await expect(page.getByLabel('텍스트 색상', { exact: true })).toHaveValue(/^#[0-9a-f]{6}$/);
  await expect(page.getByLabel('배경 색상', { exact: true })).toHaveValue('#f3f4f6');
  // Lengths keep at most two decimals; a keyword such as `normal` passes through.
  for (const field of ['너비', '높이', '줄 간격']) {
    const value = await page.getByLabel(field, { exact: true }).inputValue();
    expect(value, `${field} keeps at most two decimals`).toMatch(/^(?:-?\d+(?:\.\d{1,2})?px|[a-z-]+)$/);
  }
  await expectUnchanged(page, 'values.html');
});

test('a document drawn in SVG explains that it has nothing to edit', async ({ page }) => {
  await openFile(page, 'drawn.html', DRAWN);
  await expect(page.locator('#node-count')).toHaveText('0');
  await expect(page.locator('.layers-empty')).toContainText('HTML 요소로 편집할 내용이 없습니다');
  const notice = page.locator('#compatibility-notice');
  await expect(notice).toBeVisible();
  if (await notice.getAttribute('open') === null) await page.locator('#compatibility-summary').click();
  await expect(page.locator('#compatibility-list li')).toContainText(['이 문서는 SVG·캔버스처럼 그림으로 그려져 있어(1곳)']);
  // The drawing still renders, and clicking it selects nothing rather than failing.
  await page.frameLocator('#preview').locator('svg').click({ position: { x: 100, y: 60 } });
  await expect(page.locator('#selection-count')).toHaveText('선택 없음');
  expect(await readFile(join(root, 'drawn.html'), 'utf8')).toBe(DRAWN);
});

test('Space drag pans from the iframe and empty canvas without changing the selected element', async ({ page }) => {
  await openFile(page, 'space-pan.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  const other = page.frameLocator('#preview').locator('#other');
  await heading.click();
  await expect(page.locator('#selected-tag')).toHaveText('H1');
  const before = await bounds(page.locator('#preview'));
  const target = await bounds(other);
  await page.keyboard.down('Space');
  await drag(page, target.x + 50, target.y + 20, 90, 50);
  await page.keyboard.up('Space');
  const after = await bounds(page.locator('#preview'));
  expect(after.x - before.x).toBeCloseTo(90, 0);
  expect(after.y - before.y).toBeCloseTo(50, 0);
  await expect(page.locator('#selected-tag')).toHaveText('H1');
  await expectOverlayAligned(page, heading);

  const canvas = await bounds(page.locator('#canvas'));
  await page.keyboard.down('Space');
  await drag(page, canvas.x + 8, canvas.y + 8, 45, 35);
  await page.keyboard.up('Space');
  const fromCanvas = await bounds(page.locator('#preview'));
  expect(fromCanvas.x - after.x).toBeCloseTo(45, 0);
  expect(fromCanvas.y - after.y).toBeCloseTo(35, 0);
  await expect(page.locator('#selected-tag')).toHaveText('H1');
  await other.click();
  await expect(page.locator('#selected-tag')).toHaveText('SECTION');
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expectUnchanged(page, 'space-pan.html');
});

test('hand tool drags over document content and returns to element selection', async ({ page }) => {
  await openFile(page, 'hand-pan.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await page.locator('#tool-hand').click();
  await expect(page.locator('#tool-hand')).toHaveAttribute('aria-pressed', 'true');
  const before = await bounds(page.locator('#preview'));
  const target = await bounds(page.frameLocator('#preview').locator('#other'));
  await drag(page, target.x + 40, target.y + 20, 70, -30);
  const after = await bounds(page.locator('#preview'));
  expect(after.x - before.x).toBeCloseTo(70, 0);
  expect(after.y - before.y).toBeCloseTo(-30, 0);
  await expect(page.locator('#selected-tag')).toHaveText('H1');
  await expectOverlayAligned(page, heading);
  await page.locator('#tool-select').click();
  await page.frameLocator('#preview').locator('#other').click();
  await expect(page.locator('#selected-tag')).toHaveText('SECTION');
  await expectUnchanged(page, 'hand-pan.html');
});

test('wheel pans while Ctrl-wheel zooms around the pointer and keeps selection aligned', async ({ page }) => {
  await openFile(page, 'wheel.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  const target = await bounds(heading);
  const pointer = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const before = await bounds(page.locator('#preview'));
  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomValue(page)).toBeGreaterThan(100);
  const zoomed = await bounds(page.locator('#preview'));
  const ratio = zoomed.width / before.width;
  // Chrome quantizes wheel client coordinates inside the transformed iframe.
  expect(Math.abs(zoomed.x + (pointer.x - before.x) * ratio - pointer.x)).toBeLessThan(2);
  expect(Math.abs(zoomed.y + (pointer.y - before.y) * ratio - pointer.y)).toBeLessThan(2);
  await expectOverlayAligned(page, heading);

  const scale = await zoomValue(page);
  await page.mouse.wheel(35, 45);
  await expect.poll(async () => (await bounds(page.locator('#preview'))).y).toBeLessThan(zoomed.y - 30);
  const panned = await bounds(page.locator('#preview'));
  expect(panned.x - zoomed.x).toBeCloseTo(-35, 0);
  expect(panned.y - zoomed.y).toBeCloseTo(-45, 0);
  expect(await zoomValue(page)).toBe(scale);
  await expect(page.locator('#selected-tag')).toHaveText('H1');
  await expectOverlayAligned(page, heading);

  const nextTarget = await bounds(heading);
  const nextPointer = { x: nextTarget.x + nextTarget.width / 2, y: nextTarget.y + nextTarget.height / 2 };
  await page.mouse.move(nextPointer.x, nextPointer.y);
  await page.keyboard.down('Meta');
  await page.mouse.wheel(0, -90);
  await page.keyboard.up('Meta');
  await expect.poll(() => zoomValue(page)).toBeGreaterThan(scale);
  const metaZoomed = await bounds(page.locator('#preview'));
  const metaRatio = metaZoomed.width / panned.width;
  expect(Math.abs(metaZoomed.x + (nextPointer.x - panned.x) * metaRatio - nextPointer.x)).toBeLessThan(2);
  expect(Math.abs(metaZoomed.y + (nextPointer.y - panned.y) * metaRatio - nextPointer.y)).toBeLessThan(2);
  await expectOverlayAligned(page, heading);
  await expectUnchanged(page, 'wheel.html');
});

test('Space remains a text character in both the inspector and direct text editing', async ({ page }) => {
  await openFile(page, 'text-space.html');
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  const before = await bounds(page.locator('#preview'));
  const textarea = page.getByLabel('선택한 요소의 텍스트');
  await textarea.fill('두');
  await textarea.press('End');
  await page.keyboard.press('Space');
  await page.keyboard.insertText('단어');
  await expect(textarea).toHaveValue('두 단어');
  await expect(heading).toHaveText('두 단어');
  await heading.dblclick();
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.insertText('직접');
  await page.keyboard.press('Space');
  await page.keyboard.insertText('편집');
  await page.locator('.inspector-heading').click();
  await expect(heading).not.toHaveAttribute('contenteditable');
  await expect(heading).toHaveText('직접 편집');
  await expect(textarea).toHaveValue('직접 편집');
  const after = await bounds(page.locator('#preview'));
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
});

test('focused editor buttons and dialogs retain native Space and Enter activation', async ({ page }) => {
  await openFile(page, 'native-control-keys.html');
  await page.locator('#help').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await expect(page.locator('#canvas')).not.toHaveClass(/hand-mode/);
  await expect(page.locator('#close-help')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#shortcuts-dialog')).toBeHidden();
  await page.locator('#help').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await page.locator('#close-help').press('Enter');
  await expect(page.locator('#shortcuts-dialog')).toBeHidden();
  await page.locator('#zoom-out').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#zoom-value')).toHaveText('75%');
  await expect(page.locator('#canvas')).not.toHaveClass(/hand-mode/);
  await expectUnchanged(page, 'native-control-keys.html');
});

test('focused compatibility summary retains native keyboard toggling', async ({ page }) => {
  const source = SOURCE.replace('</body>', '<script type="module">document.body.dataset.unwanted="yes";</script></body>');
  await openFile(page, 'native-summary-key.html', source);
  const details = page.locator('#compatibility-notice');
  const summary = page.locator('#compatibility-summary');
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute('open');
  await summary.focus();
  await page.keyboard.press('Space');
  await expect(details).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open');
  await expect(page.locator('#canvas')).not.toHaveClass(/hand-mode/);
  await expect(page.locator('#save')).toBeDisabled();
  expect(await readFile(join(root, 'native-summary-key.html'), 'utf8')).toBe(source);
});

test('Space on a focused HTML preview button still pans the document', async ({ page }) => {
  const source = SOURCE.replace('</body>', '<button id="preview-button" type="button">Preview content</button></body>');
  await openFile(page, 'preview-button-pan.html', source);
  const button = page.frameLocator('#preview').locator('#preview-button');
  await button.focus();
  const target = await bounds(button);
  const before = await bounds(page.locator('#preview'));
  await page.keyboard.down('Space');
  await expect(page.locator('#canvas')).toHaveClass(/hand-mode/);
  await drag(page, target.x + target.width / 2, target.y + target.height / 2, 48, 24);
  await page.keyboard.up('Space');
  const after = await bounds(page.locator('#preview'));
  expect(after.x - before.x).toBeCloseTo(48, 0);
  expect(after.y - before.y).toBeCloseTo(24, 0);
  await expect(page.locator('#canvas')).not.toHaveClass(/hand-mode/);
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readFile(join(root, 'preview-button-pan.html'), 'utf8')).toBe(source);
});

test('camera wheel bursts render once per frame and retain accumulated movement', async ({ page }) => {
  await openFile(page, 'wheel-burst.html');
  const result = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = document.querySelector('#canvas')!;
    const artboard = document.querySelector('#frame-wrap')!;
    const frame = document.querySelector('#preview')!;
    const before = frame.getBoundingClientRect();
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(artboard, { attributes: true, attributeFilter: ['style'] });
    for (let index = 0; index < 20; index++) canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 1, deltaY: 2 }));
    const immediateMutations = observer.takeRecords().length;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    mutations += observer.takeRecords().length;
    observer.disconnect();
    const after = frame.getBoundingClientRect();
    return { immediateMutations, mutations, dx: after.x - before.x, dy: after.y - before.y };
  });
  expect(result).toEqual({ immediateMutations: 0, mutations: 1, dx: -20, dy: -40 });
  await expectUnchanged(page, 'wheel-burst.html');
});

test('coalesced iframe zoom events preserve the pointer anchor before the next paint', async ({ page }) => {
  await openFile(page, 'zoom-burst.html');
  const result = await page.evaluate(async () => {
    const frame = document.querySelector('#preview') as HTMLIFrameElement;
    const heading = frame.contentDocument!.querySelector('#heading')!;
    const rectangle = heading.getBoundingClientRect();
    const before = frame.getBoundingClientRect();
    const clientX = rectangle.left + rectangle.width / 2;
    const clientY = rectangle.top + rectangle.height / 2;
    const anchor = { x: before.x + clientX, y: before.y + clientY };
    const frameView = frame.contentWindow as Window & typeof globalThis;
    for (let index = 0; index < 12; index++) heading.dispatchEvent(new frameView.WheelEvent('wheel', {
      bubbles: true, cancelable: true, ctrlKey: true, deltaY: -5, clientX, clientY, view: frameView,
    }));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const after = frame.getBoundingClientRect();
    const scale = after.width / before.width;
    return { scale, xError: after.x + clientX * scale - anchor.x, yError: after.y + clientY * scale - anchor.y };
  });
  expect(result.scale).toBeCloseTo(Math.exp(.3), 4);
  expect(Math.abs(result.xError)).toBeLessThan(1);
  expect(Math.abs(result.yError)).toBeLessThan(1);
  await expectUnchanged(page, 'zoom-burst.html');
});

test('selection focus restores readable text scale and fits larger elements without editing the file', async ({ page }) => {
  const source = SOURCE.replace('#movable{width:280px;height:160px', '#movable{width:1200px;height:900px');
  await openFile(page, 'selection-focus.html', source);
  await expect(page.locator('#zoom-selection')).toBeDisabled();
  await zoomToHalf(page);
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  await expect(page.locator('#zoom-selection')).toBeEnabled();
  await page.locator('#zoom-selection').click();
  await expect(page.locator('#zoom-value')).toHaveText('100%');
  const canvas = await bounds(page.locator('#canvas'));
  const focusedHeading = await bounds(heading);
  expect(focusedHeading.x + focusedHeading.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, 0);
  expect(focusedHeading.y + focusedHeading.height / 2).toBeCloseTo(canvas.y + canvas.height / 2, 0);

  await page.getByLabel('요소 검색').fill('article#movable');
  await expect(page.locator('#layers .layer')).toHaveCount(1);
  await page.locator('#layers .layer').click();
  await page.locator('#zoom-selection').click();
  expect(await zoomValue(page)).toBeGreaterThanOrEqual(25);
  expect(await zoomValue(page)).toBeLessThan(100);
  const focusedArticle = await bounds(page.frameLocator('#preview').locator('#movable'));
  expect(focusedArticle.width).toBeLessThanOrEqual(canvas.width - 63);
  expect(focusedArticle.height).toBeLessThanOrEqual(canvas.height - 63);
  expect(focusedArticle.x + focusedArticle.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, 0);
  expect(focusedArticle.y + focusedArticle.height / 2).toBeCloseTo(canvas.y + canvas.height / 2, 0);
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readFile(join(root, 'selection-focus.html'), 'utf8')).toBe(source);
});

test('dragging at 50% uses document coordinates, supports undo and redo, and saves only element movement', async ({ page }) => {
  await openFile(page, 'move.html');
  await useFreeMovement(page);
  await zoomToHalf(page);
  const movable = page.frameLocator('#preview').locator('#movable');
  const before = await bounds(movable);
  const transform = await movable.evaluate((element) => getComputedStyle(element).transform);
  await drag(page, before.x + before.width / 2, before.y + before.height / 2, 100, 40);
  await expect(page.locator('#selected-tag')).toHaveText('ARTICLE');
  await expect(movable).toHaveCSS('translate', '200px 80px');
  await expect(movable).toHaveCSS('transform', transform);
  const moved = await bounds(movable);
  expect(moved.x - before.x).toBeCloseTo(100, 0);
  expect(moved.y - before.y).toBeCloseTo(40, 0);
  await expectOverlayAligned(page, movable);
  await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');

  await page.locator('#undo').click();
  await expect(movable).toHaveCSS('translate', 'none');
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  const undone = await bounds(movable);
  expect(undone.x).toBeCloseTo(before.x, 0);
  expect(undone.y).toBeCloseTo(before.y, 0);
  await page.locator('#redo').click();
  await expect(movable).toHaveCSS('translate', '200px 80px');
  await page.locator('#zoom-fit').click();
  await page.locator('#save').click();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(page.getByRole('status')).toContainText('저장했습니다.');

  const saved = await readFile(join(root, 'move.html'), 'utf8');
  expect(saved).toMatch(/translate\s*:\s*200px 80px/);
  expect(saved).toContain('transform: rotate(2deg)');
  expect(saved).toContain('<!-- 원본 구조와 스타일 유지 -->');
  expect(saved.indexOf('id="heading"')).toBeLessThan(saved.indexOf('id="movable"'));
  expect(saved.indexOf('id="movable"')).toBeLessThan(saved.indexOf('id="other"'));
  expect(saved).not.toMatch(/data-muse-edit-id|contenteditable|frame-wrap|selection-box|scale\(/);
  expect(saved.replace(/<article id="movable" style="[^"]*">/, '<article id="movable" style="transform: rotate(2deg)">')).toBe(SOURCE);
  const backups = (await readdir(join(root, '.history'))).filter((file) => file.startsWith('move.html.'));
  expect(backups).toHaveLength(1);
  expect(await readFile(join(root, '.history', backups[0]!), 'utf8')).toBe(SOURCE);
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
  await expect(movable).toHaveCSS('translate', '200px 80px');
  await expect(movable).toHaveCSS('transform', transform);
});

test('resize handle uses document dimensions after zooming and panning', async ({ page }) => {
  await openFile(page, 'resize-scale.html');
  await zoomToHalf(page);
  const heading = page.frameLocator('#preview').locator('#heading');
  await heading.click();
  const originalSize = await heading.evaluate((element) => {
    const css = getComputedStyle(element);
    return { width: parseFloat(css.width), height: parseFloat(css.height) };
  });
  const target = await bounds(heading);
  await page.keyboard.down('Space');
  await drag(page, target.x + 30, target.y + 10, 30, 20);
  await page.keyboard.up('Space');
  await expectOverlayAligned(page, heading);
  const handle = await bounds(page.locator('#resize-handle'));
  await drag(page, handle.x + handle.width / 2, handle.y + handle.height / 2, 40, 20);
  await expect(heading).toHaveCSS('width', `${originalSize.width + 80}px`);
  await expect(heading).toHaveCSS('height', `${originalSize.height + 40}px`);
  await expect(heading).toHaveCSS('translate', 'none');
  await expectOverlayAligned(page, heading);
  await page.locator('#undo').click();
  await expect(heading).toHaveCSS('width', `${originalSize.width}px`);
  await expect(heading).toHaveCSS('height', `${originalSize.height}px`);
  await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
});

test('arrow keys nudge by 1 or 10 pixels and Escape cancels a drag without adding an undo step', async ({ page }) => {
  await openFile(page, 'keyboard-move.html');
  await useFreeMovement(page);
  const movable = page.frameLocator('#preview').locator('#movable');
  await movable.click();
  await expect(page.locator('#selected-tag')).toHaveText('ARTICLE');
  await page.keyboard.press('ArrowRight');
  await expect(movable).toHaveCSS('translate', '1px');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(movable).toHaveCSS('translate', '1px 10px');

  const before = await bounds(movable);
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 35, { steps: 5 });
  await expect(movable).toHaveCSS('translate', '71px 45px');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(movable).toHaveCSS('translate', '1px 10px');
  const canceled = await bounds(movable);
  expect(canceled.x).toBeCloseTo(before.x, 0);
  expect(canceled.y).toBeCloseTo(before.y, 0);
  await page.locator('#undo').click();
  await expect(movable).toHaveCSS('translate', 'none');
  await expectUnchanged(page, 'keyboard-move.html');
});

test('leaving the editor with Space held clears temporary pan mode when focus returns', async ({ page, context }) => {
  await openFile(page, 'blur-recovery.html');
  await useFreeMovement(page);
  const movable = page.frameLocator('#preview').locator('#movable');
  await movable.click();
  await page.keyboard.down('Space');
  await expect(page.locator('#canvas')).toHaveClass(/hand-mode/);
  // Playwright normally emulates every page as focused, including background tabs.
  // Disable that emulation so the real browser blur event can exercise recovery.
  const editorSession = await context.newCDPSession(page);
  await editorSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const otherTab = await context.newPage();
  try {
    await otherTab.goto('about:blank');
    await otherTab.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
    await expect(page.locator('#canvas')).not.toHaveClass(/hand-mode/);
    await otherTab.keyboard.up('Space');
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    const beforeFrame = await bounds(page.locator('#preview'));
    const target = await bounds(movable);
    await drag(page, target.x + target.width / 2, target.y + target.height / 2, 20, 10);
    await expect(movable).toHaveCSS('translate', '20px 10px');
    const afterFrame = await bounds(page.locator('#preview'));
    expect(afterFrame.x).toBeCloseTo(beforeFrame.x, 0);
    expect(afterFrame.y).toBeCloseTo(beforeFrame.y, 0);
    await page.locator('#undo').click();
    await expectUnchanged(page, 'blur-recovery.html');
  } finally {
    await editorSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await editorSession.detach();
    await page.keyboard.up('Space');
    await otherTab.close();
  }
});
