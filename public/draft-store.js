import { t } from './i18n.js';
// Drafts are recovery copies. They never contain file handles or replace originals.
const DATABASE = 'pagecraft-drafts';
const VERSION = 1;
const MAX_DRAFTS = 5;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_EDIT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function storageFailure(error) {
  if (error?.code?.startsWith?.('DRAFT_')) return error;
  if (error?.name === 'QuotaExceededError') return failure('DRAFT_QUOTA', t("Browser storage is full. Download an HTML copy first, then delete older drafts."));
  if (error?.name === 'VersionError') return failure('DRAFT_VERSION', t("This draft was saved by a newer version. Reopen the latest Pagecraft."));
  return failure('DRAFT_UNAVAILABLE', t("Could not save or read the draft. Download an HTML copy, check browser storage settings, and try again."));
}
const invalid = () => failure('DRAFT_INVALID', t("The draft edits are invalid. Download the current HTML as a copy and reopen it."));
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;

function normalizeChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 10000) throw invalid();
  const seen = new Set();
  return changes.map(change => {
    if (!object(change) || !identifier(change.id) || seen.has(change.id)) throw invalid();
    seen.add(change.id);
    const normalized = { id: change.id };
    if (Object.hasOwn(change, 'text')) {
      if (typeof change.text !== 'string') throw invalid();
      normalized.text = change.text;
    }
    if (Object.hasOwn(change, 'styles')) {
      if (!object(change.styles)) throw invalid();
      normalized.styles = {};
      for (const [property, value] of Object.entries(change.styles)) {
        if (!/^[a-z][a-z-]{0,99}$/.test(property) || typeof value !== 'string' || value.length > 500) throw invalid();
        normalized.styles[property] = value;
      }
    }
    if (Object.keys(change).some(key => !['id', 'text', 'styles'].includes(key))) throw invalid();
    return normalized;
  });
}

function normalizeDraft(draft) {
  if (!object(draft) || draft.version !== VERSION || !identifier(draft.id) || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 1024 || typeof draft.source !== 'string' || !draft.source.trim() || typeof draft.sourceHash !== 'string' || !/^[a-f\d]{64}$/i.test(draft.sourceHash)) throw invalid();
  if (Object.keys(draft).some(key => !['version', 'id', 'name', 'source', 'sourceHash', 'changes', 'operations', 'updatedAt'].includes(key))) throw invalid();
  if (draft.source.length > MAX_SOURCE_BYTES) throw sourceTooLarge();
  const changes = normalizeChanges(draft.changes);
  if (!Array.isArray(draft.operations) || draft.operations.length > 500) throw invalid();
  const operations = draft.operations.map(operation => {
    if (!object(operation) || !identifier(operation.id)) throw invalid();
    if (operation.type === 'delete' && Object.keys(operation).every(key => ['type', 'id'].includes(key))) return { type: 'delete', id: operation.id };
    if (operation.type !== 'duplicate' || !identifier(operation.copyId) || Object.keys(operation).some(key => !['type', 'id', 'copyId', 'changes'].includes(key))) throw invalid();
    return { type: 'duplicate', id: operation.id, copyId: operation.copyId, changes: normalizeChanges(operation.changes) };
  });
  const editBytes = encoder.encode(JSON.stringify({ changes, operations })).byteLength;
  if (editBytes > MAX_EDIT_BYTES) throw failure('DRAFT_TOO_LARGE', t("Draft edits exceed 1 MiB. Download an HTML copy and reopen it to continue editing."));
  const updatedAt = draft.updatedAt ?? Date.now();
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw invalid();
  return { record: { id: draft.id, name: draft.name, sourceHash: draft.sourceHash.toLowerCase(), changes, operations, updatedAt, version: VERSION }, source: draft.source, editBytes };
}
const sourceTooLarge = () => failure('DRAFT_TOO_LARGE', t("Drafts support HTML up to 16 MiB. Download an HTML copy to keep it."));

export function createDraftStore() {
  let connection;
  let opening;

  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const attempt = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const rejectOpen = error => { if (!settled) { settled = true; reject(storageFailure(error)); } };
      try { request = indexedDB.open(DATABASE, VERSION); }
      catch (error) { rejectOpen(error); return; }
      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore('drafts', { keyPath: 'id' });
          request.result.createObjectStore('sources', { keyPath: 'id' });
          request.result.createObjectStore('metadata', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        } catch (error) { request.transaction.abort(); rejectOpen(error); }
      };
      request.onerror = event => { event.preventDefault(); rejectOpen(request.error); };
      request.onblocked = () => rejectOpen(failure('DRAFT_BLOCKED', t("Another Pagecraft tab is using draft storage. Close it and try again.")));
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        connection = request.result;
        connection.onversionchange = () => { request.result.close(); if (connection === request.result) connection = undefined; };
        connection.onclose = () => { if (connection === request.result) connection = undefined; };
        resolve(connection);
      };
    });
    opening = attempt;
    // A blocked/error request can be retried; a late success closes its unused handle.
    attempt.then(() => { if (opening === attempt) opening = undefined; }, () => { if (opening === attempt) opening = undefined; });
    return attempt;
  }

  async function transact(stores, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let error;
      try { transaction = db.transaction(stores, mode); }
      catch (cause) { reject(storageFailure(cause)); return; }
      const abort = cause => {
        // Aborting queued requests produces secondary AbortErrors. Keep the
        // original quota/validation cause so the user gets the useful remedy.
        error ??= storageFailure(cause);
        try { transaction.abort(); } catch { reject(error); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(error ?? storageFailure(transaction.error));
      transaction.onerror = event => {
        // Abort explicitly before suppressing the error event: a partial write is never committed.
        abort(event.target.error ?? transaction.error);
        event.preventDefault();
      };
      const guarded = callback => event => { try { callback(event); } catch (cause) { abort(cause); } };
      try { work(transaction, value => { result = value; }, guarded); }
      catch (cause) { abort(cause); }
    });
  }

  return {
    listDrafts() {
      return transact(['metadata'], 'readonly', (transaction, done, guarded) => {
        const entries = [];
        const request = transaction.objectStore('metadata').index('updatedAt').openCursor(null, 'prev');
        request.onsuccess = guarded(() => {
          const cursor = request.result;
          if (!cursor) { done(entries); return; }
          entries.push(cursor.value);
          cursor.continue();
        });
      });
    },
    async getDraft(id) {
      if (!identifier(id)) throw invalid();
      return transact(['drafts', 'sources'], 'readonly', (transaction, done, guarded) => {
        const request = transaction.objectStore('drafts').get(id);
        request.onsuccess = guarded(() => {
          if (!request.result) { done(undefined); return; }
          const source = transaction.objectStore('sources').get(id);
          source.onsuccess = guarded(() => {
            const { record, source: html } = normalizeDraft({ ...request.result, source: source.result?.source });
            done({ ...record, source: html });
          });
        });
      });
    },
    async putDraft(draft) {
      let normalized;
      try { normalized = normalizeDraft(draft); }
      catch (error) { throw error?.code ? error : invalid(); }
      const { record, source, editBytes } = normalized;
      return transact(['drafts', 'sources', 'metadata'], 'readwrite', (transaction, done, guarded) => {
        const drafts = transaction.objectStore('drafts');
        const sources = transaction.objectStore('sources');
        const entries = transaction.objectStore('metadata');
        const existing = entries.get(record.id);
        existing.onsuccess = guarded(() => {
          // The browser adapter supplies the worker's source hash. A matching hash
          // identifies the already stored immutable source; do not copy it on each edit.
          const sameSource = existing.result?.sourceHash === record.sourceHash;
          const sourceBytes = sameSource ? existing.result.sourceBytes : encoder.encode(source).byteLength;
          if (sourceBytes > MAX_SOURCE_BYTES) throw sourceTooLarge();
          const metadata = { id: record.id, name: record.name, updatedAt: record.updatedAt, version: VERSION,
            bytes: sourceBytes + editBytes, sourceBytes, sourceHash: record.sourceHash };
          const request = entries.index('updatedAt').openCursor();
          const previous = [];
          let bytes = metadata.bytes;
          request.onsuccess = guarded(() => {
            const cursor = request.result;
            if (cursor) {
              if (cursor.primaryKey !== record.id) { previous.push(cursor.value); bytes += cursor.value.bytes; }
              cursor.continue();
              return;
            }
            let count = previous.length + 1;
            for (const oldest of previous) {
              if (count <= MAX_DRAFTS && bytes <= MAX_BYTES) break;
              drafts.delete(oldest.id);
              sources.delete(oldest.id);
              entries.delete(oldest.id);
              count -= 1;
              bytes -= oldest.bytes;
            }
            if (!sameSource) sources.put({ id: record.id, source });
            drafts.put(record);
            entries.put(metadata);
            done(metadata);
          });
        });
      });
    },
    async deleteDraft(id) {
      if (!identifier(id)) throw invalid();
      return transact(['drafts', 'sources', 'metadata'], 'readwrite', (transaction) => {
        transaction.objectStore('drafts').delete(id);
        transaction.objectStore('sources').delete(id);
        transaction.objectStore('metadata').delete(id);
      });
    },
    close() { connection?.close(); connection = undefined; },
  };
}
