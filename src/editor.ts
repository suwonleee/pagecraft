import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
export type EditableNode = { id: string; htmlId?: string | null; tag: string; label: string; text: string | null; parentId: string | null; canDuplicate: boolean };
export type DocumentCompatibility = { scripts: number; externalStyles: number; localStyles: number; externalAssets: number; localAssets: number; viewportHeight: number; drawn: number };
export type DocumentDescription = { nodes: EditableNode[]; compatibility: DocumentCompatibility };
type LocatedNode = EditableNode & { element: Element; textRange: { start: number; end: number } | null };
export type Change = { id: string; text?: string; styles?: Record<string, string> };
export type StructuralOperation = { type: 'duplicate'; id: string; copyId: string; changes: Change[] } | { type: 'delete'; id: string };
type Patch = { start: number; end: number; text: string };

export class EditorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const styleProperties = new Set([
  'color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
  'text-align', 'white-space', 'width', 'height', 'min-height', 'padding', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin', 'gap', 'border-radius', 'display', 'flex-direction', 'justify-content', 'align-items', 'translate',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-width', 'border-style',
  'box-sizing', 'position', 'top', 'right', 'bottom', 'left', 'max-width', 'min-width', 'max-height', 'overflow', 'overflow-x',
  'overflow-y', 'opacity', 'box-shadow', 'align-self', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-wrap',
  'grid-column', 'grid-row', 'grid-template-columns', 'grid-template-rows', 'object-fit', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'row-gap', 'column-gap', 'vertical-align', 'visibility', 'z-index',
]);
const excluded = new Set(['head', 'script', 'style', 'template', 'noscript', 'form', 'input', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'svg', 'math', 'link', 'meta', 'base']);
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const isElement = (node: Node): node is Element => 'tagName' in node;
const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (value: string) => escapeText(value).replaceAll('"', '&quot;');
const utf8 = new TextEncoder();
const byteLength = (value: string) => utf8.encode(value).byteLength;

function inspect(source: string, onElement?: (element: Element) => void): { nodes: LocatedNode[]; elements: Element[]; mode: DefaultTreeAdapterMap['document']['mode'] } {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const nodes: LocatedNode[] = [];
  const elements: Element[] = [];
  const visit = (node: Node, inBody: boolean, blocked: boolean, parentId: string | null) => {
    let nextParent = parentId;
    if (isElement(node)) {
      elements.push(node);
      onElement?.(node);
      inBody ||= node.tagName === 'body';
      blocked ||= excluded.has(node.tagName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml';
      const location = node.sourceCodeLocation;
      if (inBody && !blocked && node.tagName !== 'body' && location?.startTag) {
        const id = `e${location.startOffset}`;
        const leaf = !voidTags.has(node.tagName) && node.childNodes.every(child => child.nodeName === '#text');
        const text = leaf ? node.childNodes.map(child => 'value' in child ? child.value : '').join('') : null;
        const textRange = leaf ? { start: location.startTag.endOffset, end: location.endTag?.startOffset ?? location.endOffset } : null;
        const identity = node.attrs.find(attr => attr.name === 'id')?.value;
        const label = `${node.tagName}${identity ? `#${identity}` : ''}${text?.trim() ? ` · ${text.trim().replace(/\s+/g, ' ').slice(0, 70)}` : ''}`;
        nodes.push({ id, htmlId: identity ?? null, tag: node.tagName, label, text, parentId, canDuplicate: voidTags.has(node.tagName) || Boolean(location.endTag), element: node, textRange });
        nextParent = id;
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, inBody, blocked, nextParent);
    if ('content' in node) visit(node.content as Node, inBody, true, nextParent);
  };
  visit(document, false, false, null);
  return { nodes, elements, mode: document.mode };
}

function patchesApplied(source: string, patches: Patch[]): string {
  const result: string[] = [];
  let cursor = 0;
  for (const patch of patches.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (patch.start < cursor) throw new EditorError(400, "Overlapping edits. Reopen the document.");
    result.push(source.slice(cursor, patch.start), patch.text);
    cursor = patch.end;
  }
  result.push(source.slice(cursor));
  return result.join('');
}

const editableNodes = (nodes: LocatedNode[]): EditableNode[] => nodes.map(({ element: _element, textRange: _range, ...node }) => node);

export function describeHtml(source: string): EditableNode[] {
  return editableNodes(inspect(source).nodes);
}

const javascriptTypes = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
  'text/x-ecmascript', 'text/x-javascript',
]);
const mediaTags = new Set(['img', 'source', 'video', 'audio']);
// Drawn surfaces: their contents render and are preserved, but they hold no HTML
// elements to select, so a document made of them offers nothing to edit.
const drawnTags = new Set(['svg', 'canvas', 'math', 'object', 'embed', 'iframe']);
const htmlAttribute = (element: Element, name: string) => element.attrs.find(item => item.name === name)?.value;
// Lengths that resolve against the viewport height. A preview frame sized to its own
// content would redefine them, so a document using them needs a fixed-size viewport.
const viewportHeightUnits = /(?:^|[\s:,(*/+-])\d*\.?\d+(?:vh|dvh|svh|lvh|vb|vmin|vmax)\b/gi;
const countViewportHeights = (css: string | undefined) => css ? (css.match(viewportHeightUnits)?.length ?? 0) : 0;

/** Count supported HTML tag references while describing the same parsed tree.
 * CSS URLs, srcset, SVG references and script behavior are outside this diagnostic.
 */
export function describeDocument(source: string): DocumentDescription {
  const compatibility: DocumentCompatibility = { scripts: 0, externalStyles: 0, localStyles: 0, externalAssets: 0, localAssets: 0, viewportHeight: 0, drawn: 0 };
  const countReference = (value: string | undefined, kind: 'Styles' | 'Assets') => {
    const reference = value?.trim();
    if (!reference || reference.startsWith('#') || /^data:/i.test(reference)) return;
    compatibility[`${/^(?:https?:|\/\/)/i.test(reference) ? 'external' : 'local'}${kind}`]++;
  };
  const { nodes } = inspect(source, element => {
    if (drawnTags.has(element.tagName) && element.parentNode && !drawnTags.has((element.parentNode as Element).tagName)) compatibility.drawn++;
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !element.sourceCodeLocation?.startTag) return;
    compatibility.viewportHeight += countViewportHeights(htmlAttribute(element, 'style'));
    if (element.tagName === 'style') {
      compatibility.viewportHeight += element.childNodes.reduce((total, child) => total + countViewportHeights('value' in child ? child.value : ''), 0);
    } else if (element.tagName === 'script') {
      const type = (htmlAttribute(element, 'type') ?? '').trim().toLowerCase();
      if (!type || type === 'module' || javascriptTypes.has(type)) compatibility.scripts++;
    } else if (element.tagName === 'link' && htmlAttribute(element, 'rel')?.toLowerCase().split(/\s+/).includes('stylesheet')) {
      countReference(htmlAttribute(element, 'href'), 'Styles');
    } else if (mediaTags.has(element.tagName)) {
      countReference(htmlAttribute(element, 'src'), 'Assets');
      if (element.tagName === 'video') countReference(htmlAttribute(element, 'poster'), 'Assets');
    }
  });
  return { nodes: editableNodes(nodes), compatibility };
}

function insertionOffset(source: string, element: Element): number {
  const end = element.sourceCodeLocation!.startTag!.endOffset;
  const raw = source.slice(element.sourceCodeLocation!.startTag!.startOffset, end);
  const suffix = raw.match(/\/\s*>$/);
  return suffix ? end - suffix[0].length : end - 1;
}

export function previewHtml(source: string, policy?: string): string {
  const { nodes, elements, mode } = inspect(source);
  const patches: Patch[] = [];
  for (const element of elements) {
    const location = element.sourceCodeLocation;
    if (!location?.startTag) continue;
    if (element.tagName === 'base' || (element.tagName === 'meta' && element.attrs.some(attr => attr.name === 'http-equiv' && ['refresh', 'content-security-policy'].includes(attr.value.toLowerCase())))) {
      patches.push({ start: location.startOffset, end: location.endOffset, text: '' });
      continue;
    }
    for (const name of ['data-muse-edit-id', ...(element.tagName === 'button' ? ['disabled'] : [])]) {
      const attr = location.attrs?.[name];
      if (attr) patches.push({ start: attr.startOffset, end: attr.endOffset, text: '' });
    }
  }
  for (const node of nodes) {
    const at = insertionOffset(source, node.element);
    patches.push({ start: at, end: at, text: ` data-muse-edit-id="${node.id}"` });
  }
  const preview = patchesApplied(source, patches);
  if (policy === undefined) return preview;
  // Use only a trusted doctype before the policy. Copying a source prefix could
  // expose executable HTML hidden behind malformed comments or doctypes.
  const doctype = mode === 'no-quirks' ? '<!doctype html>' : mode === 'limited-quirks'
    ? '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">' : '';
  return `${doctype}<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">${preview}`;
}

function updateStyles(original: string, changes: Record<string, string>): string {
  let styles = original;
  for (const [property, value] of Object.entries(changes)) {
    if (!styleProperties.has(property) || typeof value !== 'string' || value.length > 500) throw new EditorError(400, "Unsupported style property.");
    // One declaration only; the editor never accepts CSS rules or resource loading.
    if (/[;{}<>\u0000-\u001f]/.test(value) || /\/\*|\*\/|url\s*\(|expression\s*\(|@|\\|!important/i.test(value)) throw new EditorError(400, "Enter a single CSS value for each style.");
    const pattern = new RegExp(`/\\*muse:${property}\\*/[\\s\\S]*?/\\*/muse:${property}\\*/`, 'g');
    styles = styles.replace(pattern, '');
    if (value.trim()) {
      // Preserve original declarations, including their priority, ahead of our override.
      const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, '').trimEnd();
      const separator = declarations && !declarations.endsWith(';') ? ';' : '';
      styles += `${separator}/*muse:${property}*/${property}: ${value.trim()} !important;/*/muse:${property}*/`;
    }
  }
  return styles;
}

export function editHtml(source: string, changes: unknown, operations: unknown = []): string {
  if (!Array.isArray(operations) || operations.length > 500) throw new EditorError(400, "Save up to 500 structural operations at a time.");
  if (operations.length) return editStructure(source, changes, operations);
  if (!Array.isArray(changes) || changes.length > 10_000) throw new EditorError(400, "A changes array is required, with up to 10,000 elements per edit.");
  const nodes = new Map(inspect(source).nodes.map(node => [node.id, node]));
  const patches: Patch[] = [];
  const seen = new Set<string>();
  for (const change of changes as Change[]) {
    if (!change || typeof change.id !== 'string' || seen.has(change.id)) throw new EditorError(400, "Invalid or duplicate element ID.");
    seen.add(change.id);
    const node = nodes.get(change.id);
    if (!node) throw new EditorError(400, "The element was not found. Reopen the document.");
    if (Object.hasOwn(change, 'text')) {
      if (typeof change.text !== 'string' || !node.textRange) throw new EditorError(400, "This element does not support direct text editing.");
      if (change.text !== node.text) patches.push({ ...node.textRange, text: escapeText(change.text) });
    }
    if (Object.hasOwn(change, 'styles')) {
      if (!change.styles || typeof change.styles !== 'object' || Array.isArray(change.styles)) throw new EditorError(400, "A styles object is required.");
      const oldStyle = node.element.attrs.find(attr => attr.name === 'style')?.value ?? '';
      const newStyle = updateStyles(oldStyle, change.styles);
      if (newStyle === oldStyle) continue;
      const attr = node.element.sourceCodeLocation!.attrs?.style;
      if (attr) patches.push({ start: attr.startOffset, end: attr.endOffset, text: `style="${escapeAttribute(newStyle)}"` });
      else if (newStyle) {
        const at = insertionOffset(source, node.element);
        patches.push({ start: at, end: at, text: ` style="${escapeAttribute(newStyle)}"` });
      }
    }
  }
  return patchesApplied(source, patches);
}

type SourcePart = { kind: 'source'; start: number; end: number; bytes: number };
type VirtualElement = {
  kind: 'element'; start: number; end: number; element: Element | null; editable: LocatedNode | null;
  id: string | null; parent: VirtualElement | null; parts: (SourcePart | VirtualElement)[];
  text?: string; styles: Record<string, string>; attributes: Map<string, string>;
};
const attributeName = (attribute: Element['attrs'][number]) => attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
const currentAttribute = (node: VirtualElement, name: string) => node.attributes.get(name) ?? node.element?.attrs.find(attribute => attributeName(attribute) === name)?.value;
const structureError = () => new EditorError(400, "Overlapping HTML element boundaries prevent structural edits. Check the HTML tags.");
const idReferences = new Set(['for', 'form', 'list', 'headers', 'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns']);
const fragmentReferences = new Set(['href', 'xlink:href', 'usemap']);
const resourceReferences = new Set(['style', 'clip-path', 'mask', 'fill', 'stroke', 'filter', 'marker-start', 'marker-mid', 'marker-end']);

/** Keep source slices as shared ranges. Copying never reparses or serializes the whole document. */
function editStructure(source: string, changes: unknown, operations: unknown[]): string {
  const inspected = inspect(source);
  const editableByElement = new Map(inspected.nodes.map(node => [node.element, node]));
  const root: VirtualElement = { kind: 'element', start: 0, end: source.length, element: null, editable: null, id: null, parent: null, parts: [], styles: {}, attributes: new Map() };
  const index = new Map<string, VirtualElement>();
  const reservedIds = new Set<string>();
  const stack = [root];
  const sourceElements = inspected.elements.filter(element => element.sourceCodeLocation?.startTag).sort((a, b) => a.sourceCodeLocation!.startOffset - b.sourceCodeLocation!.startOffset);
  if (sourceElements.length > 50_000) throw new EditorError(413, "Structural edits support documents with up to 50,000 elements.");
  for (const element of sourceElements) {
    const location = element.sourceCodeLocation!;
    while (stack.length > 1 && location.startOffset >= stack[stack.length - 1]!.end) stack.pop();
    const parent = stack[stack.length - 1]!;
    if (location.startOffset < parent.start || location.endOffset > parent.end || location.endOffset < location.startTag!.endOffset) throw structureError();
    const editable = editableByElement.get(element) ?? null;
    const node: VirtualElement = { kind: 'element', start: location.startOffset, end: location.endOffset, element, editable, id: editable?.id ?? null, parent, parts: [], styles: {}, attributes: new Map() };
    if (editable) {
      let editableParent = parent;
      while (editableParent.parent && !editableParent.editable) editableParent = editableParent.parent;
      if (editable.parentId !== editableParent.id) throw structureError();
      index.set(editable.id, node);
    }
    const htmlId = currentAttribute(node, 'id');
    if (htmlId) reservedIds.add(htmlId);
    parent.parts.push(node);
    stack.push(node);
  }
  const fillGaps = (node: VirtualElement) => {
    const children = node.parts as VirtualElement[];
    node.parts = [];
    let cursor = node.start;
    for (const child of children) {
      if (child.start < cursor) throw structureError();
      if (child.start > cursor) node.parts.push({ kind: 'source', start: cursor, end: child.start, bytes: byteLength(source.slice(cursor, child.start)) });
      fillGaps(child);
      node.parts.push(child);
      cursor = child.end;
    }
    if (cursor < node.end) node.parts.push({ kind: 'source', start: cursor, end: node.end, bytes: byteLength(source.slice(cursor, node.end)) });
  };
  fillGaps(root);
  const visit = (node: VirtualElement, callback: (item: VirtualElement) => void) => {
    callback(node);
    for (const part of node.parts) if (part.kind === 'element') visit(part, callback);
  };
  let totalChanges = 0;
  const applyChanges = (value: unknown, targets: Map<string, VirtualElement>) => {
    if (!Array.isArray(value) || value.length > 10_000 || (totalChanges += value.length) > 50_000) throw new EditorError(400, "The changes array supports 10,000 elements, with 50,000 total edits per save.");
    const seen = new Set<string>();
    for (const change of value as Change[]) {
      if (!change || typeof change.id !== 'string' || seen.has(change.id)) throw new EditorError(400, "Invalid or duplicate element ID.");
      seen.add(change.id);
      const node = targets.get(change.id);
      if (!node?.editable) throw new EditorError(400, "The element was not found. Reopen the document.");
      if (Object.hasOwn(change, 'text')) {
        if (typeof change.text !== 'string' || !node.editable.textRange) throw new EditorError(400, "This element does not support direct text editing.");
        node.text = change.text;
      }
      if (Object.hasOwn(change, 'styles')) {
        if (!change.styles || typeof change.styles !== 'object' || Array.isArray(change.styles)) throw new EditorError(400, "A styles object is required.");
        updateStyles('', change.styles); // Validate even overrides hidden by a later edit or deletion.
        Object.assign(node.styles, change.styles);
      }
    }
  };
  const usedCopies = new Set<string>();
  let allocatedElements = sourceElements.length;
  let expandedBytes = byteLength(source);
  for (const value of operations) {
    if (!value || typeof value !== 'object') throw new EditorError(400, "Invalid structural editing operation.");
    const operation = value as StructuralOperation;
    const target = typeof operation.id === 'string' ? index.get(operation.id) : undefined;
    if (!target?.parent) throw new EditorError(400, "The element for this structural edit was not found.");
    const position = target.parent.parts.indexOf(target);
    if (position < 0) throw structureError();
    if (operation.type === 'delete') {
      target.parent.parts.splice(position, 1);
      visit(target, item => { if (item.id) index.delete(item.id); });
      continue;
    }
    if (operation.type !== 'duplicate' || typeof operation.copyId !== 'string' || !/^c\d{1,9}$/.test(operation.copyId) || usedCopies.has(operation.copyId)) throw new EditorError(400, "Invalid or duplicate copy ID.");
    if (target.element && !voidTags.has(target.element.tagName) && !target.element.sourceCodeLocation?.endTag) throw new EditorError(400, "Cannot duplicate an element without a closing tag. Add the closing tag in the HTML first.");
    usedCopies.add(operation.copyId);
    const snapshotTargets = new Map<string, VirtualElement>();
    const clone = (item: VirtualElement, parent: VirtualElement | null): VirtualElement => {
      if (++allocatedElements > 50_000) throw new EditorError(413, "Too many duplicated elements. Save in smaller batches.");
      const copied: VirtualElement = { ...item, id: item.id ? `${operation.copyId}:${item.id}` : null, parent, styles: { ...item.styles }, attributes: new Map(item.attributes), parts: [] };
      if (item.id) snapshotTargets.set(item.id, copied);
      copied.parts = item.parts.map(part => {
        if (part.kind === 'element') return clone(part, copied);
        expandedBytes += part.bytes;
        if (expandedBytes > 16 * 1024 * 1024) throw new EditorError(413, "The duplicated document exceeds 16 MiB. Save in smaller batches.");
        return part;
      });
      return copied;
    };
    const copied = clone(target, target.parent);
    applyChanges(operation.changes, snapshotTargets);
    const renamedIds = new Map<string, string>();
    visit(copied, item => {
      const oldId = currentAttribute(item, 'id');
      if (!oldId) return;
      const base = `${oldId}--${operation.copyId}`;
      let nextId = base;
      for (let suffix = 2; reservedIds.has(nextId); suffix++) nextId = `${base}--${suffix}`;
      reservedIds.add(nextId);
      if (!renamedIds.has(oldId)) renamedIds.set(oldId, nextId);
      item.attributes.set('id', nextId);
    });
    visit(copied, item => {
      for (const attribute of item.element?.attrs ?? []) {
        const name = attributeName(attribute);
        const original = currentAttribute(item, name)!;
        let updated = original;
        if (idReferences.has(name)) updated = original.replace(/\S+/g, id => renamedIds.get(id) ?? id);
        else if (fragmentReferences.has(name) && original.startsWith('#')) updated = renamedIds.has(original.slice(1)) ? `#${renamedIds.get(original.slice(1))!}` : original;
        else if (resourceReferences.has(name)) updated = original.replace(/url\(\s*(['"]?)#([^\s)'"\\]+)\1\s*\)/g, (match: string, quote: string, id: string) => renamedIds.has(id) ? `url(${quote}#${renamedIds.get(id)!}${quote})` : match);
        if (updated !== original) item.attributes.set(name, updated);
      }
      if (item.id) index.set(item.id, item);
    });
    target.parent.parts.splice(position + 1, 0, copied);
  }
  applyChanges(changes, index);
  const output: string[] = [];
  let renderedBytes = 0;
  const append = (value: string) => {
    if ((renderedBytes += byteLength(value)) > 16 * 1024 * 1024) throw new EditorError(413, "The edited document exceeds 16 MiB. Save in smaller batches.");
    output.push(value);
  };
  const render = (node: VirtualElement) => {
    const patches: Patch[] = [];
    const attributes = new Map(node.attributes);
    if (node.editable && Object.keys(node.styles).length) {
      const oldStyle = currentAttribute(node, 'style') ?? '';
      const newStyle = updateStyles(oldStyle, node.styles);
      if (newStyle !== oldStyle) attributes.set('style', newStyle);
    }
    for (const [name, value] of attributes) {
      const location = node.element?.sourceCodeLocation?.attrs?.[name];
      if (location) patches.push({ start: location.startOffset, end: location.endOffset, text: `${name}="${escapeAttribute(value)}"` });
      else if (node.element) {
        const at = insertionOffset(source, node.element);
        patches.push({ start: at, end: at, text: ` ${name}="${escapeAttribute(value)}"` });
      }
    }
    if (node.text !== undefined && node.editable?.textRange && node.text !== node.editable.text) patches.push({ ...node.editable.textRange, text: escapeText(node.text) });
    patches.sort((a, b) => a.start - b.start || a.end - b.end);
    let patchIndex = 0;
    for (const part of node.parts) {
      if (part.kind === 'element') { render(part); continue; }
      let cursor = part.start;
      while (patchIndex < patches.length && patches[patchIndex]!.start <= part.end) {
        const patch = patches[patchIndex]!;
        if (patch.start < cursor || patch.end > part.end) throw structureError();
        append(source.slice(cursor, patch.start));
        append(patch.text);
        cursor = patch.end;
        patchIndex++;
      }
      append(source.slice(cursor, part.end));
    }
    if (patchIndex !== patches.length) throw structureError();
  };
  render(root);
  return output.join('');
}
