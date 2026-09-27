import { expect, test } from './korean-test.js';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../src/static-server.js';

type Draft = {
  id: string; name: string; source: string; sourceHash: string; version: 1; updatedAt?: number;
  changes: { id: string; text?: string; styles?: Record<string, string> }[];
  operations: ({ type: 'delete'; id: string } | { type: 'duplicate'; id: string; copyId: string; changes: Draft['changes'] })[];
};
type Metadata = { id: string; name: string; updatedAt: number; version: number; bytes: number; sourceBytes: number; sourceHash: string };
type DraftStore = {
  listDrafts(): Promise<Metadata[]>; getDraft(id: string): Promise<Draft | undefined>;
  putDraft(draft: Draft): Promise<Metadata>; deleteDraft(id: string): Promise<void>; close(): void;
};
type StoreWindow = Window & { draftStore: DraftStore; createDraftStore: () => DraftStore };

let root: string;
let server: Server;
let baseURL: string;
const draft = (id: string, updatedAt = 100): Draft => ({
  id, name: `${id}.html`, source: '<!doctype html><h1>한국어 초안</h1>', sourceHash: 'a'.repeat(64),
  version: 1, updatedAt, changes: [{ id: 'e15', text: '복구할 문구', styles: { color: 'red' } }], operations: [],
});

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pagecraft-draft-store-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Draft persistence test</title>');
  for (const file of ['draft-store.js', 'i18n.js', 'locales-ko.js', 'locales-zh-CN.js', 'locales-ja.js']) {
    await copyFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)), join(root, file));
  }
  server = createStaticServer({ root });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.beforeEach(async ({ page }) => {
  await page.goto(baseURL);
  await page.evaluate(async moduleURL => {
    const { createDraftStore } = await import(moduleURL) as { createDraftStore: () => DraftStore };
    Object.assign(window, { createDraftStore, draftStore: createDraftStore() });
  }, `${baseURL}draft-store.js`);
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test('persists source and edits across reopening while listing metadata only', async ({ page }) => {
  const result = await page.evaluate(async input => {
    const host = window as unknown as StoreWindow;
    const metadata = await host.draftStore.putDraft(input);
    host.draftStore.close();
    const reopened = host.createDraftStore();
    const listed = await reopened.listDrafts();
    const restored = await reopened.getDraft(input.id);
    reopened.close();
    return { metadata, listed, restored };
  }, draft('tab-one'));
  expect(result.restored).toEqual(draft('tab-one'));
  expect(result.listed).toEqual([result.metadata]);
  expect(Object.keys(result.metadata).sort()).toEqual(['bytes', 'id', 'name', 'sourceBytes', 'sourceHash', 'updatedAt', 'version']);
  expect(result.metadata.sourceBytes).toBe(Buffer.byteLength(draft('tab-one').source));
});

test('updates patches without copying an unchanged large source into IndexedDB', async ({ page }) => {
  const result = await page.evaluate(async input => {
    const host = window as unknown as StoreWindow;
    const originalPut = IDBObjectStore.prototype.put;
    const originalEncode = TextEncoder.prototype.encode;
    let sourceWrites = 0;
    let sourceEncodes = 0;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.name === 'sources') sourceWrites += 1;
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    TextEncoder.prototype.encode = function(value?: string) {
      if (value === input.source) sourceEncodes += 1;
      return originalEncode.call(this, value);
    };
    try {
      await host.draftStore.putDraft(input);
      for (let edit = 0; edit < 3; edit += 1) await host.draftStore.putDraft({ ...input, changes: [{ id: 'e15', text: `Edit ${edit}` }] });
      const updated = await host.draftStore.getDraft(input.id);
      return { sourceWrites, sourceEncodes, text: updated?.changes[0]?.text };
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      TextEncoder.prototype.encode = originalEncode;
    }
  }, { ...draft('large'), source: `<p>${'x'.repeat(8 * 1024 * 1024)}</p>` });
  expect(result).toEqual({ sourceWrites: 1, sourceEncodes: 1, text: 'Edit 2' });
});

test('keeps tab IDs independent and atomically prunes the oldest sixth draft', async ({ page }) => {
  const result = await page.evaluate(async inputs => {
    const host = window as unknown as StoreWindow;
    const second = host.createDraftStore();
    await Promise.all(inputs.slice(0, 5).map((input, index) => (index % 2 ? second : host.draftStore).putDraft(input)));
    await second.putDraft(inputs[5]!);
    const listed = await host.draftStore.listDrafts();
    await host.draftStore.deleteDraft(inputs[1]!.id);
    const survivor = await second.getDraft(inputs[5]!.id);
    const removed = await second.getDraft(inputs[1]!.id);
    const counts = await new Promise<Record<string, number>>((resolve, reject) => {
      const request = indexedDB.open('pagecraft-drafts', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['drafts', 'sources', 'metadata']);
        const values: Record<string, number> = {};
        for (const name of ['drafts', 'sources', 'metadata']) {
          const count = transaction.objectStore(name).count();
          count.onsuccess = () => { values[name] = count.result; };
        }
        transaction.oncomplete = () => { db.close(); resolve(values); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
    second.close();
    return { listed: listed.map(item => item.id), survivor: survivor?.id, removed, counts };
  }, Array.from({ length: 6 }, (_, index) => draft(`tab-${index}`, 100 + index)));
  expect(result.listed).toEqual(['tab-5', 'tab-4', 'tab-3', 'tab-2', 'tab-1']);
  expect(result.survivor).toBe('tab-5');
  expect(result.removed).toBeUndefined();
  expect(result.counts).toEqual({ drafts: 4, sources: 4, metadata: 4 });
});

test('enforces the UTF-8 source and aggregate byte limits', async ({ page }) => {
  const result = await page.evaluate(async input => {
    const store = (window as unknown as StoreWindow).draftStore;
    const sevenMiB = 'x'.repeat(7 * 1024 * 1024);
    for (let index = 0; index < 3; index += 1) await store.putDraft({ ...input, id: `large-${index}`, source: sevenMiB, updatedAt: index });
    let message = '';
    try { await store.putDraft({ ...input, id: 'large-1', sourceHash: 'b'.repeat(64), source: '한'.repeat(6 * 1024 * 1024) }); }
    catch (error) { message = (error as Error).message; }
    const listed = await store.listDrafts();
    return { ids: listed.map(item => item.id), bytes: listed.reduce((total, item) => total + item.bytes, 0), message, retainedBytes: (await store.getDraft('large-1'))?.source.length };
  }, draft('large'));
  expect(result.ids).toEqual(['large-2', 'large-1']);
  expect(result.bytes).toBeLessThanOrEqual(20 * 1024 * 1024);
  expect(result.message).toContain('16 MiB');
  expect(result.retainedBytes).toBe(7 * 1024 * 1024);
});

test('rejects malformed and oversized patches without losing the last valid draft', async ({ page }) => {
  const result = await page.evaluate(async input => {
    const store = (window as unknown as StoreWindow).draftStore;
    await store.putDraft(input);
    const invalid = [
      { ...input, version: 2 }, { ...input, sourceHash: 'wrong' },
      { ...input, changes: [{ id: 'e15', text: null }] },
      { ...input, operations: [{ type: 'duplicate', id: 'e15', copyId: 'copy1', changes: false }] },
      { ...input, changes: [{ id: 'e15', text: 'x'.repeat(1024 * 1024) }] },
      { ...input, handle: { write: 'never persist this' } },
    ];
    const errors: string[] = [];
    for (const value of invalid) {
      try { await store.putDraft(value as unknown as Draft); }
      catch (error) { errors.push((error as Error).message); }
    }
    return { errors, retained: await store.getDraft(input.id), count: (await store.listDrafts()).length };
  }, draft('recoverable'));
  expect(result.errors).toHaveLength(6);
  expect(result.errors.every(message => /임시 보관본/.test(message))).toBe(true);
  expect(result.retained).toEqual(draft('recoverable'));
  expect(result.count).toBe(1);
});

test('rolls back pruning and writes on a quota exception or asynchronous request error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const result = await page.evaluate(async inputs => {
    const store = (window as unknown as StoreWindow).draftStore;
    for (const input of inputs.slice(0, 5)) await store.putDraft(input);
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const errors: string[] = [];
    for (const mode of ['quota', 'request']) {
      IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
        if (this.name === 'drafts') {
          if (mode === 'quota') throw new DOMException('Injected browser quota failure', 'QuotaExceededError');
          // A real IndexedDB duplicate-key request fails after earlier delete requests.
          return originalAdd.call(this, { id: inputs[4]!.id });
        }
        return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      };
      try { await store.putDraft(inputs[5]!); }
      catch (error) { errors.push((error as Error).message); }
      finally { IDBObjectStore.prototype.put = originalPut; }
    }
    return { errors, ids: (await store.listDrafts()).map(item => item.id), first: await store.getDraft(inputs[0]!.id), incoming: await store.getDraft(inputs[5]!.id) };
  }, Array.from({ length: 6 }, (_, index) => draft(`safe-${index}`, index)));
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain('저장 공간이 부족');
  expect(result.ids).toEqual(['safe-4', 'safe-3', 'safe-2', 'safe-1', 'safe-0']);
  expect(result.first).toEqual(draft('safe-0', 0));
  expect(result.incoming).toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test('retries an opening failure and closes its connection for a database upgrade', async ({ page }) => {
  const result = await page.evaluate(async input => {
    const store = (window as unknown as StoreWindow).draftStore;
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function() { throw new DOMException('Injected unavailable storage', 'SecurityError'); };
    let firstError = '';
    try { await store.listDrafts(); } catch (error) { firstError = (error as Error).message; }
    finally { IDBFactory.prototype.open = originalOpen; }
    await store.putDraft(input);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('pagecraft-drafts', 2);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The store did not close on versionchange.'));
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    let versionError = '';
    try { await store.listDrafts(); } catch (error) { versionError = (error as Error).message; }
    return { firstError, versionError };
  }, draft('upgrade'));
  expect(result.firstError).toContain('브라우저 저장 공간 설정');
  expect(result.versionError).toContain('최신 버전');
});
