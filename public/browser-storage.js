import { t } from './i18n.js';
// Browser files stay on this device. Only the explicit file handle can be overwritten.
export const browserMode = true;
export const canOpenDirectly = isSecureContext && typeof window.showOpenFilePicker === 'function';
const documents = new Map();
const encoder = new TextEncoder();
const MAX_IMPORT = 16 * 1024 * 1024;
const fileTypes = [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }];
let worker;
let sequence = 0;
const pending = new Map();
let database;
let stagedSource;

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
function processSource(type, source, changes, operations) {
  if (!worker) {
    worker = new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(data.id);
      if (data.error) task.reject(failure(t(data.error.message), data.error.status));
      else task.resolve(data.result);
    };
    worker.onerror = () => resetWorker(t("Could not start the HTML processor. Try again."));
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => resetWorker(t("HTML processing timed out. Try a smaller file.")), 60000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, type, source, changes, operations });
  });
}
function resetWorker(message) {
  worker?.terminate();
  worker = undefined;
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(failure(message, 503)); }
  pending.clear();
}
const hash = async (source) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function info(document, result) {
  return { file: document.id, name: document.name, hash: result.hash, nodes: result.nodes,
    compatibility: result.compatibility, previewHtml: result.preview, storage: document.handle ? 'native' : 'download', ...(document.recovered ? { recovered: true } : {}), ...(document.created ? { created: true } : {}) };
}
export function draftSnapshot(id, sourceHash, changes, operations) {
  const document = documents.get(id);
  if (!document) return null;
  return { version: 1, id, name: document.name, source: document.source, sourceHash, changes, operations };
}
export async function restoreDraft(draft) {
  if (!draft || draft.version !== 1 || typeof draft.source !== 'string') throw failure(t("Could not read this draft. Choose another draft."));
  const result = await processSource('edit', draft.source, draft.changes, draft.operations);
  const name = draft.name.replace(/(?:\.recovered)?\.html?$/i, '') + '.recovered.html';
  const document = { id: crypto.randomUUID(), name, source: result.source, bytes: encoder.encode(result.source).byteLength, recovered: true };
  documents.set(document.id, document);
  return info(document, result);
}
function validateFile(file) {
  if (!/\.html?$/i.test(file.name)) throw failure(t("Choose an HTML file."));
  if (file.size > MAX_IMPORT) throw failure(t("Choose an HTML file up to 16 MiB."), 413);
}
async function addFile(file, handle, created = false) {
  validateFile(file);
  const source = await file.text();
  if (!source.trim()) throw failure(t("Choose a non-empty HTML file."));
  const result = await processSource('describe', source);
  const document = { id: crypto.randomUUID(), name: file.name, source, handle, bytes: encoder.encode(source).byteLength, created };
  documents.set(document.id, document);
  return info(document, result);
}
export function retainDocument(activeId) {
  // Evict only after preview success/failure is known; keep the current document saveable.
  let bytes = [...documents.values()].reduce((total, item) => total + item.bytes, 0);
  for (const [id, item] of documents) {
    if (documents.size <= 10 && bytes <= 32 * 1024 * 1024) break;
    if (id !== activeId) { documents.delete(id); bytes -= item.bytes; }
  }
}
export function acceptDocument(id, sourceHash) {
  if (stagedSource?.id === id && stagedSource.hash === sourceHash) {
    const item = documents.get(id);
    item.source = stagedSource.source;
    item.bytes = encoder.encode(item.source).byteLength;
  }
  stagedSource = undefined;
}
export function discardStagedSource() { stagedSource = undefined; }
export function chooseFile() {
  return window.showOpenFilePicker({ types: fileTypes, multiple: false, excludeAcceptAllOption: true });
}
export async function openHandle(handle) { return addFile(await handle.getFile(), handle); }
async function readHandle(handle) {
  const file = await handle.getFile();
  validateFile(file);
  return file.text();
}

function openDatabase() {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('pagecraft-backups', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backups', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failure(t("No space to back up the original. Use Download a copy."), 507));
    request.onblocked = () => reject(failure(t("Close other Pagecraft windows, then save again."), 503));
  }).catch((error) => { database = undefined; throw error; });
  return database;
}
async function backup(name, source) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('backups', 'readwrite');
    const store = transaction.objectStore('backups');
    const record = { id: crypto.randomUUID(), name, source, createdAt: Date.now() };
    store.put(record);
    // Key cursors avoid copying all saved HTML into the UI thread just to trim history.
    const request = store.index('createdAt').openKeyCursor(null, 'prev');
    let count = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (++count > 10) store.delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(record.id);
    transaction.onabort = transaction.onerror = () => reject(failure(t("The original was not overwritten because its backup failed. Use Download a copy."), 507));
  });
}
export async function downloadLatestBackup() {
  const db = await openDatabase();
  const latest = await new Promise((resolve, reject) => {
    const request = db.transaction('backups').objectStore('backups').index('createdAt').openCursor(null, 'prev');
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(failure(t("Could not read the backup.")));
  });
  if (!latest) throw failure(t("No original has been backed up yet. A backup is kept when saving to the original."));
  download(latest.source, latest.name.replace(/\.html?$/i, '') + '.backup.html');
}
function download(source, name) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  if (url.pathname === '/api/files') return { files: [...documents.values()].map((item) => ({ file: item.id, name: item.name })) };
  if (url.pathname === '/api/import') return addFile(options.body.fileObject || new File([options.body.html], options.body.name, { type: 'text/html' }), undefined, options.body.created === true);
  const id = url.searchParams.get('file') || options.body?.file;
  const document = documents.get(id);
  if (!document) throw failure(t("Select the HTML file again. File permission lasts only in this window."), 404);
  if (url.pathname === '/api/document') {
    const source = document.handle ? await readHandle(document.handle) : document.source;
    const result = await processSource('describe', source);
    stagedSource = { id, source, hash: result.hash };
    return info(document, result);
  }
  if (url.pathname !== '/api/save') throw failure(t("Unsupported operation."), 404);
  const body = options.body;
  // Request permission while the originating click/shortcut still has user activation.
  if (document.handle && !body.downloadOnly && document.handle.requestPermission) {
    const permission = await document.handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw failure(t("Write permission is required. Save again or use Download a copy."), 403);
  }
  if (encoder.encode(JSON.stringify({ changes: body.changes, operations: body.operations })).byteLength > 1024 * 1024) throw failure(t("These edits are too large. Save in smaller batches."), 413);
  if (await hash(document.source) !== body.hash) throw failure(t("The document has changed. Reopen the file."), 409);
  const result = await processSource('edit', document.source, body.changes, body.operations);
  if (!document.handle || body.downloadOnly) {
    download(result.source, document.name);
    return { downloaded: true };
  }
  const current = await readHandle(document.handle);
  if (await hash(current) !== body.hash) throw failure(t("Another program changed the file. Nothing was overwritten. Download a copy or reopen the file."), 409);
  const backupId = await backup(document.name, current);
  const writable = await document.handle.createWritable();
  try {
    // Check again after the picker, backup, and writable creation have completed.
    if (await hash(await readHandle(document.handle)) !== body.hash) throw failure(t("The original changed just before saving. Nothing was overwritten."), 409);
    await writable.write(result.source);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  document.source = result.source;
  document.bytes = encoder.encode(result.source).byteLength;
  retainDocument(document.id);
  return { ...info(document, result), backup: backupId };
}
