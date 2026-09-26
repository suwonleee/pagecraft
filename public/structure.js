// Clone only the chosen subtrees. No document serialization or framework is needed.
const appearanceProperties = [
  'color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
  'text-align', 'white-space', 'width', 'height', 'min-height', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border-radius', 'display',
  'flex-direction', 'justify-content', 'align-items', 'translate', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'box-sizing', 'position', 'top', 'right', 'bottom', 'left', 'max-width', 'min-width', 'max-height',
  'overflow-x', 'overflow-y', 'opacity', 'box-shadow', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
  'flex-wrap', 'grid-column', 'grid-row', 'grid-template-columns', 'grid-template-rows', 'object-fit',
  'row-gap', 'column-gap', 'vertical-align', 'visibility', 'z-index',
];
const referenceAttributes = new Set(['for', 'headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'list', 'form']);
const marked = (root) => [root, ...root.querySelectorAll('[data-muse-edit-id]')];

function allElements(root) {
  const result = [];
  const visit = (parent) => {
    for (const child of parent.children) {
      result.push(child);
      visit(child);
      if (child.localName === 'template') visit(child.content);
    }
  };
  if (root.nodeType === 1) result.push(root);
  visit(root);
  if (root.localName === 'template') visit(root.content);
  return result;
}

export function collectHtmlIds(root) { return new Set(allElements(root).flatMap((element) => element.id ? [element.id] : [])); }
export function countSourceElements(root) { return allElements(root).length; }

function remapHtmlIds(root, copyId, reserved) {
  const all = allElements(root);
  const renamed = new Map();
  for (const element of all) {
    if (!element.id) continue;
    const base = `${element.id}--${copyId}`;
    let candidate = base;
    let suffix = 2;
    while (reserved.has(candidate)) candidate = `${base}--${suffix++}`;
    reserved.add(candidate);
    if (!renamed.has(element.id)) renamed.set(element.id, candidate);
    element.id = candidate;
  }
  for (const element of all) for (const attribute of [...element.attributes]) {
    if (referenceAttributes.has(attribute.name)) {
      element.setAttribute(attribute.name, attribute.value.replace(/\S+/g, (id) => renamed.get(id) || id));
    } else if (['href', 'xlink:href', 'usemap'].includes(attribute.name) && attribute.value.startsWith('#')) {
      const replacement = renamed.get(attribute.value.slice(1));
      if (replacement) element.setAttribute(attribute.name, `#${replacement}`);
    } else if (/url\(/i.test(attribute.value)) {
      element.setAttribute(attribute.name, attribute.value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, quote, id) => renamed.has(id) ? `url(${quote}#${renamed.get(id)}${quote})` : match));
    }
  }
}

export function prepareDuplicate(source, copyId, { nodes, changes, reservedHtmlIds }) {
  const sourceElements = marked(source);
  const clone = source.cloneNode(true);
  remapHtmlIds(clone, copyId, reservedHtmlIds);
  const cloneElements = marked(clone);
  const view = source.ownerDocument.defaultView;
  const records = sourceElements.map((element, index) => {
    const sourceId = element.dataset.museEditId;
    const previous = nodes.get(sourceId);
    const id = `${copyId}:${sourceId}`;
    const cloned = cloneElements[index];
    cloned.dataset.museEditId = id;
    const css = view.getComputedStyle(element);
    const appearance = Object.fromEntries(appearanceProperties.map((property) => [property, css.getPropertyValue(property)]));
    const text = previous.text === null ? null : cloned.textContent;
    return {
      id, sourceId, element: cloned,
      node: { ...previous, id, parentId: index ? `${copyId}:${previous.parentId}` : previous.parentId, text,
        label: `${previous.tag}${cloned.id ? `#${cloned.id}` : ''}${text?.trim() ? ` · ${text.trim().replace(/\s+/g, ' ').slice(0, 70)}` : ''}` },
      original: { style: cloned.getAttribute('style'), text },
      appearance,
    };
  });
  return {
    source, root: clone, records,
    operation: { type: 'duplicate', id: source.dataset.museEditId, copyId,
      changes: sourceElements.flatMap((element) => {
        const id = element.dataset.museEditId;
        return changes[id] ? [{ id, ...changes[id] }] : [];
      }) },
  };
}

export function measureDuplicateStyles(duplicate) {
  for (const record of duplicate.records) {
    measure(record);
  }
}

function measure(record) {
    const css = record.element.ownerDocument.defaultView.getComputedStyle(record.element);
    const styles = {};
    for (const [property, value] of Object.entries(record.appearance)) {
      // Remapped #id selectors can lose their rules; save only properties that changed.
      if (value !== css.getPropertyValue(property) && value && !/[;{}<>\u0000-\u001f]|\/\*|\*\/|url\s*\(|expression\s*\(|@|\\|!important/i.test(value)) styles[property] = value;
    }
    record.appearancePatch = styles;
}

export function finishDuplicateAppearance(duplicates) {
  // Restore containers together first; a second leaf read drops changes already supplied by inheritance/layout.
  for (const duplicate of duplicates) for (const record of duplicate.records) {
    if (record.node.text === null) applyAppearance(record);
  }
  for (const duplicate of duplicates) for (const record of duplicate.records) {
    if (record.node.text !== null) measure(record);
  }
  for (const duplicate of duplicates) {
    const snapshot = new Map(duplicate.operation.changes.map(({ id, ...patch }) => [id, patch]));
    for (const record of duplicate.records) {
      if (record.node.text !== null) applyAppearance(record);
      if (Object.keys(record.appearancePatch).length) {
        const before = snapshot.get(record.sourceId) || {};
        snapshot.set(record.sourceId, { ...before, styles: { ...before.styles, ...record.appearancePatch } });
      }
      record.original.style = record.element.getAttribute('style');
      delete record.appearance;
      delete record.appearancePatch;
      delete record.sourceId;
    }
    duplicate.operation.changes = [...snapshot].map(([id, patch]) => ({ id, ...patch }));
  }
}

function applyAppearance(record) {
  for (const [property, value] of Object.entries(record.appearancePatch)) record.element.style.setProperty(property, value, 'important');
}
