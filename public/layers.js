import { t } from './i18n.js';
// Keep the sidebar proportional to its viewport, even when the preview has thousands of nodes.
const ROW_HEIGHT = 36;
const OVERSCAN = 6;

export function createLayerList({ container, search, count, onSelect }) {
  const content = document.createElement('div');
  content.className = 'layers-content';
  content.style.position = 'relative';
  const empty = document.createElement('p');
  empty.className = 'layers-empty';
  empty.hidden = true;
  container.replaceChildren(content, empty);
  container.setAttribute('role', 'listbox');
  container.setAttribute('aria-label', t("Document elements"));
  container.setAttribute('aria-multiselectable', 'true');

  let records = [];
  let byId = new Map();
  let visible = [];
  let indexById = new Map();
  let rendered = new Map();
  let selected = new Set();
  let primary = null;
  let busy = false;
  let scheduled = 0;
  let filterPending = false;
  let revealPending = false;
  let destroyed = false;

  function updateRecord(record, patch) {
    record.label = (patch?.text ?? record.node.label) || record.node.tag;
    record.searchText = `${record.node.tag} ${record.label}`.toLocaleLowerCase();
    record.dirty = Boolean(patch && Object.keys(patch).length);
  }

  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    visible = query ? records.filter((record) => record.searchText.includes(query)) : records;
    indexById = new Map(visible.map((record, index) => [record.node.id, index]));
    content.style.height = `${visible.length * ROW_HEIGHT}px`;
    empty.hidden = visible.length > 0;
    // An empty list means one of two very different things, so say which.
    empty.textContent = query ? t("No matching elements.")
      : t("No editable HTML elements. SVG and canvas content stays visible and is preserved when saving.");
    count.textContent = String(records.length);
    count.title = query ? t`${records.length} total · ${visible.length} shown` : t`${records.length} elements`;
    container.setAttribute('aria-label', query ? t`Document elements: ${visible.length} matches` : t("Document elements"));
  }

  function buttonFor(record) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer';
    button.dataset.nodeId = record.node.id;
    button.setAttribute('role', 'option');
    Object.assign(button.style, {
      position: 'absolute', left: '0', right: '0', height: `${ROW_HEIGHT}px`,
      minHeight: `${ROW_HEIGHT}px`, boxSizing: 'border-box', margin: '0',
    });
    const tag = document.createElement('span');
    tag.className = 'layer-tag';
    tag.textContent = record.node.tag;
    const label = document.createElement('span');
    label.className = 'layer-label';
    button.append(tag, label);
    return button;
  }

  function render() {
    if (destroyed) return;
    const height = container.clientHeight || ROW_HEIGHT * 10;
    const maxScroll = Math.max(0, visible.length * ROW_HEIGHT - height);
    if (container.scrollTop > maxScroll) container.scrollTop = maxScroll;
    const start = Math.max(0, Math.floor(container.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(visible.length, Math.ceil((container.scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
    const wanted = new Set(visible.slice(start, end).map((record) => record.node.id));
    // Preserve keyboard focus when a wheel scroll takes its row outside the window.
    const focusedId = container.ownerDocument.activeElement?.closest?.('.layer')?.dataset.nodeId;
    if (focusedId && indexById.has(focusedId)) wanted.add(focusedId);
    for (const [id, button] of rendered) {
      if (!wanted.has(id)) { button.remove(); rendered.delete(id); }
    }
    const tabId = wanted.has(focusedId) ? focusedId : wanted.has(primary) ? primary : visible[start]?.node.id;
    let nextChild = content.firstElementChild;
    for (const id of [...wanted].sort((left, right) => indexById.get(left) - indexById.get(right))) {
      const record = byId.get(id);
      const index = indexById.get(id);
      let button = rendered.get(id);
      if (!button) {
        button = buttonFor(record);
        rendered.set(id, button);
        content.append(button);
      }
      if (button !== nextChild) content.insertBefore(button, nextChild);
      nextChild = button.nextElementSibling;
      button.style.top = `${index * ROW_HEIGHT}px`;
      button.style.paddingLeft = `${8 + record.depth * 9}px`;
      button.disabled = busy;
      button.tabIndex = id === tabId ? 0 : -1;
      button.classList.toggle('active', selected.has(id));
      button.classList.toggle('dirty', record.dirty);
      button.setAttribute('aria-selected', String(selected.has(id)));
      button.setAttribute('aria-posinset', String(index + 1));
      button.setAttribute('aria-setsize', String(visible.length));
      button.title = record.label;
      const label = button.lastElementChild;
      if (label.textContent !== record.label) label.textContent = record.label;
    }
  }

  function schedule(refilter = false) {
    filterPending ||= refilter;
    if (scheduled || destroyed) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      if (filterPending) { filterPending = false; filter(); }
      if (revealPending) { revealPending = false; reveal(primary); }
      render();
    });
  }

  function reveal(id) {
    const index = indexById.get(id);
    if (index !== undefined) {
      const top = index * ROW_HEIGHT;
      if (top < container.scrollTop) container.scrollTop = top;
      else if (top + ROW_HEIGHT > container.scrollTop + container.clientHeight) {
        container.scrollTop = top + ROW_HEIGHT - container.clientHeight;
      }
    }
  }

  function setSelected(ids, { primary: nextPrimary, reveal: shouldReveal = true } = {}) {
    selected = ids instanceof Set ? new Set(ids) : new Set(ids ? [ids] : []);
    primary = selected.has(nextPrimary) ? nextPrimary
      : selected.has(primary) ? primary : selected.values().next().value ?? null;
    if (shouldReveal) reveal(primary);
    render();
  }

  function activate(id, event) {
    if (busy || !byId.has(id)) return;
    // The controller owns the selection, including modifier keys and ancestor handling.
    onSelect(id, event);
    reveal(id);
    render();
  }

  function click(event) {
    const button = event.target.closest?.('.layer');
    if (button && content.contains(button)) activate(button.dataset.nodeId, event);
  }

  function keyDown(event) {
    const button = event.target.closest?.('.layer');
    if (!button || busy || event.isComposing || event.altKey) return;
    if ((event.metaKey || event.ctrlKey) && event.key !== ' ' && event.key !== 'Enter') return;
    const index = indexById.get(button.dataset.nodeId);
    let next;
    if (event.key === 'ArrowDown') next = Math.min(visible.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else if (event.key === ' ' || event.key === 'Enter') next = index;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const id = visible[next]?.node.id;
    if (!id) return;
    activate(id, event);
    rendered.get(id)?.focus({ preventScroll: true });
    render();
  }

  const onSearch = () => {
    container.scrollTop = 0;
    // Clearing a search returns to the element being edited, even deep in a long document.
    revealPending = !search.value.trim();
    schedule(true);
  };
  const onScroll = () => schedule();
  const stopSpace = (event) => { if (event.code === 'Space') event.stopPropagation(); };
  container.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('click', click);
  container.addEventListener('keydown', keyDown);
  container.addEventListener('keyup', stopSpace);
  search.addEventListener('input', onSearch);
  const observer = new ResizeObserver(() => schedule());
  observer.observe(container);

  return {
    setDocument(nodes, changes = {}) {
      records = [...nodes.values()].map((node) => {
        let depth = 0;
        let parent = nodes.get(node.parentId);
        while (parent && depth < 6) { depth++; parent = nodes.get(parent.parentId); }
        const record = { node, depth };
        updateRecord(record, changes[node.id]);
        return record;
      });
      byId = new Map(records.map((record) => [record.node.id, record]));
      selected = new Set();
      primary = null;
      container.scrollTop = 0;
      content.replaceChildren();
      rendered = new Map();
      filter();
      render();
    },
    setChanges(changes, changedIds) {
      if (changedIds) {
        for (const id of changedIds) {
          const record = byId.get(id);
          if (record) updateRecord(record, changes[id]);
        }
      } else {
        for (const record of records) updateRecord(record, changes[record.node.id]);
      }
      schedule(Boolean(search.value.trim()));
    },
    setSelected,
    setLoading(value) {
      if (busy === value) return;
      busy = value;
      container.setAttribute('aria-busy', String(busy));
      search.disabled = busy;
      render();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(scheduled);
      observer.disconnect();
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('click', click);
      container.removeEventListener('keydown', keyDown);
      container.removeEventListener('keyup', stopSpace);
      search.removeEventListener('input', onSearch);
    },
  };
}
