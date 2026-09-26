// File handles survive a closed tab; file contents never leave the device. Reopening
// still needs a click, because the browser only grants permission on user activation.
const NAME = 'pagecraft-recent';
const STORE = 'handles';
const LIMIT = 8;
// Deserializing a stored handle crashes some browser builds outright, and a crash
// cannot be caught. A read that never finished leaves this marker behind, so the
// next visit clears the store and drops the list instead of crashing again.
const CANARY = 'pagecraft-recent-read';
let database;
let disabled = false;

function open() {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('openedAt', 'openedAt');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('recent files unavailable'));
    request.onblocked = () => reject(new Error('recent files blocked'));
  }).catch((error) => { database = undefined; throw error; });
  return database;
}

const run = (mode, body) => open().then((db) => new Promise((resolve, reject) => {
  const transaction = db.transaction(STORE, mode);
  const request = body(transaction.objectStore(STORE));
  transaction.oncomplete = () => resolve(request?.result);
  transaction.onabort = transaction.onerror = () => reject(transaction.error);
}));

// Handles are compared by identity, not by path: the browser exposes no file path.
const sameFile = (a, b) => a.isSameEntry ? a.isSameEntry(b) : Promise.resolve(false);

function marker(reading) {
  // A private window may refuse storage; the guard then simply does not apply.
  try { reading ? localStorage.setItem(CANARY, '1') : localStorage.removeItem(CANARY); } catch { /* no storage */ }
}

const discard = () => new Promise((resolve) => {
  database = undefined;
  const request = indexedDB.deleteDatabase(NAME);
  request.onsuccess = request.onerror = request.onblocked = () => resolve();
});

async function readRecords() {
  if (disabled) return null;
  let crashedBefore = false;
  try { crashedBefore = Boolean(localStorage.getItem(CANARY)); } catch { /* no storage */ }
  if (crashedBefore) {
    disabled = true;
    marker(false);
    await discard();
    return null;
  }
  marker(true);
  const records = await run('readonly', (store) => store.getAll()).catch(() => null);
  marker(false);
  return Array.isArray(records) ? records : null;
}

/** Newest first, and no more than the list shows. */
export const rank = (records) => [...records].sort((a, b) => b.openedAt - a.openedAt).slice(0, LIMIT);

/** Records the next write should drop: the oldest beyond the limit, never the match. */
export const evicted = (records, matched) => rank(records.filter((record) => record !== matched)).slice(LIMIT - 1);

export async function list() {
  return rank(await readRecords() || []);
}

/** Origin-private files are the browser's own storage, not files the person can
 * find again, so they are never worth remembering. Chrome 153 also crashes when one
 * is read back out of IndexedDB, which this keeps out of the store entirely. */
async function isUserFile(handle) {
  const root = await navigator.storage?.getDirectory?.().catch(() => null);
  return !root?.resolve || await root.resolve(handle).catch(() => null) === null;
}

export async function remember(handle, name) {
  if (disabled || !await isUserFile(handle)) return;
  const records = await readRecords();
  if (!records) return;
  const matches = await Promise.all(records.map((record) => sameFile(handle, record.handle).catch(() => false)));
  const matched = records.find((_record, index) => matches[index]);
  await run('readwrite', (store) => {
    store.put({ id: matched?.id || crypto.randomUUID(), name, handle, openedAt: Date.now() });
    for (const record of evicted(records, matched)) store.delete(record.id);
  }).catch(() => undefined);
}

export const forget = (id) => disabled ? Promise.resolve() : run('readwrite', (store) => store.delete(id)).catch(() => undefined);

/** Read access is enough to reopen; saving asks for write permission on its own.
 * A handle with no permission API needs no prompt: it either opens or throws. */
export async function grant({ handle }) {
  if (!handle.queryPermission) return true;
  const mode = { mode: 'read' };
  if (await handle.queryPermission(mode) === 'granted') return true;
  return await handle.requestPermission?.(mode) === 'granted';
}
