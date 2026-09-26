import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir, rm, chmod, stat, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyDocument, inspectDocument, SOURCE_LIMIT, PATCH_LIMIT } from './document-commands.js';
import { sourceHash } from './hash.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('./document-cli.ts', import.meta.url));
const fixture = '\uFEFF<!doctype html>\r\n<html lang="ko"><head><meta charset="utf-8"><style>p { color: blue }</style></head>\r\n<body><!-- keep exact spacing -->\r\n<section id="summary"><h1 id=\'report-title\'>Original &amp; title</h1><p id="lead" style=\'color:red\'>First paragraph</p></section>\r\n<script>window.example = "<p>source only</p>";</script></body></html>\r\n';
let directory: string;
let file: string;
let patchFile: string;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pagecraft-document-')));
  file = path.join(directory, 'report.html');
  patchFile = path.join(directory, 'edits.json');
  await writeFile(file, fixture);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function patch(changes: unknown, extra: Record<string, unknown> = {}, hash = sourceHash(fixture)) {
  await writeFile(patchFile, JSON.stringify({ version: 1, hash, changes, ...extra }));
}

describe('bounded document inspection', () => {
  it('returns bounded, paginated machine-readable nodes with stable HTML ids and exact source hash', async () => {
    const result = await inspectDocument(file, { limit: 2 });
    expect(result).toMatchObject({ version: 1, command: 'inspect', hash: sourceHash(fixture), total: 3, matched: 3, returned: 2, nextOffset: 2 });
    expect(result.nodes[1]).toMatchObject({ htmlId: 'report-title', tag: 'h1', text: 'Original & title', textTruncated: false });
    expect(result.nodes[1]?.parentId).toBe(result.nodes[0]?.id);
    expect(result.compatibility.scripts).toBe(1);
    expect(result.styleProperties).toContain('font-size');
    const next = await inspectDocument(file, { offset: result.nextOffset!, limit: 2 });
    expect(next).toMatchObject({ returned: 1, nextOffset: null });
    expect(next.nodes[0]?.htmlId).toBe('lead');
    const search = await inspectDocument(file, { query: 'PARAGRAPH' });
    expect(search).toMatchObject({ total: 3, matched: 1, returned: 1 });
    expect(search.nodes[0]?.htmlId).toBe('lead');
    expect(await readFile(file, 'utf8')).toBe(fixture);
  });

  it('bounds text, labels and HTML ids instead of emitting the whole document', async () => {
    await writeFile(file, `<p id="${'i'.repeat(5000)}">${'가'.repeat(5000)}</p>`);
    const node = (await inspectDocument(file)).nodes[0]!;
    expect(node).toMatchObject({ textTruncated: true, htmlIdTruncated: true });
    expect(node.text?.length).toBe(1000);
    expect(node.htmlId?.length).toBe(1000);
    expect(node.label.length).toBe(200);
  });

  it('rejects invalid pagination, oversized input and invalid UTF-8', async () => {
    for (const options of [{ limit: 0 }, { limit: 201 }, { limit: 2.5 }, { offset: -1 }, { query: 'a'.repeat(201) }]) {
      await expect(inspectDocument(file, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await writeFile(file, Buffer.alloc(SOURCE_LIMIT + 1, 32));
    await expect(inspectDocument(file)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await writeFile(file, Buffer.from([0x3c, 0xc3, 0x28]));
    await expect(inspectDocument(file)).rejects.toMatchObject({ code: 'INVALID_UTF8' });
  });
});

describe('source-preserving agent patch application', () => {
  it('validates a dry run without touching files, metadata or creating history', async () => {
    await patch([{ target: 'report-title', text: '검토 <완료> & next' }]);
    const before = await stat(file);
    const result = await applyDocument(file, { patch: patchFile, mode: 'dry-run' });
    expect(result).toMatchObject({ version: 1, command: 'apply', mode: 'dry-run', changed: true, written: false, output: null, backup: null });
    expect(result.hashAfter).toBe(sourceHash(fixture.replace('Original &amp; title', '검토 &lt;완료&gt; &amp; next')));
    expect(await readFile(file, 'utf8')).toBe(fixture);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
    expect((await readdir(directory)).sort()).toEqual(['edits.json', 'report.html']);
  });

  it('writes a new copy preserving unrelated source bytes and original permissions', async () => {
    await chmod(file, 0o640);
    await patch([{ target: 'report-title', text: 'Changed title' }, { target: 'lead', styles: { color: '#123456' } }]);
    const output = path.join(directory, 'reviewed.html');
    const result = await applyDocument(file, { patch: patchFile, mode: 'output', output });
    expect(result).toMatchObject({ written: true, output, backup: null });
    expect(await readFile(output, 'utf8')).toBe(fixture.replace('Original &amp; title', 'Changed title').replace("style='color:red'", 'style="color:red;/*muse:color*/color: #123456 !important;/*/muse:color*/"'));
    expect(await readFile(file, 'utf8')).toBe(fixture);
    expect((await stat(output)).mode & 0o777).toBe(0o640);
    expect(await readdir(directory)).not.toContain('.history');
  });

  it('never overwrites an output copy, the original or a symbolic link destination', async () => {
    await patch([{ target: 'lead', text: 'Copy' }]);
    const output = path.join(directory, 'existing.html');
    await writeFile(output, 'Keep this');
    for (const existing of [output, file]) {
      await expect(applyDocument(file, { patch: patchFile, mode: 'output', output: existing })).rejects.toMatchObject({ code: 'EEXIST' });
    }
    const linked = path.join(directory, 'linked.html');
    await symlink(output, linked);
    await expect(applyDocument(file, { patch: patchFile, mode: 'output', output: linked })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(output, 'utf8')).toBe('Keep this');
    expect(await readFile(file, 'utf8')).toBe(fixture);
  });

  it('backs up exact original bytes before atomically replacing an in-place file', async () => {
    await chmod(file, 0o640);
    await patch([{ target: 'report-title', text: 'AI revision' }]);
    const result = await applyDocument(file, { patch: patchFile, mode: 'write' });
    expect(result).toMatchObject({ written: true, output: file, mode: 'write' });
    expect(result.backup).toContain(path.join(directory, '.history', 'report.html.'));
    expect(await readFile(result.backup!, 'utf8')).toBe(fixture);
    expect(await readFile(file, 'utf8')).toBe(fixture.replace('Original &amp; title', 'AI revision'));
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects stale patches after a human changes text or removes the target', async () => {
    await patch([{ target: 'report-title', text: 'Stale AI revision' }]);
    const humanRevision = fixture.replace("<h1 id='report-title'>Original &amp; title</h1>", '<h2>Human revision</h2>');
    await writeFile(file, humanRevision);
    for (const options of [{ mode: 'write' as const }, { mode: 'dry-run' as const }, { mode: 'output' as const, output: path.join(directory, 'copy.html') }]) {
      await expect(applyDocument(file, { patch: patchFile, ...options })).rejects.toMatchObject({ code: 'STALE_HASH' });
    }
    expect(await readFile(file, 'utf8')).toBe(humanRevision);
    expect((await readdir(directory)).sort()).toEqual(['edits.json', 'report.html']);
  });

  it('rejects missing or ambiguous stable targets instead of picking the first match', async () => {
    await patch([{ target: 'missing', text: 'No' }]);
    await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    const duplicateIds = '<p id="same">First</p><p id="same">Second</p>';
    await writeFile(file, duplicateIds);
    await patch([{ target: 'same', text: 'No' }], {}, sourceHash(duplicateIds));
    await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET' });
    expect(await readFile(file, 'utf8')).toBe(duplicateIds);
  });

  it('rejects unsupported keys, selectors, styles, nonexistent ids and structural mistakes', async () => {
    const id = (await inspectDocument(file)).nodes[1]!.id;
    const invalid = [
      { changes: [{ id, target: 'report-title', text: 'No' }] },
      { changes: [{ target: 'lead', text: 'No', html: '<b>No</b>' }] },
      { changes: [{ target: 'lead', styles: { filter: 'blur(1px)' } }] },
      { changes: [{ target: 'lead', styles: { color: 'url(https://example.com)' } }] },
      { changes: [{ id: 'e999999', text: 'No' }] },
      { changes: [{ target: 'summary', text: 'Erase children' }] },
      { changes: [{ target: 'lead', text: 'A' }, { target: 'lead', text: 'B' }] },
      { changes: [], invented: true },
      { changes: [], operations: [{ type: 'delete', id, target: 'lead' }] },
      { changes: [], operations: [{ type: 'delete', id: 'e999999' }] },
      { changes: [], operations: [{ type: 'duplicate', id, copyId: 'c1', changes: [{ id, text: 'No', html: 'No' }] }] },
      { changes: [], operations: null },
    ];
    for (const entry of invalid) {
      await patch(entry.changes, entry);
      await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(fixture);
    }
    expect(await readdir(directory)).not.toContain('.history');
  });

  it('supports existing duplicate/delete operations and edits the copied node without full serialization', async () => {
    const nodes = (await inspectDocument(file)).nodes;
    const title = nodes.find(node => node.htmlId === 'report-title')!;
    const lead = nodes.find(node => node.htmlId === 'lead')!;
    await patch([{ id: `c1:${title.id}`, text: 'Copied & revised' }], { operations: [
      { type: 'duplicate', id: title.id, copyId: 'c1', changes: [] },
      { type: 'delete', id: lead.id },
    ] });
    const result = await applyDocument(file, { patch: patchFile, mode: 'write' });
    expect(await readFile(file, 'utf8')).toBe(fixture.replace("<h1 id='report-title'>Original &amp; title</h1>", "<h1 id='report-title'>Original &amp; title</h1><h1 id=\"report-title--c1\">Copied &amp; revised</h1>").replace('<p id="lead" style=\'color:red\'>First paragraph</p>', ''));
    expect(result).toMatchObject({ changes: 1, operations: 2 });
  });

  it('does not write an unchanged patch and refuses linked history directories', async () => {
    await patch([]);
    expect(await applyDocument(file, { patch: patchFile, mode: 'write' })).toMatchObject({ written: false, changed: false, backup: null });
    expect(await readdir(directory)).not.toContain('.history');
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'pagecraft-history-'));
    try {
      await symlink(elsewhere, path.join(directory, '.history'));
      await patch([{ target: 'lead', text: 'No' }]);
      await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toMatchObject({ code: 'INVALID_HISTORY' });
      expect(await readdir(elsewhere)).toEqual([]);
      expect(await readFile(file, 'utf8')).toBe(fixture);
    } finally { await rm(elsewhere, { recursive: true, force: true }); }
  });

  it('rejects patches over 1 MiB, invalid JSON, missing hashes and unsupported versions', async () => {
    await writeFile(patchFile, Buffer.alloc(PATCH_LIMIT + 1, 32));
    await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await writeFile(patchFile, '{bad');
    await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toMatchObject({ code: 'INVALID_JSON' });
    for (const entry of [{ version: 1, changes: [] }, { version: 2, hash: sourceHash(fixture), changes: [] }]) {
      await writeFile(patchFile, JSON.stringify(entry));
      await expect(applyDocument(file, { patch: patchFile, mode: 'write' })).rejects.toMatchObject({ code: 'INVALID_PATCH' });
    }
  });
});

describe('CLI process contract', () => {
  it('prints clean JSON on success and structured stderr plus exit 1 on errors', async () => {
    const inspected = await execute(process.execPath, ['--import', 'tsx', cli, 'inspect', file, '--query', 'report-title']);
    expect(inspected.stderr).toBe('');
    expect(JSON.parse(inspected.stdout)).toMatchObject({ version: 1, returned: 1, hash: sourceHash(fixture) });
    await patch([{ target: 'lead', text: 'Next' }]);
    const dryRun = await execute(process.execPath, ['--import', 'tsx', cli, 'apply', file, '--patch', patchFile, '--dry-run']);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({ written: false, changed: true });
    for (const args of [
      ['apply', file, '--patch', patchFile],
      ['apply', file, '--patch', patchFile, '--write', '--dry-run'],
      ['inspect', file, '--limit', '2junk'],
      ['inspect', file, '--unknown'],
      ['inspect', file, '--limit', '2', '--limit', '3'],
    ]) {
      try { await execute(process.execPath, ['--import', 'tsx', cli, ...args]); throw new Error('Expected CLI failure'); }
      catch (error) {
        const failure = error as { code: number; stdout: string; stderr: string };
        expect(failure.code).toBe(1);
        expect(failure.stdout).toBe('');
        expect(JSON.parse(failure.stderr)).toMatchObject({ version: 1, error: { code: 'INVALID_ARGUMENT' } });
      }
    }
    expect(await readFile(file, 'utf8')).toBe(fixture);
  });
});
