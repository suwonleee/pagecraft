import { t, language, dateLocale, initLanguage, applyLanguage } from './i18n.js';
import { createCanvasView, isTextInput, shortcutLetter, isComposingKey } from './canvas.js';
import { createLayerList } from './layers.js';
import { initWorkspace } from './workspace.js';
import { api, post, browserMode, browserStorage } from './document-api.js';
import { prepareDuplicate, measureDuplicateStyles, finishDuplicateAppearance, collectHtmlIds, countSourceElements } from './structure.js';
import { createMoveSnapping } from './snapping.js';
import { initReportStart } from './report-start.js';

initLanguage();
let languageReload = false;
const $ = (selector) => document.querySelector(selector);
// Screen mode gives the document a browser-sized viewport it scrolls inside, so
// `vh` lengths, sticky headers and fixed bars resolve the way their author meant.
// Document mode lays the whole page out at once, which suits ordinary reports.
const screenHeights = { 1440: 900, 768: 1024, 390: 844 };
let screenMode = false;
let screenModeChosen = false;
let frame = $('#preview');
const box = $('#selection-box');
const styleFields = [...document.querySelectorAll('[data-style]')];
for (const field of styleFields) if (!(field instanceof HTMLSelectElement)) field.dataset.hint = field.placeholder;
const alignmentButtons = [...document.querySelectorAll('[data-align]')];
let doc = null;
let nodes = new Map();
let originals = new Map();
let elements = new Map();
let appliedIds = new Set();
let changes = {};
let undoStack = [];
let redoStack = [];
let selected = null;
let selection = new Set();
let operations = [];
let copyCounter = 0;
let reservedHtmlIds = new Set();
let allocatedSourceElements = 0;
let inlineEdit = null;
let loading = false;
let importIntent = false;
let toastTimer;
let group = null;
let resizeObserver;
let files = [];
let recentFiles;
let recent = [];
let updateReady = false;
let cancelEditGesture;
let finishEditGesture;
let gestureRecording = false;
let compositionTarget = null;
let compositionEnding = null;
let pendingSave = false;
let pendingDownload = false;
let operation = null;
let retryOperation = null;
let operationError = null;
let uiFrame = 0;
let inspectorPending = false;
let controlsState = '';
let editRevision = 0;
let exportedRevision = null;
let draftRecovery;
let draftState = 'idle';
let draftError;
const selectionOutlines = new Map();
const camera = createCanvasView({
  canvas: $('#canvas'), artboard: $('#frame-wrap'), frame,
  // Outlines share the artboard transform. Panning/zooming does not change their
  // document coordinates, so only document/selection changes remeasure them.
  onPanStart: () => { cancelEditGesture?.(); finishInline(); },
});
const snapping = createMoveSnapping({ canvas: $('#canvas'), getFrame: () => frame, camera, toggle: $('#snap-toggle') });
const layerList = createLayerList({
  container: $('#layers'), search: $('#layer-search'), count: $('#node-count'),
  onSelect: (id, event) => { select(id, { toggle: event?.shiftKey || event?.metaKey || event?.ctrlKey }); const element = elementFor(id); if (element) camera.centerElement(element); },
});
initWorkspace({ onLayoutChange: () => { fitViewport(); } });

function notify(message, error = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.title = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 9000 : 4500);
}

function renderDraftStatus() {
  if (!browserMode) return;
  const currentExport = exportedRevision !== null && exportedRevision === editRevision && !inlineEdit?.changed;
  const messages = {
    idle: t("Edits are kept temporarily in this browser. Save the file with ⌘/Ctrl+S."),
    pending: t("Draft waiting to save… · Save the file with ⌘/Ctrl+S"),
    writing: t("Saving a draft in this browser…"),
    saved: t("Draft saved in this browser · The original file is saved separately."),
    removed: t("Draft deleted. Your next edit will start a new draft."),
    missing: t("Draft cleared. Save the HTML file or save a new draft."),
    error: t("Could not save the draft · Download your HTML to keep it."),
  };
  const status = $('#draft-status');
  const text = t`${currentExport ? t('Check your downloads. ') : ''}${messages[draftState]}`;
  if (status.textContent !== text) status.textContent = text;
  status.dataset.state = draftState;
  status.title = draftError?.message || text;
  $('#retry-draft').hidden = !['error', 'missing'].includes(draftState);
}

function draftSnapshot() {
  if (!doc || loading || gestureRecording || compositionTarget || compositionEnding) return null;
  const patches = { ...changes };
  if (inlineEdit?.changed) {
    const { id, element } = inlineEdit;
    const text = element.innerText.replace(/\r\n/g, '\n');
    const patch = { ...patches[id], text, styles: { ...patches[id]?.styles } };
    if (text !== nodes.get(id).text && text.includes('\n')) patch.styles['white-space'] = 'pre-wrap';
    else delete patch.styles['white-space'];
    if (text === nodes.get(id).text) delete patch.text;
    if (!Object.keys(patch.styles).length) delete patch.styles;
    patches[id] = patch;
  }
  return browserStorage.draftSnapshot(doc.file, doc.hash, Object.entries(patches).map(([id, patch]) => ({ id, ...patch })), operations);
}

function renderDraftList(items) {
  const welcome = $('#welcome-recovery');
  welcome.hidden = !items.length;
  welcome.textContent = t`Recover ${items.length} drafts`;
  $('#draft-list-empty').hidden = Boolean(items.length);
  $('#draft-list').replaceChildren(...items.map((item) => {
    const row = document.createElement('li');
    row.className = 'draft-item';
    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = item.name;
    name.title = item.name;
    const time = document.createElement('time');
    time.dateTime = new Date(item.updatedAt).toISOString();
    time.textContent = new Date(item.updatedAt).toLocaleString(dateLocale);
    label.append(name, time);
    const recover = document.createElement('button');
    recover.className = 'primary';
    recover.textContent = t("Recover");
    recover.setAttribute('aria-label', t`Recover ${item.name}`);
    recover.onclick = () => { void recoverDraft(item.id); };
    const remove = document.createElement('button');
    remove.className = 'text-button';
    remove.textContent = t("Delete");
    remove.setAttribute('aria-label', t`Delete draft: ${item.name}`);
    remove.onclick = () => {
      if (remove.dataset.confirm !== 'true') { remove.dataset.confirm = 'true'; remove.textContent = t("Confirm deletion"); return; }
      remove.disabled = true;
      void draftRecovery.remove(item.id);
    };
    row.append(label, recover, remove);
    return row;
  }));
}

async function recoverDraft(id) {
  if (loading || importIntent) return;
  importIntent = true;
  $('#recovery-dialog').close();
  updateState();
  try {
    const saved = await draftRecovery.get(id);
    if (!saved) throw new Error(t("This draft has already been deleted or cleared."));
    if (!(await allowDiscard())) return;
    loading = true;
    operation = 'opening';
    clearError();
    updateState();
    const recovered = await browserStorage.restoreDraft(saved);
    await loadDocument(recovered.file, { info: recovered });
    notify(t("Draft recovered as a new copy. Download the HTML to keep it."));
    $('#canvas').focus();
  } catch (error) { showError(error); }
  finally { importIntent = false; loading = false; operation = null; updateState(); }
}

const dirty = () => Boolean(doc?.recovered || doc?.created) || operations.length > 0 || Object.keys(changes).length > 0;
const elementFor = (id) => elements.get(id);

function clearError() {
  operationError = null;
  retryOperation = null;
  $('#operation-error').hidden = true;
}

function showError(error, retry) {
  operationError = error;
  retryOperation = retry;
  $('#operation-error-message').textContent = error.message;
  $('#operation-error').hidden = false;
  $('#retry-operation').hidden = !retry || error.status === 409;
  notify(error.message, true);
  updateState();
}

function updateState() {
  const unsaved = dirty() || inlineEdit?.changed;
  $('#save').disabled = loading || !unsaved;
  $('#undo').disabled = loading || !undoStack.length;
  $('#redo').disabled = loading || !redoStack.length;
  const changedCount = new Set([...Object.keys(changes), ...operations.map((op) => op.id), ...(inlineEdit?.changed ? [inlineEdit.id] : [])]).size;
  const state = loading ? operation || 'opening' : operationError ? 'error' : unsaved ? 'dirty' : doc ? 'saved' : 'empty';
  const status = $('#save-state');
  status.dataset.state = state;
  status.textContent = loading ? { saving: t("Saving…"), importing: t("Importing…"), opening: t("Opening…") }[state] : unsaved ? t`Edited elements: ${changedCount} · Unsaved` : doc ? doc.storage === 'download' ? t("Editing a copy · Download to save") : t("Saved to file") : t("Choose a file");
  if (!loading && doc?.recovered && !changedCount) status.textContent = t("Recovered copy · Not downloaded");
  else if (!loading && doc?.created && !changedCount) status.textContent = t("New HTML · Not downloaded");
  const currentExport = exportedRevision !== null && exportedRevision === editRevision && !inlineEdit?.changed;
  if (!loading && !operationError && exportedRevision !== null) {
    status.textContent = currentExport ? t`${!unsaved && doc.storage === 'native' ? t('Saved to file · ') : ''}Download requested${unsaved ? t(' · Original not saved') : ''}` : unsaved ? t`Edited elements: ${changedCount} · Changed after download · Unsaved` : status.textContent;
  }
  if (browserMode) {
    $('#save').textContent = doc?.storage === 'native' ? t("Save original") : t("Download HTML");
    $('#open-file').disabled = loading || importIntent;
    $('#try-sample').disabled = loading || importIntent;
    $('#welcome-import').disabled = loading || importIntent;
    $('#export-file').disabled = loading || !doc;
    $('#export-file').hidden = doc?.storage !== 'native';
    $('#browser-welcome').hidden = Boolean(doc);
    $('#browser-draft-hint').hidden = !doc;
    draftRecovery?.observe({ key: doc?.file, revision: editRevision, dirty: Boolean(unsaved), busy: loading || gestureRecording || Boolean(compositionTarget || compositionEnding) });
    renderDraftStatus();
    $('#canvas').hidden = !doc;
    for (const button of document.querySelectorAll('#recent-files button, #welcome-recent-files button')) button.disabled = loading || importIntent;
    renderStorageHint();
  }
  status.title = operationError?.message || status.textContent;
  $('#reset-selected').disabled = ![...selection].some((id) => changes[id]) || loading;
  $('#reset-selected').textContent = selection.size > 1 ? t("Discard unsaved changes to selected elements") : t("Discard this element’s unsaved changes");
  $('#selection-count').textContent = selection.size ? t`${selection.size} selected` : t("No selection");
  $('.workspace').dataset.selectionCount = String(selection.size);
  $('#zoom-selection').disabled = loading || !selected;
  const roots = selectionRoots();
  const duplicable = roots.every((id) => nodes.get(id).canDuplicate !== false);
  $('#duplicate-selection').disabled = loading || !selection.size || !duplicable;
  $('#duplicate-selection').title = duplicable ? t("Duplicate selected elements (⌘/Ctrl+D)") : t("Add a closing tag in the HTML before duplicating this element.");
  $('#delete-selection').disabled = loading || !selection.size;
  const canAlign = !loading && roots.length > 1;
  for (const button of alignmentButtons) button.disabled = !canAlign;
  $('#import').disabled = loading || importIntent;
  $('#new-report').disabled = loading || importIntent;
  $('#welcome-report').disabled = loading || importIntent;
  $('#reload').disabled = loading || !doc;
  $('#retry-operation').disabled = loading;
  const nextControlsState = `${loading}:${selected}:${selection.size}:${nodes.get(selected)?.text === null}`;
  if (controlsState !== nextControlsState) {
    controlsState = nextControlsState;
    $('#properties').inert = loading;
    $('#canvas').inert = loading;
    $('#canvas').setAttribute('aria-busy', String(loading));
    for (const field of styleFields) field.disabled = loading || !selected;
    $('#text-value').disabled = loading || selection.size !== 1 || nodes.get(selected)?.text === null;
    $('#text-color').disabled = loading || !selected;
    $('#background-color').disabled = loading || !selected;
    for (const button of $('#files').querySelectorAll('button')) button.disabled = loading;
    layerList.setLoading(loading);
  }
}

// A document that sizes itself against the viewport height needs screen mode; the
// person can still switch, and their choice holds until another document is opened.
function autoScreenMode() {
  if (!screenModeChosen) setScreenMode(Boolean(doc?.compatibility?.viewportHeight), false);
}

// A copy has no file to save back into, so say that where the save control is, and
// offer the one move that fixes it rather than leaving a download to explain itself.
function renderStorageHint() {
  const hint = $('#storage-hint');
  const copy = Boolean(doc) && doc.storage === 'download' && !doc.created && !doc.recovered;
  hint.hidden = !copy && !updateReady;
  if (!copy) {
    if (!updateReady) return;
    $('#storage-hint-message').textContent = t("An update is ready. Close and reopen all Pagecraft tabs to use it. Your open document can keep using this version.");
    $('#open-original').hidden = true;
    return;
  }
  const canOpen = browserStorage.canOpenDirectly;
  $('#storage-hint-message').textContent = canOpen
    ? t("You are editing a copy. Saving downloads new HTML without changing the original. Reopen the original to save into it.")
    : t("You are editing a copy. This browser downloads edits instead of saving to the original. Chrome and Edge support direct saving.");
  $('#open-original').hidden = !canOpen;
  $('#open-original').disabled = loading || importIntent;
}

function updateCompatibility() {
  const compatibility = doc?.compatibility || {};
  const messages = [];
  if (compatibility.scripts) messages.push(t`${compatibility.scripts} scripts are disabled. Some content or interactions may be missing.`);
  // A decorative SVG beside editable text needs no notice; a document made only of
  // drawn surfaces does, because it looks editable and nothing can be selected.
  if (compatibility.drawn && !doc?.nodes?.length) messages.push(t`This document has ${compatibility.drawn} SVG or canvas regions that cannot be edited as HTML elements. They remain visible and are preserved when saving.`);
  if (compatibility.viewportHeight) messages.push(t`${compatibility.viewportHeight} viewport-height units detected (such as vh). Screen mode lets you scroll within the selected screen size.`);
  if (compatibility.externalStyles) messages.push(t`${compatibility.externalStyles} external stylesheets are blocked. Fonts, colors, and layout may differ from the original.`);
  if (compatibility.externalAssets) messages.push(t`${compatibility.externalAssets} external images or media are blocked.`);
  if (browserMode && compatibility.localStyles) messages.push(t`${compatibility.localStyles} separate CSS files cannot load here. Embed them in the HTML or open the folder with the local server.`);
  if (browserMode && compatibility.localAssets) messages.push(t`${compatibility.localAssets} separate images or media cannot load here. Embed them in the HTML or open the folder with the local server.`);
  const notice = $('#compatibility-notice');
  notice.hidden = !messages.length;
  notice.open = false;
  $('#compatibility-summary').textContent = t`Preview compatibility · ${messages.length}`;
  $('#compatibility-list').replaceChildren(...messages.map((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  }));
}

function record(key, ids = [selected]) {
  const now = Date.now();
  if (!gestureRecording && (!group || group.key !== key || now - group.time > 900)) {
    undoStack.push({ before: new Map(), after: new Map(), selectionBefore: [...selection], selectionAfter: [...selection] });
  }
  if (undoStack.length > 100) undoStack.shift();
  const entry = undoStack.at(-1);
  for (const id of ids) if (id && !entry.before.has(id)) entry.before.set(id, changes[id]);
  group = { key, time: now };
  redoStack = [];
}

function restoreElement(id) {
  const element = elementFor(id);
  const original = originals.get(id);
  if (!element || !original) return;
  if (original.style === null) element.removeAttribute('style');
  else element.setAttribute('style', original.style);
  if (nodes.get(id)?.text !== null) element.textContent = original.text;
  const patch = changes[id];
  if (patch?.text !== undefined) element.textContent = patch.text;
  for (const [property, value] of Object.entries(patch?.styles || {})) {
    if (value) element.style.setProperty(property, value, 'important');
  }
  if (patch) appliedIds.add(id); else appliedIds.delete(id);
}

function applyAll(ids = new Set([...appliedIds, ...Object.keys(changes)])) {
  ids = [...ids];
  // Undo/reset only touches edited elements, regardless of the document's size.
  for (const id of ids) restoreElement(id);
  layerList.setChanges(changes, ids);
  layerList.setSelected(selection, { primary: selected });
  refreshInspector();
  updateState();
  updateBox();
}

function patchElement(id, patch, key = id, deferred = false) {
  if (loading || !nodes.has(id)) return;
  if (patch.text !== undefined) {
    patch.styles = { ...patch.styles, 'white-space': patch.text !== nodes.get(id).text && patch.text.includes('\n') ? 'pre-wrap' : '' };
  }
  record(key, [id]);
  const previous = changes[id] || {};
  const next = { ...previous, ...patch };
  if (patch.styles) next.styles = { ...previous.styles, ...patch.styles };
  if (next.text === nodes.get(id).text) delete next.text;
  if (next.styles) {
    for (const [property, value] of Object.entries(next.styles)) {
      if (value === '') delete next.styles[property];
    }
    if (!Object.keys(next.styles).length) delete next.styles;
  }
  if (Object.keys(next).length) changes[id] = next;
  else delete changes[id];
  const previousStyles = previous.styles || {};
  const nextStyles = next.styles || {};
  if (previous.text !== next.text || Object.keys(previousStyles).length !== Object.keys(nextStyles).length || Object.keys(nextStyles).some((property) => previousStyles[property] !== nextStyles[property])) editRevision++;
  undoStack.at(-1).after.set(id, changes[id]);
  restoreElement(id);
  if (deferred) return;
  layerList.setChanges(changes, [id]);
  updateState();
  updateBox();
}

function history(direction) {
  finishEditGesture?.();
  finishInline();
  const from = direction === 'undo' ? undoStack : redoStack;
  const to = direction === 'undo' ? redoStack : undoStack;
  if (!from.length || loading) return;
  const entry = from.pop();
  to.push(entry);
  editRevision++;
  if (entry[direction]) entry[direction]();
  else {
    const patches = direction === 'undo' ? entry.before : entry.after;
    for (const [id, patch] of patches) {
      if (patch) changes[id] = patch; else delete changes[id];
    }
    setSelection(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter);
    applyAll(patches.keys());
  }
  group = null;
  updateState();
}

function renderRecent() {
  if (!recentFiles) return;
  const build = (record) => {
    const button = document.createElement('button');
    button.className = 'file-button';
    button.title = t`${record.name} · Continue editing`;
    button.disabled = loading || importIntent;
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = '↻';
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = record.name;
    const forget = document.createElement('span');
    forget.className = 'file-path';
    forget.textContent = new Date(record.openedAt).toLocaleDateString();
    const info = document.createElement('span');
    info.className = 'file-info';
    info.append(label, forget);
    button.append(icon, info);
    button.addEventListener('click', () => { void reopenRecent(record); });
    return button;
  };
  $('#recent-files').replaceChildren(...recent.map(build));
  $('#welcome-recent-files').replaceChildren(...recent.map(build));
  $('#recent-section').hidden = !recent.length;
  $('#welcome-recent').hidden = !recent.length;
}

async function refreshRecent() {
  if (!recentFiles) return;
  recent = await recentFiles.list();
  renderRecent();
}

// The file itself is reopened, not a copy of it, so saving continues in place.
async function reopenRecent(record) {
  if (loading || importIntent) return;
  if (!(await recentFiles.grant(record))) { notify(t("File access is required. Select the file again or use Open HTML."), true); return; }
  if (!(await openNativeHandle(record.handle))) {
    // A file that was moved, renamed or deleted cannot be reopened by its handle.
    await record.handle.getFile().catch(async () => {
      await recentFiles.forget(record.id);
      await refreshRecent();
      notify(t("That file was not found and was removed from the list. Select it again with Open HTML."), true);
    });
  }
  await refreshRecent();
}

function renderFiles() {
  const query = $('#file-search').value.trim().toLocaleLowerCase();
  const visible = files.filter((file) => !query || file.file.toLocaleLowerCase().includes(query));
  $('#file-count').textContent = query ? `${visible.length} / ${files.length}` : files.length;
  $('#file-empty').hidden = visible.length > 0;
  $('#file-empty').textContent = query ? t("No matching files.") : t("Import HTML to add a file.");
  $('#files').replaceChildren(...visible.map((file) => {
    const button = document.createElement('button');
    button.className = `file-button${file.file === doc?.file ? ' active' : ''}`;
    button.title = file.file;
    button.disabled = loading;
    if (file.file === doc?.file) button.setAttribute('aria-current', 'page');
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = '◇';
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = file.name;
    const info = document.createElement('span');
    info.className = 'file-info';
    info.append(label);
    if (file.file.includes('/')) {
      const folder = document.createElement('span');
      folder.className = 'file-path';
      folder.textContent = file.file.slice(0, file.file.lastIndexOf('/'));
      info.append(folder);
    }
    button.append(icon, info);
    button.addEventListener('click', () => { void switchFile(file.file); });
    return button;
  }));
}

function renderLayers() {
  layerList.setChanges(changes);
  layerList.setSelected(selection, { primary: selected });
}

function setSelection(ids, primary) {
  selection = new Set([...ids].filter((id) => nodes.has(id)));
  selected = selection.has(primary) ? primary : [...selection].at(-1) || null;
  layerList.setSelected(selection, { primary: selected });
  refreshInspector();
  updateBox();
  updateState();
}

function select(id, { toggle = false } = {}) {
  if (loading || !nodes.has(id)) return;
  if (inlineEdit?.id !== id) finishInline();
  const next = toggle ? new Set(selection) : new Set();
  if (toggle && next.has(id)) next.delete(id); else next.add(id);
  group = null;
  setSelection(next, id);
}

function selectionRoots(ids = selection) {
  return [...ids].filter((id) => {
    let parent = nodes.get(id)?.parentId;
    while (parent) { if (ids.has(parent)) return false; parent = nodes.get(parent)?.parentId; }
    return nodes.has(id);
  });
}

function toHex(color) {
  const parts = color.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  if (parts) return '#' + parts.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
}

// The panel shows what a person would type, not the browser's resolved value: a
// hex colour, a length trimmed to two decimals, and nothing at all for a fully
// transparent background so the field's own placeholder can say `transparent`.
function displayValue(value) {
  const channels = value.match(/^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\s*\)$/);
  if (channels) {
    const alpha = channels[4] === undefined ? 1 : Number(channels[4]);
    if (alpha === 0) return '';
    if (alpha === 1) return toHex(value);
  }
  return value.replace(/\d+\.\d+/g, (number) => String(Math.round(Number(number) * 100) / 100));
}

function refreshInspector() {
  const node = nodes.get(selected);
  const element = node && elementFor(node.id);
  $('#empty-selection').hidden = Boolean(element);
  $('#properties').hidden = !element;
  if (!element) return;
  const css = frame.contentWindow.getComputedStyle(element);
  const multiple = selection.size > 1;
  $('#selected-tag').textContent = multiple ? t`${selection.size} elements` : node.tag.toUpperCase();
  $('#selected-label').textContent = multiple ? t("Styles apply to all selected elements.") : node.label;
  $('#select-parent').disabled = multiple || !node.parentId;
  $('#text-value').disabled = loading || multiple || node.text === null;
  $('#text-value').value = multiple || node.text === null ? '' : changes[node.id]?.text ?? node.text;
  $('#text-hint').textContent = multiple ? t("Select one element to edit its text.") : node.text === null ? t("Select the text inside this element to edit it.") : t("Changes appear on the canvas as you type.");
  const computed = multiple ? [...selection].map((id) => ({ id, css: frame.contentWindow.getComputedStyle(elementFor(id)) })) : [];
  for (const field of styleFields) {
    const property = field.dataset.style;
    const edited = changes[node.id]?.styles?.[property];
    // A value the person typed is shown back verbatim; only the browser's is tidied.
    let value = edited ?? displayValue(css.getPropertyValue(property).trim());
    const mixed = computed.some(({ id, css: other }) => (changes[id]?.styles?.[property] ?? displayValue(other.getPropertyValue(property).trim())) !== value);
    if (mixed) value = '';
    // Keep each field's authored hint (`auto`, `16px`, `transparent`) except while
    // several selected elements disagree, when the field has to say so instead.
    if (!(field instanceof HTMLSelectElement)) field.placeholder = mixed ? t("Mixed") : field.dataset.hint;
    if (field instanceof HTMLSelectElement) {
      for (const option of field.querySelectorAll('[data-current]')) option.remove();
      if (mixed || ![...field.options].some((option) => option.value === value)) {
        const option = new Option(mixed ? t("Mixed") : t`Current · ${value}`, mixed ? '__mixed__' : value);
        option.dataset.current = '';
        option.disabled = true;
        field.append(option);
        field.value = option.value;
      } else field.value = value;
    }
    else field.value = value;
    field.classList.remove('invalid');
    field.removeAttribute('aria-invalid');
  }
  $('#text-color').value = toHex(css.color);
  $('#background-color').value = toHex(css.backgroundColor);
}

function updateBox() {
  if (uiFrame) return;
  uiFrame = requestAnimationFrame(() => {
    uiFrame = 0;
    if (inspectorPending) { inspectorPending = false; refreshInspector(); }
    renderBox();
  });
}

function queueInspector() { inspectorPending = true; updateBox(); }

function renderBox() {
  const entries = [...selection].map((id) => [id, elementFor(id)?.getBoundingClientRect()]).filter(([, rect]) => rect);
  for (const [id, outline] of selectionOutlines) {
    if (selection.size < 2 || !selection.has(id) || loading) { outline.remove(); selectionOutlines.delete(id); }
  }
  if (!entries.length || loading) { box.hidden = true; return; }
  const rect = boundsOf(entries.map(([, rect]) => rect));
  const viewport = { width: frame.clientWidth, height: frame.clientHeight };
  const top = Math.max(0, rect.top);
  const left = Math.max(0, rect.left);
  const right = Math.min(viewport.width, rect.right);
  const bottom = Math.min(viewport.height, rect.bottom);
  box.hidden = right <= left || bottom <= top;
  Object.assign(box.style, { top: `${top}px`, left: `${left}px`, width: `${right - left}px`, height: `${bottom - top}px` });
  $('#selection-label').textContent = t`${selection.size > 1 ? t`${selection.size} elements` : nodes.get(selected).tag} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  $('#resize-handle').hidden = selection.size !== 1;
  if (selection.size > 1) for (const [id, item] of entries) {
    let outline = selectionOutlines.get(id);
    if (!outline) { outline = document.createElement('div'); outline.className = 'multi-selection-outline'; $('#multi-boxes').append(outline); selectionOutlines.set(id, outline); }
    Object.assign(outline.style, { left: `${item.left}px`, top: `${item.top}px`, width: `${item.width}px`, height: `${item.height}px` });
  }
}

function boundsOf(rects) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function finishInline(cancel = false) {
  if (!inlineEdit || compositionTarget === inlineEdit.element || compositionEnding === inlineEdit.element) return;
  const { id, element, before, changed, beforeRevision } = inlineEdit;
  inlineEdit = null;
  const text = element.innerText.replace(/\r\n/g, '\n');
  element.removeAttribute('contenteditable');
  if (cancel) { element.textContent = before; editRevision = beforeRevision; }
  else if (changed && text !== before) patchElement(id, { text }, `text:${id}`);
  refreshInspector();
  updateState();
}

function trackComposition(target) {
  target.addEventListener('compositionstart', (event) => { compositionTarget = event.target; compositionEnding = null; updateState(); });
  target.addEventListener('compositionend', (event) => {
    if (compositionTarget !== event.target) return;
    compositionTarget = null;
    compositionEnding = event.target;
    const documentAtEnd = doc;
    // Browsers can deliver the final input after compositionend. Keep the DOM intact until then.
    setTimeout(() => {
      if (compositionTarget || compositionEnding !== event.target || doc !== documentAtEnd) return;
      compositionEnding = null;
      if (inlineEdit && inlineEdit.element.ownerDocument.activeElement !== inlineEdit.element) finishInline();
      if (pendingSave) { const downloadOnly = pendingDownload; pendingSave = false; pendingDownload = false; void save(undefined, downloadOnly); }
      updateState();
    }, 0);
  });
}

function beginInline(id) {
  if (nodes.get(id)?.text === null || loading) return;
  finishInline();
  select(id);
  const element = elementFor(id);
  inlineEdit = { id, element, before: element.textContent, changed: false, beforeRevision: editRevision };
  element.contentEditable = 'plaintext-only';
  element.focus();
  const range = frame.contentDocument.createRange();
  range.selectNodeContents(element);
  const selection = frame.contentWindow.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function attachFrame() {
  const preview = frame.contentDocument;
  elements = new Map([...preview.querySelectorAll('[data-muse-edit-id]')].map((element) => [element.dataset.museEditId, element]));
  originals = new Map();
  appliedIds = new Set();
  reservedHtmlIds = collectHtmlIds(preview);
  allocatedSourceElements = countSourceElements(preview);
  for (const node of nodes.values()) {
    const element = elementFor(node.id);
    if (element) originals.set(node.id, { style: element.getAttribute('style'), text: node.text === null ? null : element.textContent });
  }
  camera.attach(preview);
  preview.addEventListener('pointerdown', beginMove, true);
  preview.addEventListener('pointerdown', beginMarquee, true);
  preview.addEventListener('click', (event) => {
    if (camera.ignoreClick()) { event.preventDefault(); event.stopPropagation(); return; }
    const element = event.target.closest?.('[data-muse-edit-id]');
    if (inlineEdit && element === inlineEdit.element) return;
    event.preventDefault();
    event.stopPropagation();
    if (element) select(element.dataset.museEditId, { toggle: event.shiftKey || event.metaKey || event.ctrlKey });
    else if (!event.shiftKey) setSelection([]);
  }, true);
  preview.addEventListener('dblclick', (event) => {
    if (camera.ignoreDoubleClick()) { event.preventDefault(); return; }
    const element = event.target.closest?.('[data-muse-edit-id]');
    if (element) { event.preventDefault(); beginInline(element.dataset.museEditId); }
  }, true);
  preview.addEventListener('focusout', (event) => {
    if (inlineEdit && event.target === inlineEdit.element) finishInline();
  });
  preview.addEventListener('input', () => { if (inlineEdit) { inlineEdit.changed = true; editRevision++; updateState(); } });
  trackComposition(preview);
  preview.defaultView.addEventListener('keydown', onSaveKey, { capture: true });
  preview.addEventListener('keydown', onKey);
  preview.addEventListener('submit', (event) => event.preventDefault(), true);
  preview.addEventListener('dragstart', (event) => event.preventDefault(), true);
  bindFileDrop(preview);
  preview.addEventListener('scroll', updateBox, true);
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(updateBox);
  resizeObserver.observe(preview.body);
}

function preparePreview(next) {
  return new Promise((resolve, reject) => {
    const staged = frame.cloneNode(false);
    staged.removeAttribute('id');
    staged.removeAttribute('src');
    staged.removeAttribute('srcdoc');
    staged.setAttribute('aria-hidden', 'true');
    staged.tabIndex = -1;
    const originalStyle = frame.style.cssText;
    Object.assign(staged.style, { position: 'absolute', inset: '0', visibility: 'hidden', pointerEvents: 'none' });
    const fail = () => { clearTimeout(timer); staged.remove(); reject(new Error(t("Could not open the HTML preview. Your current document is unchanged. Try again."))); };
    const timer = setTimeout(fail, 15000);
    staged.onerror = fail;
    staged.onload = () => {
      try {
        const preview = staged.contentDocument;
        const ids = new Set([...preview.querySelectorAll('[data-muse-edit-id]')].map((element) => element.dataset.museEditId));
        if (preview.contentType !== 'text/html' || !preview.body || next.nodes.some((node) => !ids.has(node.id))) { fail(); return; }
        clearTimeout(timer);
        staged.onload = null;
        staged.onerror = null;
        resolve({ staged, originalStyle });
      } catch { fail(); }
    };
    if (browserMode && typeof next.previewHtml === 'string') {
      // WebKit requires allow-scripts for parent-installed editing event handlers.
      // The trusted worker prefixes CSP script-src 'none' before every untrusted byte.
      staged.setAttribute('sandbox', 'allow-same-origin allow-scripts');
      staged.srcdoc = next.previewHtml;
    } else staged.src = next.previewUrl;
    // Stay in the eventual parent: moving a loaded iframe to another parent would reload it.
    frame.after(staged);
  });
}

async function loadDocument(file, { info, selectionIndex = -1, selectionIndices = [selectionIndex] } = {}) {
  const previousFile = doc?.file;
  const changedFile = doc?.file !== file;
  let committed = false;
  cancelEditGesture?.();
  snapping.clear();
  compositionTarget = null;
  compositionEnding = null;
  pendingSave = false;
  pendingDownload = false;
  loading = true;
  operation ||= 'opening';
  updateState();
  box.hidden = true;
  try {
    const next = info || await api(`/api/document?file=${encodeURIComponent(file)}`);
    const { staged, originalStyle } = await preparePreview(next);
    frame.remove();
    frame = staged;
    frame.id = 'preview';
    frame.style.cssText = originalStyle;
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    selected = null;
    selection = new Set();
    operations = [];
    copyCounter = 0;
    doc = next;
    editRevision = 0;
    exportedRevision = null;
    updateCompatibility();
    if (browserMode) browserStorage.acceptDocument(next.file, next.hash);
    nodes = new Map(next.nodes.map((node) => [node.id, node]));
    changes = {};
    undoStack = [];
    redoStack = [];
    group = null;
    committed = true;
    if (previousFile && previousFile !== next.file) void draftRecovery?.remove(previousFile);
    $('#filename').textContent = next.name;
    $('#filename').title = next.file;
    historyReplace(next.file);
    attachFrame();
    layerList.setDocument(nodes, changes);
    selection = new Set(selectionIndices.map((index) => next.nodes[index]?.id).filter(Boolean));
    selected = [...selection].at(-1) || null;
    layerList.setSelected(selection, { primary: selected });
    refreshInspector();
  } finally {
    loading = false;
    operation = null;
    if (browserMode) {
      browserStorage.discardStagedSource();
      browserStorage.retainDocument(doc?.file);
      files = (await api('/api/files')).files;
    }
    renderFiles();
    updateState();
    if (committed) {
      // Opening a different document re-reads its layout needs; an explicit choice
      // made for the document already open survives a reload of that same file.
      if (changedFile) screenModeChosen = false;
      autoScreenMode();
      fitViewport(changedFile);
    } else updateBox();
  }
}

function historyReplace(file) {
  if (browserMode) return;
  const url = new URL(location.href);
  url.searchParams.set('file', file);
  window.history.replaceState(null, '', url);
}

async function allowDiscard() {
  finishInline();
  if (!dirty()) return true;
  return new Promise((resolve) => {
    const dialog = $('#discard-dialog');
    const done = (value) => { dialog.close(); resolve(value); };
    $('#discard-confirm').onclick = () => done(true);
    $('#discard-cancel').onclick = () => done(false);
    dialog.oncancel = () => resolve(false);
    dialog.showModal();
  });
}

async function switchFile(file) {
  if (loading || importIntent || !(await allowDiscard())) return;
  clearError();
  try { await loadDocument(file); } catch (error) { showError(error, () => switchFile(file)); }
}

async function acceptSavedDocument(next) {
  const previous = [...nodes.values()];
  const selectionIndices = previous.flatMap((node, index) => selection.has(node.id) ? [index] : []);
  const sameStructure = previous.length === next.nodes.length && next.nodes.every((node, index) => node.tag === previous[index].tag && elementFor(previous[index].id));
  if (!sameStructure) { await loadDocument(next.file, { info: next, selectionIndices }); return; }
  // Rebase the current DOM order after saving without reloading CSS/images or losing the view.
  const nextElements = new Map();
  const nextOriginals = new Map();
  for (const [index, node] of next.nodes.entries()) {
    const element = elementFor(previous[index].id);
    if (element.dataset.museEditId !== node.id) element.dataset.museEditId = node.id;
    if (node.text !== null && element.textContent !== node.text) element.textContent = node.text;
    nextElements.set(node.id, element);
    nextOriginals.set(node.id, { style: element.getAttribute('style'), text: node.text });
  }
  doc = next;
  editRevision = 0;
  exportedRevision = null;
  updateCompatibility();
  nodes = new Map(next.nodes.map((node) => [node.id, node]));
  elements = nextElements;
  originals = nextOriginals;
  appliedIds = new Set();
  changes = {};
  operations = [];
  copyCounter = 0;
  reservedHtmlIds = collectHtmlIds(frame.contentDocument);
  allocatedSourceElements = countSourceElements(frame.contentDocument);
  undoStack = [];
  redoStack = [];
  group = null;
  selection = new Set(selectionIndices.map((index) => next.nodes[index]?.id).filter(Boolean));
  selected = [...selection].at(-1) || null;
  layerList.setDocument(nodes, changes);
  layerList.setSelected(selection, { primary: selected });
  refreshInspector();
  autoScreenMode();
  fitViewport();
}

async function save(event, downloadOnly = false) {
  if (!doc || loading || importIntent) return;
  const composingInput = compositionTarget || compositionEnding || (event && isComposingKey(event) && isTextInput(event.target) ? event.target : null);
  if (composingInput) {
    if (!compositionEnding) compositionTarget = composingInput;
    if (!pendingSave) notify(t("Finish composing the text before saving."));
    pendingSave = true;
    pendingDownload ||= downloadOnly;
    // Request the IME's native commit; compositionend will resume this save.
    if (!compositionEnding) composingInput.blur();
    return;
  }
  finishEditGesture?.();
  finishInline();
  if (!doc || (!dirty() && !downloadOnly) || loading) return;
  const file = doc.file;
  const focusBeforeSave = document.activeElement;
  try {
    clearError();
    loading = true;
    operation = 'saving';
    updateState();
    const result = await post('/api/save', { file, hash: doc.hash, changes: Object.entries(changes).map(([id, patch]) => ({ id, ...patch })), operations, ...(downloadOnly ? { downloadOnly: true } : {}) });
    if (result.downloaded) {
      exportedRevision = editRevision;
      notify(t("HTML download requested. Check your browser’s downloads. Your current edits are kept."));
      return;
    }
    await acceptSavedDocument(result);
    if (browserMode) { files = (await api('/api/files')).files; renderFiles(); }
    notify(browserMode ? t("Saved to the original file. The previous version is backed up in this browser.") : t`Saved. Your edits will remain when you reopen the file.${result.backup ? t(' The previous file was also backed up.') : ''}`);
  } catch (error) {
    showError(error, () => save(undefined, downloadOnly));
  } finally {
    loading = false;
    operation = null;
    updateState();
    if (focusBeforeSave?.matches?.('input,textarea,select') && !focusBeforeSave.disabled && focusBeforeSave.isConnected) focusBeforeSave.focus({ preventScroll: true });
    updateBox();
  }
}

function normalizeValue(property, value) {
  const trimmed = value.trim();
  if (/^(?:font-size|letter-spacing|width|height|padding|margin|gap|border-radius)$/.test(property) && /^\d+(?:\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
  return trimmed;
}

function patchBatch(items, key) {
  if (!items.length || loading) return;
  for (const { id, ...patch } of items) patchElement(id, patch, key, true);
  layerList.setChanges(changes, items.map((item) => item.id));
  updateState();
  updateBox();
}

function patchSelection(patch, key) {
  patchBatch([...selection].map((id) => ({ id, ...patch })), `${[...selection].join(',')}:${key}`);
}

for (const field of styleFields) {
  field.addEventListener('input', () => {
    if (!selected) return;
    const property = field.dataset.style;
    const value = normalizeValue(property, field.value);
    const valid = !value || (CSS.supports(property, value) && !/[;{}<>]/.test(value) && !/(?:url|expression)\s*\(/i.test(value));
    field.classList.toggle('invalid', !valid);
    field.setAttribute('aria-invalid', String(!valid));
    if (!valid) return;
    patchSelection({ styles: { [property]: value } }, property);
    if (field instanceof HTMLSelectElement) refreshInspector();
    if (property === 'color') $('#text-color').value = toHex(frame.contentWindow.getComputedStyle(elementFor(selected)).color);
    if (property === 'background-color') $('#background-color').value = toHex(frame.contentWindow.getComputedStyle(elementFor(selected)).backgroundColor);
  });
  field.addEventListener('blur', () => { group = null; });
}

$('#text-value').addEventListener('input', (event) => {
  if (selection.size === 1) patchElement(selected, { text: event.target.value }, `text:${selected}`);
});
$('#text-value').addEventListener('blur', () => { group = null; renderLayers(); });
for (const [id, property] of [['text-color', 'color'], ['background-color', 'background-color']]) {
  $(`#${id}`).addEventListener('input', (event) => {
    if (selected) {
      patchSelection({ styles: { [property]: event.target.value } }, property);
      $(`[data-style="${property}"]`).value = event.target.value;
    }
  });
}

function onSaveKey(event) {
  if (event.altKey || event.getModifierState?.('AltGraph')) return;
  const command = event.metaKey || event.ctrlKey;
  const letter = shortcutLetter(event);
  if (command && !event.shiftKey && (letter === 's' || event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter')) {
    // Claim saves before input/widget handlers and cancel the browser's default Save Page action.
    // Browser-reserved shortcuts that never reach the document cannot be intercepted here.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat && !document.querySelector('dialog[open]')) void save(event);
  }
}

function onKey(event) {
  if (event.defaultPrevented || event.altKey || event.getModifierState?.('AltGraph')) return;
  if (document.querySelector('dialog[open]')) return;
  const command = event.metaKey || event.ctrlKey;
  const letter = shortcutLetter(event);
  // Leave candidate selection, composition cancellation, and undo to the input method.
  if (compositionTarget || compositionEnding || isComposingKey(event)) return;
  if (event.key === 'Escape' && cancelEditGesture) { event.preventDefault(); cancelEditGesture(); return; }
  if (event.key === 'Escape' && inlineEdit) { event.preventDefault(); finishInline(true); return; }
  const inCanvas = event.target?.ownerDocument === frame.contentDocument || Boolean(event.target?.nodeType && $('#canvas').contains(event.target));
  const editingSelection = inCanvas || Boolean(event.target?.closest?.('#layers,.selection-toolbar'));
  if (editingSelection && !isTextInput(event.target) && !camera.panMode() && !loading) {
    if (command && letter === 'd' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) duplicateSelection(); return; }
    if (!command && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); if (!event.repeat) deleteSelection(); return; }
    if (event.key === 'Escape' && selection.size) { event.preventDefault(); setSelection([]); return; }
  }
  if (inCanvas && !isTextInput(event.target) && !camera.panMode() && selected && !loading && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (delta) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const items = selectionRoots().map((id) => {
        const position = translationOf(elementFor(id));
        return { id, styles: positionStyles(position, delta[0] * step, delta[1] * step) };
      });
      patchBatch(items, `nudge:${[...selection].join(',')}`);
      queueInspector();
      return;
    }
  }
  if (command && letter === 'z') { event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo'); }
}

function setScreenMode(next, chosen) {
  screenMode = next;
  screenModeChosen = chosen;
  $('#screen-mode').setAttribute('aria-pressed', String(next));
  camera.setScrollable(next);
}

function fitViewport(reset = false) {
  const value = $('#viewport').value;
  const wrap = $('#frame-wrap');
  const requested = value === 'fit' ? Math.max(390, $('#canvas').clientWidth - 56) : Number(value);
  wrap.style.width = `${requested}px`;
  const viewportHeight = value === 'fit' ? Math.max(480, $('#canvas').clientHeight - 56) : screenHeights[requested] || 900;
  frame.style.height = `${viewportHeight}px`;
  const preview = frame.contentDocument;
  let width = requested;
  let height = viewportHeight;
  if (screenMode) {
    // The frame is the document's window: it keeps the selected size and scrolls.
    $('#dimensions').textContent = t`${width} × ${height} px · Screen`;
  } else {
    // Slide decks and wide tables lay out past the chosen width. The preview cannot
    // scroll, so the frame grows to whatever the document needs, at any size, and
    // the camera lowers its zoom floor to match instead of clipping the right edge.
    for (let pass = 0; pass < 6; pass++) {
      const overflow = (preview?.documentElement?.scrollWidth || 0) - width;
      if (overflow < 1) break;
      // The first pass takes the measured content width. A centered deck hands half
      // of every widening back as margin, so later passes aim past the overflow.
      width = Math.ceil(width + overflow * (pass ? 2 : 1));
      wrap.style.width = `${width}px`;
    }
    height = Math.max(viewportHeight, preview?.body?.scrollHeight || 0, preview?.documentElement?.scrollHeight || 0);
    frame.style.height = `${height}px`;
    $('#dimensions').textContent = width > requested ? t`${width} px · Content width` : `${width} px`;
  }
  wrap.style.height = `${height}px`;
  const resized = camera.measure();
  if (reset || (resized && camera.isFitted())) camera.fit(); else camera.render();
  updateBox();
  updateState();
}

function translationOf(element) {
  const css = frame.contentWindow.getComputedStyle(element);
  const values = css.translate === 'none' ? [] : css.translate.split(/\s+/);
  const length = (value, size) => value?.endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value) || 0;
  return { x: length(values[0], element.offsetWidth), y: length(values[1], element.offsetHeight), z: values[2] || '', inline: css.display === 'inline' };
}

function positionStyles(position, dx, dy) {
  const { x, y, z } = position;
  const styles = { translate: `${Math.round((x + dx) * 1000) / 1000}px ${Math.round((y + dy) * 1000) / 1000}px${z ? ` ${z}` : ''}` };
  // Non-replaced inline text cannot be transformed until it establishes an inline box.
  if (position.inline) styles.display = 'inline-block';
  return styles;
}

function structureReady() {
  if (loading || !selection.size || compositionTarget || compositionEnding) return false;
  finishEditGesture?.();
  finishInline();
  return true;
}

function rootsInOrder() {
  return selectionRoots().sort((a, b) => elementFor(a).compareDocumentPosition(elementFor(b)) & 4 ? -1 : 1);
}

function installRecords(records) {
  for (const record of records) {
    nodes.set(record.id, record.node);
    elements.set(record.id, record.element);
    originals.set(record.id, record.original);
    if (record.patch) changes[record.id] = record.patch;
    restoreElement(record.id);
  }
}

function detachBundle(bundle) {
  bundle.root.remove();
  for (const { id } of bundle.records) { nodes.delete(id); elements.delete(id); originals.delete(id); appliedIds.delete(id); delete changes[id]; }
}

function attachBundle(bundle) {
  bundle.parent.insertBefore(bundle.root, bundle.next?.parentNode === bundle.parent ? bundle.next : null);
  installRecords(bundle.records);
}

function reindexStructure() {
  // Structure changes are occasional. Ordinary typing/dragging never rebuilds this index.
  nodes = new Map([...frame.contentDocument.querySelectorAll('[data-muse-edit-id]')].map((element) => {
    const id = element.dataset.museEditId;
    return [id, nodes.get(id)];
  }).filter(([, node]) => node));
  layerList.setDocument(nodes, changes);
  fitViewport();
}

function structureHistory(undo, redo, beforeSelection, afterSelection, beforeOperations, afterOperations) {
  group = null;
  editRevision++;
  const restore = (action, ids, nextOperations) => {
    action();
    operations = nextOperations;
    reindexStructure();
    setSelection(ids);
  };
  undoStack.push({
    undo: () => restore(undo, beforeSelection, beforeOperations),
    redo: () => restore(redo, afterSelection, afterOperations),
  });
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  operations = afterOperations;
  reindexStructure();
  setSelection(afterSelection);
}

function duplicateSelection() {
  if (!structureReady()) return;
  const roots = rootsInOrder();
  if (roots.some((id) => nodes.get(id).canDuplicate === false)) { notify(t("Add a closing tag in the HTML before duplicating this element."), true); return; }
  if (operations.length + roots.length > 500) { notify(t("Save your current changes before duplicating."), true); return; }
  const newElements = roots.reduce((count, id) => count + countSourceElements(elementFor(id)), 0);
  if (allocatedSourceElements + newElements > 50000) { notify(t("Too many elements for one save. Save the current changes or split the document."), true); return; }
  const beforeSelection = [...selection];
  const duplicates = roots.map((id) => prepareDuplicate(elementFor(id), `c${++copyCounter}`, { nodes, changes, reservedHtmlIds }));
  // Batch DOM insertions, layout reads, then appearance writes: no read/write loop per node.
  for (const duplicate of duplicates) { duplicate.source.after(duplicate.root); duplicate.parent = duplicate.root.parentNode; duplicate.next = duplicate.root.nextSibling; }
  for (const duplicate of duplicates) measureDuplicateStyles(duplicate);
  finishDuplicateAppearance(duplicates);
  allocatedSourceElements += newElements;
  for (const duplicate of duplicates) installRecords(duplicate.records);
  const afterSelection = duplicates.map((duplicate) => duplicate.records[0].id);
  structureHistory(
    () => { for (const duplicate of [...duplicates].reverse()) detachBundle(duplicate); },
    () => { for (const duplicate of duplicates) attachBundle(duplicate); },
    beforeSelection, afterSelection, operations, [...operations, ...duplicates.map((duplicate) => duplicate.operation)],
  );
  notify(t`Duplicated ${roots.length} elements. Undo to restore the previous state.`);
}

function deleteSelection() {
  if (!structureReady()) return;
  const roots = rootsInOrder();
  if (operations.length + roots.length > 500) { notify(t("Save your current changes before deleting."), true); return; }
  const beforeSelection = [...selection];
  const removed = roots.map((id) => {
    const root = elementFor(id);
    return { root, parent: root.parentNode, next: root.nextSibling,
      records: [root, ...root.querySelectorAll('[data-muse-edit-id]')].map((element) => {
        const id = element.dataset.museEditId;
        return { id, element, node: nodes.get(id), original: originals.get(id), patch: changes[id] };
      }) };
  });
  for (const bundle of removed) detachBundle(bundle);
  structureHistory(
    () => { for (const bundle of [...removed].reverse()) attachBundle(bundle); },
    () => { for (const bundle of removed) detachBundle(bundle); },
    beforeSelection, [], operations, [...operations, ...roots.map((id) => ({ type: 'delete', id }))],
  );
  notify(t`Deleted ${roots.length} elements. Undo to restore them.`);
}

function alignSelection(alignment) {
  if (!structureReady()) return;
  const ids = selectionRoots();
  if (ids.length < 2) return;
  // All geometry is read before any style is written, regardless of selection size.
  const items = ids.map((id) => ({ id, rect: elementFor(id).getBoundingClientRect(), position: translationOf(elementFor(id)) }));
  const bounds = boundsOf(items.map((item) => item.rect));
  const patches = items.map(({ id, rect, position }) => {
    const dx = alignment === 'left' ? bounds.left - rect.left : alignment === 'right' ? bounds.right - rect.right : alignment === 'center' ? bounds.left + bounds.width / 2 - rect.left - rect.width / 2 : 0;
    const dy = alignment === 'top' ? bounds.top - rect.top : alignment === 'bottom' ? bounds.bottom - rect.bottom : alignment === 'middle' ? bounds.top + bounds.height / 2 - rect.top - rect.height / 2 : 0;
    return { id, styles: positionStyles(position, dx, dy), changed: Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 };
  }).filter((item) => item.changed).map(({ changed: _changed, ...item }) => item);
  group = null;
  patchBatch(patches, `align:${alignment}`);
  group = null;
  queueInspector();
}

function beginEditGesture(event, id, update) {
  event.preventDefault();
  const target = event.target;
  const owner = target.ownerDocument;
  const start = camera.screenPoint(event);
  const previousUndo = [...undoStack];
  const previousRedo = redoStack;
  const previousRevision = editRevision;
  const selectionBefore = [...selection];
  const scale = camera.view.scale;
  let moved = false;
  let ended = false;
  let entry;
  let pending;
  let animationFrame = 0;
  const flush = () => {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (!pending) return;
    let [dx, dy, options] = pending;
    if (update.kind === 'move') ({ dx, dy } = snapping.update(dx, dy, options));
    patchBatch(update(dx, dy), `gesture:${id}`);
    pending = null;
    queueInspector();
  };
  target.setPointerCapture(event.pointerId);
  const finish = (cancel = false) => {
    if (ended) return;
    if (!cancel) flush();
    cancelAnimationFrame(animationFrame);
    ended = true;
    owner.removeEventListener('pointermove', move, true);
    owner.removeEventListener('pointerup', end, true);
    owner.removeEventListener('pointercancel', abort, true);
    target.removeEventListener('lostpointercapture', abort);
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    cancelEditGesture = undefined;
    finishEditGesture = undefined;
    gestureRecording = false;
    snapping.clear();
    group = null;
    if (cancel && moved) {
      for (const [changedId, patch] of entry.before) {
        if (patch) changes[changedId] = patch; else delete changes[changedId];
      }
      undoStack = previousUndo;
      redoStack = previousRedo;
      editRevision = previousRevision;
      setSelection(selectionBefore);
      applyAll(entry.before.keys());
    }
    if (moved) {
      camera.suppressNextClick();
      fitViewport();
      refreshInspector();
    }
  };
  const move = (next) => {
    if (next.pointerId !== event.pointerId) return;
    if (camera.panMode()) { finish(true); return; }
    const point = camera.screenPoint(next);
    let dx = (point.x - start.x) / scale;
    let dy = (point.y - start.y) / scale;
    if (!moved && Math.hypot(point.x - start.x, point.y - start.y) < 4) return;
    next.preventDefault();
    if (!moved) {
      moved = true;
      if (!selection.has(id)) select(id);
      frame.contentWindow.getSelection()?.removeAllRanges();
      group = null;
      record(`gesture:${id}`, []);
      entry = undoStack.at(-1);
      gestureRecording = true;
      if (update.kind === 'move') snapping.begin(update.movingElements);
    }
    let axis;
    if (next.shiftKey && update.kind === 'move') {
      if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; axis = 'x'; } else { dx = 0; axis = 'y'; }
    }
    pending = [dx, dy, { altKey: next.altKey, axis }];
    if (!animationFrame) animationFrame = requestAnimationFrame(flush);
  };
  const end = (next) => { if (next.pointerId === event.pointerId) finish(); };
  const abort = () => finish(true);
  cancelEditGesture = abort;
  finishEditGesture = () => finish();
  owner.addEventListener('pointermove', move, { capture: true, passive: false });
  owner.addEventListener('pointerup', end, true);
  owner.addEventListener('pointercancel', abort, true);
  target.addEventListener('lostpointercapture', abort);
}

function beginMove(event) {
  if (event.button !== 0 || loading || camera.panMode() || isTextInput(event.target)) return;
  if (event.metaKey || event.ctrlKey) return;
  const hit = event.target.closest?.('[data-muse-edit-id]');
  if (!hit) return;
  finishInline();
  const current = selected && elementFor(selected);
  // A selected container moves as a group; a click without dragging still drills into its child.
  const element = current?.contains(hit) ? current : hit;
  const id = element.dataset.museEditId;
  const movingIds = selection.has(id) ? selectionRoots() : [id];
  const positions = movingIds.map((item) => ({ id: item, position: translationOf(elementFor(item)) }));
  frame.contentWindow.focus();
  const update = (dx, dy) => positions.map(({ id: item, position }) => ({ id: item, styles: positionStyles(position, dx, dy) }));
  update.kind = 'move';
  update.movingElements = movingIds.map(elementFor);
  beginEditGesture(event, id, update);
}

function beginMarquee(event) {
  if (event.defaultPrevented || event.button !== 0 || loading || camera.panMode() || isTextInput(event.target)) return;
  const inPreview = event.target.ownerDocument === frame.contentDocument;
  if (inPreview ? event.target.closest?.('[data-muse-edit-id]') : event.target !== $('#canvas')) return;
  finishInline();
  event.preventDefault();
  const target = event.target;
  const owner = target.ownerDocument;
  const start = camera.screenPoint(event);
  const before = [...selection];
  const initial = event.shiftKey ? before : [];
  const canvasBounds = $('#canvas').getBoundingClientRect();
  const frameBounds = frame.getBoundingClientRect();
  const scale = camera.view.scale;
  let candidates;
  const marquee = $('#marquee');
  let pending;
  let scheduled = 0;
  let moved = false;
  let ended = false;
  const flush = () => {
    scheduled = 0;
    if (!pending) return;
    const left = Math.min(start.x, pending.x), top = Math.min(start.y, pending.y);
    const right = Math.max(start.x, pending.x), bottom = Math.max(start.y, pending.y);
    Object.assign(marquee.style, { left: `${left - canvasBounds.left}px`, top: `${top - canvasBounds.top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    marquee.hidden = false;
    const ids = new Set([...initial, ...candidates.filter((rect) => rect.left >= left && rect.right <= right && rect.top >= top && rect.bottom <= bottom).map((rect) => rect.id)]);
    if (ids.size !== selection.size || [...ids].some((id) => !selection.has(id))) setSelection(ids);
  };
  const finish = (cancel = false) => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(scheduled);
    if (!cancel && moved) flush();
    if (cancel) setSelection(before);
    owner.removeEventListener('pointermove', move, true);
    owner.removeEventListener('pointerup', end, true);
    owner.removeEventListener('pointercancel', abort, true);
    target.removeEventListener('lostpointercapture', abort);
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    marquee.hidden = true;
    cancelEditGesture = undefined;
    finishEditGesture = undefined;
    if (moved) camera.suppressNextClick();
  };
  const move = (next) => {
    if (next.pointerId !== event.pointerId) return;
    if (camera.panMode()) { finish(true); return; }
    pending = camera.screenPoint(next);
    if (!moved && Math.hypot(pending.x - start.x, pending.y - start.y) < 4) return;
    if (!moved) {
      // A blank-canvas click must not measure every element in a large document.
      candidates = [...nodes.keys()].map((id) => {
        const rect = elementFor(id).getBoundingClientRect();
        return { id, width: rect.width, height: rect.height, left: frameBounds.left + rect.left * scale, top: frameBounds.top + rect.top * scale, right: frameBounds.left + rect.right * scale, bottom: frameBounds.top + rect.bottom * scale };
      }).filter((rect) => rect.width > 0 && rect.height > 0);
    }
    moved = true;
    next.preventDefault();
    if (!scheduled) scheduled = requestAnimationFrame(flush);
  };
  const end = (next) => { if (next.pointerId === event.pointerId) finish(); };
  const abort = () => finish(true);
  target.setPointerCapture(event.pointerId);
  cancelEditGesture = abort;
  finishEditGesture = () => finish();
  owner.addEventListener('pointermove', move, { capture: true, passive: false });
  owner.addEventListener('pointerup', end, true);
  owner.addEventListener('pointercancel', abort, true);
  target.addEventListener('lostpointercapture', abort);
}

$('#resize-handle').addEventListener('pointerdown', (event) => {
  if (selection.size !== 1 || loading || event.button !== 0 || camera.panMode()) return;
  finishInline();
  const element = elementFor(selected);
  const css = frame.contentWindow.getComputedStyle(element);
  const width = parseFloat(css.width) || element.offsetWidth;
  const height = parseFloat(css.height) || element.offsetHeight;
  const id = selected;
  beginEditGesture(event, id, (dx, dy) => [{ id, styles: { width: `${Math.max(8, Math.round(width + dx))}px`, height: `${Math.max(8, Math.round(height + dy))}px` } }]);
});

$('#save').addEventListener('click', () => { void save(); });
$('#undo').addEventListener('click', () => history('undo'));
$('#redo').addEventListener('click', () => history('redo'));
$('#reload').addEventListener('click', () => { if (doc) void switchFile(doc.file); });
$('#select-parent').addEventListener('click', () => { const parent = nodes.get(selected)?.parentId; if (parent) select(parent); });
$('#zoom-selection').addEventListener('click', () => { const element = elementFor(selected); if (element) camera.focusElement(element); });
$('#reset-selected').addEventListener('click', () => {
  const ids = [...selection].filter((id) => changes[id]);
  if (!ids.length) return;
  editRevision++;
  group = null;
  record(`reset:${selected}`, ids);
  for (const id of ids) { delete changes[id]; undoStack.at(-1).after.set(id, undefined); }
  group = null;
  applyAll(ids);
});
$('#duplicate-selection').addEventListener('click', duplicateSelection);
$('#delete-selection').addEventListener('click', deleteSelection);
for (const button of alignmentButtons) button.addEventListener('click', () => alignSelection(button.dataset.align));
$('#file-search').addEventListener('input', renderFiles);
$('#retry-operation').addEventListener('click', () => { if (!loading) void retryOperation?.(); });
$('#dismiss-error').addEventListener('click', () => { clearError(); updateState(); });
$('#viewport').addEventListener('change', () => fitViewport(true));
$('#screen-mode').addEventListener('click', () => { setScreenMode(!screenMode, true); fitViewport(true); });
$('#canvas').addEventListener('scroll', updateBox);
$('#canvas').addEventListener('click', (event) => {
  if (event.target !== $('#canvas') || camera.ignoreClick()) return;
  finishInline();
  if (!event.shiftKey) setSelection([]);
});
$('#canvas').addEventListener('pointerdown', beginMarquee);
$('#import').addEventListener('click', () => { $('#file-input').click(); });
$('#file-input').addEventListener('change', (event) => {
  const picked = [...event.target.files];
  event.target.value = '';
  if (!picked.length) return;
  if (picked.length !== 1) { notify(t("Choose one HTML file at a time."), true); return; }
  void importFile(picked[0]);
});

function validateImport(file) {
  if (!file || !/\.html?$/i.test(file.name)) { notify(t("Choose an HTML file (.html or .htm)."), true); return false; }
  const limitMiB = browserMode ? 16 : 5;
  if (file.size > limitMiB * 1024 * 1024) { notify(t`Choose an HTML file up to ${limitMiB} MiB.`, true); return false; }
  if (!file.size) { notify(t("Choose a non-empty HTML file."), true); return false; }
  return true;
}

// Opening through a file handle is what lets every later save go back into the same
// file. The picker, a dropped file and the recent list all arrive here.
async function openNativeHandle(handle, { remember = true } = {}) {
  if (!browserStorage || loading || importIntent) return false;
  importIntent = true;
  updateState();
  try {
    if (!validateImport(await handle.getFile())) return false;
    if (!(await allowDiscard())) return false;
    loading = true;
    operation = 'opening';
    clearError();
    updateState();
    const opened = await browserStorage.openHandle(handle);
    files = (await api('/api/files')).files;
    await loadDocument(opened.file, { info: opened });
    if (remember && recentFiles) { await recentFiles.remember(handle, opened.name); await refreshRecent(); }
    notify(t("HTML opened. Saving will update this original file."));
    return true;
  } catch (error) { if (error.name !== 'AbortError') showError(error); return false; }
  finally { importIntent = false; loading = false; operation = null; updateState(); }
}

async function openPickedFile() {
  if (loading || importIntent) return;
  try {
    // Start the system picker in the original click, before any awaited confirmation.
    const [handle] = await browserStorage.chooseFile();
    if (handle) await openNativeHandle(handle);
  } catch (error) { if (error.name !== 'AbortError') showError(error); }
}

async function importFile(file, { created = false } = {}) {
  // Validate before asking to discard, and allow only one import/picker intent at a time.
  if (!validateImport(file) || loading || importIntent) return false;
  importIntent = true;
  updateState();
  try {
    if (!(await allowDiscard())) return false;
    clearError();
    loading = true;
    operation = 'importing';
    updateState();
    const imported = await post('/api/import', browserMode ? { fileObject: file, created } : { name: file.name, html: await file.text() });
    files = (await api('/api/files')).files;
    await loadDocument(imported.file, { info: imported });
    notify(browserMode ? t("HTML copy opened. Download it after editing. The original stays unchanged.") : t("HTML copy opened. Save to the file after editing."));
    return true;
  } catch (error) { showError(error); return false; }
  finally { importIntent = false; loading = false; operation = null; updateState(); }
}

async function dropFile(pendingHandle, file) {
  const handle = await Promise.resolve(pendingHandle).catch(() => null);
  if (handle?.kind === 'file' && handle.createWritable) await openNativeHandle(handle);
  else await importFile(file);
}

function bindFileDrop(target) {
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')
    || Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file');
  target.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = loading || importIntent ? 'none' : 'copy';
    document.body.classList.toggle('file-drop-active', !loading && !importIntent);
  });
  target.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) document.body.classList.remove('file-drop-active');
  });
  target.addEventListener('drop', (event) => {
    document.body.classList.remove('file-drop-active');
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const picked = [...event.dataTransfer.files];
    if (picked.length !== 1) { notify(t("Drop one HTML file at a time."), true); return; }
    // The item is only valid during this dispatch, so ask for its handle right here.
    const handle = browserStorage && [...event.dataTransfer.items].find((item) => item.kind === 'file')?.getAsFileSystemHandle?.();
    void dropFile(handle, picked[0]);
  }, true);
}
bindFileDrop(document);
// WebKit can group native undo across inputs in different parts of the page.
// A modal's undo must never reach a previously edited inspector field.
document.addEventListener('beforeinput', event => {
  if (['historyUndo', 'historyRedo'].includes(event.inputType) && document.querySelector('dialog[open]') && !event.target?.closest?.('dialog')) event.preventDefault();
}, { capture: true });
window.addEventListener('keydown', onSaveKey, { capture: true });
window.addEventListener('keydown', onKey);
trackComposition(document);
window.addEventListener('resize', () => fitViewport());
window.addEventListener('blur', () => { setTimeout(() => { if (!document.hasFocus()) cancelEditGesture?.(); }, 0); });
window.addEventListener('beforeunload', (event) => {
  if (!languageReload && (dirty() || inlineEdit)) { event.preventDefault(); event.returnValue = ''; }
});

document.addEventListener('pagecraft-language-request', async (event) => {
  if (loading || importIntent || operation === 'saving' || !(await allowDiscard())) { $('#language').value = language; return; }
  languageReload = true;
  if (!applyLanguage(event.detail)) {
    languageReload = false;
    $('#language').value = language;
    notify(t('Allow browser storage to remember your language.'));
  }
});

async function initialize() {
  clearError();
  loading = true;
  operation = 'opening';
  updateState();
  try {
    files = (await api('/api/files')).files;
    const requested = browserMode ? null : new URLSearchParams(location.search).get('file');
    const initial = requested || files[0]?.file;
    if (initial) await loadDocument(initial);
    else { renderFiles(); if (!browserMode) notify(t("Import HTML to open a file for editing.")); }
  } catch (error) { showError(error, initialize); }
  finally { loading = false; operation = null; updateState(); }
}
initReportStart({ importFile, browserMode });
if (browserMode) {
  const { createDraftRecovery } = await import('./draft-recovery.js');
  const recoveryButton = document.createElement('button');
  recoveryButton.id = 'welcome-recovery';
  recoveryButton.className = 'secondary';
  recoveryButton.hidden = true;
  $('.welcome-actions').append(recoveryButton);
  draftRecovery = createDraftRecovery({
    getSnapshot: draftSnapshot,
    onState: (state, error) => { draftState = state; draftError = error; renderDraftStatus(); },
    onList: renderDraftList,
  });
  const openRecovery = () => { void draftRecovery.refresh(); $('#recovery-dialog').showModal(); };
  recoveryButton.addEventListener('click', openRecovery);
  $('#show-drafts').addEventListener('click', openRecovery);
  $('#close-recovery').addEventListener('click', () => $('#recovery-dialog').close());
  $('#retry-draft').addEventListener('click', () => draftRecovery.retry());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void draftRecovery.flush();
    else void draftRecovery.refresh();
  });
  window.addEventListener('focus', () => { void draftRecovery.refresh(); });
  void draftRecovery.refresh();
  $('.local-badge').textContent = 'BROWSER';
  if (browserStorage.canOpenDirectly) {
    recentFiles = await import('./recent-files.js');
    await refreshRecent();
  }
  $('#open-file').hidden = !browserStorage.canOpenDirectly;
  $('#download-backup').hidden = false;
  $('#storage-location').textContent = t("Files stay on this device");
  $('.scope-note').textContent = t("Before saving, up to 10 previous originals are kept in this browser. Select the file and grant access again in a new window.");
  $('#browser-capability').textContent = browserStorage.canOpenDirectly
    ? t("This browser supports saving to the original. An Install button appears when available.")
    : t("Use Import HTML and Download in this browser. The original file stays unchanged.");
  $('#import').textContent = t("Import a copy");
  const { initOnboarding } = await import('./onboarding.js');
  initOnboarding({ importFile, chooseCopy: () => browserStorage.canOpenDirectly ? void openPickedFile() : $('#file-input').click() });
  if (browserStorage.canOpenDirectly) {
    $('#welcome-import').textContent = t("Open HTML file");
    $('#browser-welcome').querySelector('p').textContent = t("Drop an AI-generated report or your own HTML here. Edit the text and layout, then save into the same file.");
    $('.welcome-steps').textContent = t("Double-click text → Edit → Save to the same file (⌘/Ctrl + S)");
  }
  $('#open-file').addEventListener('click', () => { void openPickedFile(); });
  $('#open-original').addEventListener('click', () => { void openPickedFile(); });
  $('#export-file').addEventListener('click', (event) => { void save(event, true); });
  $('#download-backup').addEventListener('click', async () => {
    try { await browserStorage.downloadLatestBackup(); notify(t("Download of the previous original requested.")); }
    catch (error) { notify(error.message, true); }
  });
  const { initInstall } = await import('./install.js');
  initInstall({ onUpdate: () => { updateReady = true; renderStorageHint(); } });
  // An installed app launched from the OS "Open with" menu receives the file's handle
  // here, so it opens like a picked file and saves go back into the same file.
  if (browserStorage.canOpenDirectly && typeof window.launchQueue?.setConsumer === 'function') {
    window.launchQueue.setConsumer((launch) => {
      const handle = launch?.files?.[0];
      if (handle?.kind === 'file') void openNativeHandle(handle);
    });
  }
}
await initialize();
