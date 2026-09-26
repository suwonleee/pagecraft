import { expect, test, type Page } from './korean-test.js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHtmlEditorServer } from '../src/server.js';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const fixture = new URL('../fixtures/reports/ko/weekly-report.html', import.meta.url);
const humanDetail = '사람이 확인한 내용: 고객 인터뷰 3건을 검토했습니다. 결과는 다음 주 회의에서 확인합니다.';
const aiLead = 'AI가 정리한 요약: 고객 인터뷰를 검토했으며, 성과 판단에 필요한 지표는 아직 확인 중입니다.';
const reviewedTitle = '사람과 AI가 함께 검토한 주간 보고';

type Inspection = { version: number; hash: string; nodes: { id: string; htmlId: string | null; text: string | null }[] };
type Applied = { version: number; written: boolean; hashBefore: string; hashAfter: string; backup: string; output: string };
let root: string;
let file: string;
let source: string;
let server: Server;
let baseURL: string;

async function documentCommand(...args: string[]) {
  // Playwright forces color for its reporter; the CLI's machine-readable streams
  // must not inherit a conflicting FORCE_COLOR/NO_COLOR pair from the test runner.
  const environment = { ...process.env };
  delete environment.FORCE_COLOR;
  return execute(process.execPath, ['--import', 'tsx', 'src/document-cli.ts', ...args], {
    cwd: repository, env: environment, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  });
}

async function inspect() {
  const result = await documentCommand('inspect', file);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as Inspection;
}

async function editText(page: Page, htmlId: string, text: string) {
  const element = page.frameLocator('#preview').locator(`#${htmlId}`);
  await element.click();
  await page.getByLabel('선택한 요소의 문구').fill(text);
  await expect(element).toHaveText(text);
}

async function save(page: Page, status = 200) {
  const response = page.waitForResponse(result => result.url().endsWith('/api/save') && result.request().method() === 'POST');
  await page.getByRole('button', { name: /^파일에 저장/ }).click();
  expect((await response).status()).toBe(status);
  if (status === 200) await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
}

test.beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pagecraft-report-collaboration-')));
  file = join(root, 'weekly-report.html');
  source = await readFile(fixture, 'utf8');
  await writeFile(file, source, 'utf8');
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
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test('hands one HTML report between the visual editor and CLI without overwriting newer work', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const original = await inspect();
  expect(original.version).toBe(1);
  expect(original.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(original.nodes.find(node => node.htmlId === 'weekly-summary-lead')?.text).toBeTruthy();
  const patchFile = join(root, 'edits.json');
  const patch = (hash: string) => JSON.stringify({ version: 1, hash, changes: [{ target: 'weekly-summary-lead', text: aiLead }] });

  await test.step('save a human edit and reject an AI patch made from the older inspection', async () => {
    await page.goto(`${baseURL}/?file=weekly-report.html`);
    await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
    await editText(page, 'weekly-summary-detail', humanDetail);
    expect(await readFile(file, 'utf8')).toBe(source);
    await save(page);
    const afterHuman = await readFile(file, 'utf8');
    expect(afterHuman).toContain(humanDetail);
    const backups = await readdir(join(root, '.history'));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(root, '.history', backups[0]!), 'utf8')).toBe(source);

    await writeFile(patchFile, patch(original.hash), 'utf8');
    const rejected = await documentCommand('apply', file, '--patch', patchFile, '--write').then(
      () => { throw new Error('The stale CLI patch must fail without writing.'); },
      (error: { code?: number; stdout?: string; stderr?: string }) => error,
    );
    expect(rejected.code).toBe(1);
    expect(rejected.stdout).toBe('');
    expect(JSON.parse(rejected.stderr!)).toMatchObject({ version: 1, error: { code: 'STALE_HASH' } });
    expect(await readFile(file, 'utf8')).toBe(afterHuman);
    expect(await readdir(join(root, '.history'))).toEqual(backups);
  });

  const current = await inspect();
  expect(current.hash).not.toBe(original.hash);
  expect(current.nodes.find(node => node.htmlId === 'weekly-summary-detail')?.text).toBe(humanDetail);
  const afterHuman = await readFile(file, 'utf8');
  let applied: Applied;
  let afterAI: string;
  await test.step('apply the AI edit by stable HTML id and keep the human edit and backup', async () => {
    await writeFile(patchFile, patch(current.hash), 'utf8');
    const result = await documentCommand('apply', file, '--patch', patchFile, '--write');
    expect(result.stderr).toBe('');
    applied = JSON.parse(result.stdout) as Applied;
    expect(applied).toMatchObject({ version: 1, written: true, hashBefore: current.hash, output: file });
    expect(applied.hashAfter).not.toBe(current.hash);
    expect(applied.backup.startsWith(join(root, '.history') + '/')).toBe(true);
    expect(await readFile(applied.backup, 'utf8')).toBe(afterHuman);
    afterAI = await readFile(file, 'utf8');
    expect(afterAI).toContain(humanDetail);
    expect(afterAI).toContain(aiLead);
    expect(afterAI.match(/<style>[\s\S]*?<\/style>/)?.[0]).toBe(source.match(/<style>[\s\S]*?<\/style>/)?.[0]);
    expect(await readdir(join(root, '.history'))).toHaveLength(2);
  });

  await test.step('reject the stale browser save and explicitly reopen the latest shared file', async () => {
    await editText(page, 'weekly-title', reviewedTitle);
    await save(page, 409);
    await expect(page.getByRole('status')).toContainText('다른 프로그램에서 파일이 변경');
    await expect(page.locator('#save-state')).toHaveText('1개 요소 · 저장 전');
    await expect(page.frameLocator('#preview').locator('#weekly-title')).toHaveText(reviewedTitle);
    expect(await readFile(file, 'utf8')).toBe(afterAI!);
    expect(await readdir(join(root, '.history'))).toHaveLength(2);

    await page.locator('#reload').click();
    await expect(page.locator('#discard-dialog')).toBeVisible();
    await page.getByRole('button', { name: '변경 버리고 열기', exact: true }).click();
    await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
    await expect(page.frameLocator('#preview').locator('#weekly-summary-detail')).toHaveText(humanDetail);
    await expect(page.frameLocator('#preview').locator('#weekly-summary-lead')).toHaveText(aiLead);
    // The stale, unsaved title was explicitly discarded, not silently merged.
    await expect(page.frameLocator('#preview').locator('#weekly-title')).toHaveText('제품 운영 주간 보고');
  });

  await test.step('review, save and reopen the report with both contributors’ changes intact', async () => {
    await editText(page, 'weekly-title', reviewedTitle);
    await save(page);
    const finalSource = await readFile(file, 'utf8');
    const final = await inspect();
    expect(final.nodes.find(node => node.htmlId === 'weekly-title')?.text).toBe(reviewedTitle);
    expect(final.nodes.find(node => node.htmlId === 'weekly-summary-detail')?.text).toBe(humanDetail);
    expect(final.nodes.find(node => node.htmlId === 'weekly-summary-lead')?.text).toBe(aiLead);
    expect(finalSource.match(/<style>[\s\S]*?<\/style>/)?.[0]).toBe(source.match(/<style>[\s\S]*?<\/style>/)?.[0]);
    expect(finalSource).toContain('<!-- Fictional report starter. Replace example statements and missing values before sharing. -->');
    expect(finalSource).not.toMatch(/data-muse-|contenteditable|selection-box/);
    const backups = await readdir(join(root, '.history'));
    expect(backups).toHaveLength(3);
    expect(await Promise.all(backups.map(name => readFile(join(root, '.history', name), 'utf8')))).toEqual(expect.arrayContaining([source, afterHuman, afterAI!]));

    await page.reload();
    await expect(page.locator('#save-state')).toHaveText('파일에 저장됨');
    await expect(page.frameLocator('#preview').locator('#weekly-title')).toHaveText(reviewedTitle);
    await expect(page.frameLocator('#preview').locator('#weekly-summary-detail')).toHaveText(humanDetail);
    await expect(page.frameLocator('#preview').locator('#weekly-summary-lead')).toHaveText(aiLead);
    await expect(page.locator('#save')).toBeDisabled();
    expect(pageErrors).toEqual([]);
    await testInfo.attach('human-ai-report-handoff', {
      body: JSON.stringify({ initialHash: original.hash, humanHash: current.hash, aiHash: applied!.hashAfter, finalHash: final.hash, backups: backups.length, staleCLIRejected: true, staleBrowserStatus: 409, pageErrors }, null, 2),
      contentType: 'application/json',
    });
  });
});
