import { open, realpath, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describeDocument, editHtml, EditorError, styleProperties, type Change, type EditableNode, type StructuralOperation } from './editor.js';
import { sourceHash } from './hash.js';

export const SOURCE_LIMIT = 16 * 1024 * 1024;
export const PATCH_LIMIT = 1024 * 1024;
const TEXT_LIMIT = 1000;

export class DocumentCommandError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new DocumentCommandError(code, message); };
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_PATCH', `${label} must be an object.`);
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) fail('INVALID_PATCH', `${label} contains unsupported key "${extra}".`);
}
function htmlFile(file: string) {
  if (!['.html', '.htm'].includes(path.extname(file).toLowerCase())) fail('INVALID_FILE', 'Use an .html or .htm file.');
}

/** Never allocate in proportion to an unchecked file size, including a growing file. */
async function readBounded(file: string, maximum: number) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) return fail('INVALID_FILE', 'The path must refer to a regular file.');
    if (info.size > maximum) return fail('TOO_LARGE', `File exceeds ${maximum} UTF-8 bytes.`);
    const chunks: Buffer[] = [];
    let size = 0;
    while (size <= maximum) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) return fail('TOO_LARGE', `File exceeds ${maximum} UTF-8 bytes.`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size)); }
    catch { return fail('INVALID_UTF8', 'The file must contain valid UTF-8. Convert its encoding before editing.'); }
    return { source, mode: info.mode & 0o777 };
  } finally { await handle.close(); }
}

export type InspectOptions = { limit?: number; offset?: number; query?: string };
export async function inspectDocument(file: string, options: InspectOptions = {}) {
  htmlFile(file);
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('INVALID_ARGUMENT', '--limit must be an integer from 1 to 200.');
  if (!Number.isSafeInteger(offset) || offset < 0) fail('INVALID_ARGUMENT', '--offset must be a nonnegative integer.');
  if (options.query !== undefined && (typeof options.query !== 'string' || options.query.length > 200)) fail('INVALID_ARGUMENT', '--query must contain at most 200 characters.');
  const actual = await realpath(path.resolve(file));
  const { source } = await readBounded(actual, SOURCE_LIMIT);
  const description = describeDocument(source);
  const query = options.query?.toLowerCase();
  const matched = query ? description.nodes.filter(node => `${node.htmlId ?? ''}\n${node.tag}\n${node.text ?? ''}`.toLowerCase().includes(query)) : description.nodes;
  const nodes = matched.slice(offset, offset + limit).map(node => ({
    ...node, label: node.label.slice(0, 200), htmlId: node.htmlId?.slice(0, 1000) ?? null,
    htmlIdTruncated: (node.htmlId?.length ?? 0) > 1000, text: node.text?.slice(0, TEXT_LIMIT) ?? null,
    textTruncated: node.text !== null && node.text.length > TEXT_LIMIT,
  }));
  return {
    version: 1, command: 'inspect', file: actual, hash: sourceHash(source), bytes: Buffer.byteLength(source),
    total: description.nodes.length, matched: matched.length, offset, limit, returned: nodes.length,
    nextOffset: offset + nodes.length < matched.length ? offset + nodes.length : null,
    textLimit: TEXT_LIMIT, compatibility: description.compatibility,
    styleProperties: [...styleProperties], nodes,
  };
}

function normalizeChanges(value: unknown, nodes: EditableNode[], allowTargets: boolean): Change[] {
  if (!Array.isArray(value) || value.length > 10_000) return fail('INVALID_PATCH', 'changes must be an array with at most 10000 entries.');
  const targets = new Map<string, EditableNode[]>();
  if (allowTargets) for (const node of nodes) {
    if (!node.htmlId) continue;
    const existing = targets.get(node.htmlId);
    if (existing) existing.push(node);
    else targets.set(node.htmlId, [node]);
  }
  return value.map((item, index) => {
    const change = object(item, `changes[${index}]`);
    keys(change, allowTargets ? ['id', 'target', 'text', 'styles'] : ['id', 'text', 'styles'], `changes[${index}]`);
    let id: string;
    if (Object.hasOwn(change, 'target')) {
      if (Object.hasOwn(change, 'id')) return fail('INVALID_PATCH', 'Each change must use exactly one of id or target.');
      if (typeof change.target !== 'string' || !change.target || change.target.length > 1000) return fail('INVALID_PATCH', 'target must be a nonempty HTML id, without a # prefix.');
      const found = targets.get(change.target) ?? [];
      if (found.length === 0) return fail('TARGET_NOT_FOUND', `No editable element has HTML id "${change.target}".`);
      if (found.length > 1) return fail('AMBIGUOUS_TARGET', `HTML id "${change.target}" matches multiple editable elements. Use an inspected id or fix duplicate HTML ids.`);
      id = found[0]!.id;
    } else {
      if (typeof change.id !== 'string' || !/^(?:c\d{1,9}:)*e\d+$/.test(change.id)) return fail('INVALID_PATCH', 'id must be an element id returned by inspect or a virtual duplicate id.');
      id = change.id;
    }
    if (!Object.hasOwn(change, 'text') && !Object.hasOwn(change, 'styles')) return fail('INVALID_PATCH', 'A change must contain text or styles.');
    const normalized: Change = { id };
    if (Object.hasOwn(change, 'text')) {
      if (typeof change.text !== 'string') return fail('INVALID_PATCH', 'text must be a string. Only leaf elements accept text changes.');
      normalized.text = change.text;
    }
    if (Object.hasOwn(change, 'styles')) {
      const styles = object(change.styles, 'styles');
      for (const [property, setting] of Object.entries(styles)) {
        if (!styleProperties.has(property)) return fail('UNSUPPORTED_STYLE', `Unsupported style property "${property}". Read styleProperties from inspect.`);
        if (typeof setting !== 'string' || setting.length > 500) return fail('INVALID_STYLE', `Style "${property}" must be a string of at most 500 characters.`);
      }
      normalized.styles = styles as Record<string, string>;
    }
    return normalized;
  });
}

function normalizePatch(value: unknown, nodes: EditableNode[]) {
  const patch = object(value, 'patch');
  keys(patch, ['version', 'hash', 'changes', 'operations'], 'patch');
  if (patch.version !== 1) return fail('INVALID_PATCH', 'patch.version must be 1.');
  if (typeof patch.hash !== 'string' || !/^[a-f0-9]{64}$/.test(patch.hash)) return fail('INVALID_PATCH', 'patch.hash must be the SHA-256 hash returned by inspect.');
  const changes = normalizeChanges(patch.changes, nodes, true);
  const rawOperations = Object.hasOwn(patch, 'operations') ? patch.operations : [];
  if (!Array.isArray(rawOperations) || rawOperations.length > 500) return fail('INVALID_PATCH', 'operations must be an array with at most 500 entries.');
  const operations: StructuralOperation[] = rawOperations.map((item, index) => {
    const operation = object(item, `operations[${index}]`);
    if (operation.type !== 'duplicate' && operation.type !== 'delete') return fail('INVALID_PATCH', 'An operation must have type duplicate or delete.');
    keys(operation, operation.type === 'delete' ? ['type', 'id'] : ['type', 'id', 'copyId', 'changes'], `operations[${index}]`);
    if (typeof operation.id !== 'string' || !/^(?:c\d{1,9}:)*e\d+$/.test(operation.id)) return fail('INVALID_PATCH', 'An operation requires an inspected or virtual duplicate id.');
    if (operation.type === 'delete') return { type: 'delete', id: operation.id };
    if (typeof operation.copyId !== 'string' || !/^c\d{1,9}$/.test(operation.copyId)) return fail('INVALID_PATCH', 'duplicate.copyId must match c followed by 1 to 9 digits.');
    return { type: 'duplicate', id: operation.id, copyId: operation.copyId, changes: normalizeChanges(operation.changes, nodes, false) };
  });
  return { hash: patch.hash, changes, operations };
}

export type ApplyOptions = { patch: string } & ({ mode: 'dry-run' | 'write' } | { mode: 'output'; output: string });
export async function applyDocument(file: string, options: ApplyOptions) {
  htmlFile(file);
  if (!['dry-run', 'write', 'output'].includes(options.mode)) fail('INVALID_ARGUMENT', 'Choose exactly one output mode: --dry-run, --write or --output.');
  if (options.mode === 'output') htmlFile(options.output);
  const actual = await realpath(path.resolve(file));
  const original = await readBounded(actual, SOURCE_LIMIT);
  const patchSource = await readBounded(path.resolve(options.patch), PATCH_LIMIT);
  let parsed: unknown;
  try { parsed = JSON.parse(patchSource.source); } catch { return fail('INVALID_JSON', 'The patch must be valid JSON.'); }
  const hash = sourceHash(original.source);
  const envelope = object(parsed, 'patch');
  if (envelope.version !== 1 || typeof envelope.hash !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.hash)) return fail('INVALID_PATCH', 'patch.version must be 1 and patch.hash must be the SHA-256 hash returned by inspect.');
  if (envelope.hash !== hash) return fail('STALE_HASH', 'The HTML changed since inspection. Inspect again and rebuild the patch; no file was written.');
  const patch = normalizePatch(parsed, describeDocument(original.source).nodes);
  let updated: string;
  try { updated = editHtml(original.source, patch.changes, patch.operations); }
  catch (error) {
    if (error instanceof EditorError) return fail('EDIT_REJECTED', `The source editor rejected this patch: ${error.message}`);
    throw error;
  }
  const bytes = Buffer.byteLength(updated);
  if (bytes > SOURCE_LIMIT) return fail('TOO_LARGE', 'The edited document exceeds 16 MiB. Split the work into smaller documents.');
  const result = {
    version: 1, command: 'apply', mode: options.mode, file: actual, hashBefore: hash, hashAfter: sourceHash(updated),
    changed: updated !== original.source, changes: patch.changes.length, operations: patch.operations.length, bytes,
    written: false, output: null as string | null, backup: null as string | null,
  };
  if (options.mode === 'dry-run') return result;
  const checkCurrent = async () => {
    if (sourceHash((await readBounded(actual, SOURCE_LIMIT)).source) !== hash) fail('STALE_HASH', 'The HTML changed before writing. Inspect again; the original was not overwritten.');
  };
  await checkCurrent();
  if (options.mode === 'output') {
    const output = path.resolve(options.output);
    const handle = await open(output, 'wx', original.mode);
    try { await handle.writeFile(updated, 'utf8'); await handle.chmod(original.mode); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(output).catch(() => undefined); throw error; }
    await handle.close();
    return { ...result, written: true, output };
  }
  if (!result.changed) return result;
  const history = path.join(path.dirname(actual), '.history');
  try { await mkdir(history); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (!(await lstat(history)).isDirectory() || await realpath(history) !== history) return fail('INVALID_HISTORY', 'The .history backup path must be a real directory beside the HTML file.');
  const backup = path.join(history, `${path.basename(actual)}.${new Date().toISOString().replaceAll(':', '-')}.${randomUUID()}.bak`);
  const backupHandle = await open(backup, 'wx', original.mode);
  try { await backupHandle.writeFile(original.source, 'utf8'); await backupHandle.sync(); } finally { await backupHandle.close(); }
  const temporary = path.join(path.dirname(actual), `.pagecraft-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', original.mode);
    try { await handle.writeFile(updated, 'utf8'); await handle.chmod(original.mode); await handle.sync(); } finally { await handle.close(); }
    await checkCurrent();
    await rename(temporary, actual);
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  return { ...result, written: true, output: actual, backup };
}

export function commandError(error: unknown) {
  if (error instanceof DocumentCommandError) return { code: error.code, message: error.message };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const messages: Record<string, string> = {
    ENOENT: 'A source, patch or output directory does not exist.',
    EEXIST: 'The output already exists. Choose a new filename; no existing file was overwritten.',
    EACCES: 'Permission denied while accessing a local file.',
    EPERM: 'The operating system denied this local file operation.',
    EISDIR: 'Expected a regular file, but received a directory.',
    ENOSPC: 'The disk is full. Free space before retrying.',
  };
  return { code: code && Object.hasOwn(messages, code) ? code : 'IO_ERROR', message: code && messages[code] || 'The local document operation failed.' };
}
