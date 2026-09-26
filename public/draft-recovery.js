import { createDraftStore } from './draft-store.js';

// A debounced local safety copy, separate from explicit file saves and their backups.
export function createDraftRecovery({ getSnapshot, onState, onList }) {
  const store = createDraftStore();
  let current = {};
  let savedKey;
  let savedGeneration;
  let generation = 0;
  let suppressed = false;
  let timer;
  let deadline;
  let write;
  let queue = Promise.resolve();
  let state = 'idle';
  let lastError;
  const serial = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const status = (value, error) => { if (state === value && lastError === error) return; state = value; lastError = error; onState(value, error); };
  const cancelTimers = () => { clearTimeout(timer); clearTimeout(deadline); timer = deadline = undefined; };
  async function refresh() {
    try {
      const items = await store.listDrafts();
      onList(items);
      if (state === 'saved' && savedKey === current.key && !items.some(item => item.id === current.key)) {
        savedKey = savedGeneration = undefined;
        suppressed = true;
        status('missing');
      }
    }
    catch (error) { status('error', error); }
  }
  function schedule() {
    if (!current.key || !current.dirty || current.busy || suppressed) return;
    if (savedKey === current.key && savedGeneration === generation) { status('saved'); return; }
    if (state !== 'writing') status('pending');
    clearTimeout(timer);
    timer = setTimeout(flush, 1000);
    deadline ??= setTimeout(flush, 5000);
  }
  async function flush() {
    cancelTimers();
    if (!current.key || !current.dirty || current.busy || suppressed) return;
    if (savedKey === current.key && savedGeneration === generation) return;
    if (write) { try { await write; schedule(); } catch { /* The owning write reports the failure. */ } return; }
    const observed = { ...current, generation };
    let snapshot;
    try { snapshot = getSnapshot(); }
    catch (error) { status('error', error); return; }
    if (!snapshot) return;
    status('writing');
    write = serial(() => store.putDraft(snapshot));
    try {
      await write;
      savedKey = observed.key;
      savedGeneration = observed.generation;
      if (current.key === observed.key && generation === observed.generation && current.dirty) status('saved');
      await refresh();
    } catch (error) {
      if (current.key === observed.key) status('error', error);
    } finally {
      write = undefined;
      if (current.key && current.dirty && generation !== observed.generation) schedule();
    }
  }
  async function remove(id) {
    if (current.key === id) { cancelTimers(); generation++; suppressed = true; savedKey = savedGeneration = undefined; }
    try {
      await serial(() => store.deleteDraft(id));
      if (current.key === id) status(current.dirty ? 'removed' : 'idle');
      await refresh();
    }
    catch (error) { status('error', error); }
  }
  function observe(next) {
    const previous = current;
    current = next;
    if (next.key !== previous.key || next.revision !== previous.revision || next.dirty !== previous.dirty) { generation++; suppressed = false; }
    if (next.key !== previous.key) {
      cancelTimers();
      savedKey = savedGeneration = undefined;
      status('idle');
    }
    if (!next.dirty) {
      cancelTimers();
      if (next.key && next.key === previous.key && previous.dirty) void remove(next.key);
      if (state !== 'error') status('idle');
      return;
    }
    if (next.busy) { cancelTimers(); return; }
    if (next.key !== previous.key || next.revision !== previous.revision || previous.busy || !previous.dirty) schedule();
  }
  return {
    observe, flush, refresh, remove,
    get: (id) => store.getDraft(id),
    retry: () => { savedKey = savedGeneration = undefined; suppressed = false; void refresh(); void flush(); },
  };
}
