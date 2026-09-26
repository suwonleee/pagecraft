import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request, type Server } from 'node:http';
import { createHtmlEditorServer, type HtmlDocument } from './server.js';

describe('local HTML editor API', () => {
  let root: string;
  let server: Server;
  let origin: string;
  const source = '<!doctype html>\n<html><head><meta charset="utf-8"></head><body><h1>Original</h1><script>window.keep = true;</script></body></html>\n';
  const getDocument = async (file = 'plan.html') => (await (await fetch(`${origin}/api/document?file=${encodeURIComponent(file)}`)).json()) as HtmlDocument;
  const post = (route: string, body: unknown, extraHeaders: Record<string, string> = {}) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-html-test-'));
    await writeFile(path.join(root, 'plan.html'), source);
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', '두 번째.htm'), '<p>Nested</p>');
    server = createHtmlEditorServer({ root });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });

  it('lists files, previews safely, patches source, and backs up the exact original', async () => {
    const list = await (await fetch(`${origin}/api/files`)).json() as { files: { file: string; name: string }[] };
    expect(list.files.map((file: { file: string }) => file.file)).toEqual(['nested/두 번째.htm', 'plan.html']);
    const document = await getDocument();
    const preview = await fetch(`${origin}${document.previewUrl}`);
    expect(preview.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(preview.headers.get('content-security-policy')).toContain("form-action 'none'");
    expect(await preview.text()).toContain('data-muse-edit-id=');
    const result = await post('/api/save', { file: 'plan.html', hash: document.hash, changes: [{ id: document.nodes[0]!.id, text: 'Edited & saved', styles: { color: 'red' } }] });
    expect(result.status).toBe(200);
    const saved = await result.json() as HtmlDocument & { backup: string };
    expect(saved.hash).not.toBe(document.hash);
    expect(await readFile(path.join(root, saved.backup), 'utf8')).toBe(source);
    const updated = await readFile(path.join(root, 'plan.html'), 'utf8');
    expect(updated).toContain('Edited &amp; saved');
    expect(updated).toContain('<script>window.keep = true;</script>');
    expect(updated).not.toContain('data-muse-edit-id');
    expect((await getDocument()).nodes[0]!.text).toBe('Edited & saved');
    expect((await (await fetch(`${origin}/api/files`)).json() as { files: unknown[] }).files).toHaveLength(2);
  });

  it('preserves an externally modified file and serializes simultaneous saves', async () => {
    const document = await getDocument();
    await writeFile(path.join(root, 'plan.html'), source.replace('Original', 'External'));
    const conflict = await post('/api/save', { file: 'plan.html', hash: document.hash, changes: [{ id: document.nodes[0]!.id, text: 'Wrong' }] });
    expect(conflict.status).toBe(409);
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toContain('External');
    const current = await getDocument();
    const requests = await Promise.all(['A', 'B'].map(text => post('/api/save', { file: 'plan.html', hash: current.hash, changes: [{ id: current.nodes[0]!.id, text }] })));
    expect(requests.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await readdir(path.join(root, '.history'))).toHaveLength(1);
  });

  it('blocks traversal, symlink escapes, and non-preview assets', async () => {
    expect((await fetch(`${origin}/api/document?file=../outside.html`)).status).toBe(400);
    expect((await fetch(`${origin}/api/document?file=${encodeURIComponent('/etc/passwd')}`)).status).toBe(400);
    await symlink(path.join(root, '..'), path.join(root, 'escape'));
    expect((await fetch(`${origin}/api/document?file=escape/${path.basename(root)}/plan.html`)).status).toBe(200);
    await symlink('/etc/passwd', path.join(root, 'escape.html'));
    expect((await fetch(`${origin}/api/document?file=escape.html`)).status).toBe(403);
    await writeFile(path.join(root, 'secret.json'), '{"token":"no"}');
    expect((await fetch(`${origin}/preview/secret.json`)).status).toBe(403);
    await writeFile(path.join(root, 'nested', 'site.css'), 'body { color: blue; }');
    expect(await (await fetch(`${origin}/preview/nested/site.css`)).text()).toBe('body { color: blue; }');
  });

  it('rejects outside origins, hostile hosts, non-JSON saves, and linked backup folders', async () => {
    expect((await post('/api/save', {}, { origin: 'https://attacker.example' })).status).toBe(403);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${origin}/api/files`, { headers: { host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject);
      req.end();
    });
    expect(hostileHostStatus).toBe(403);
    expect((await fetch(`${origin}/api/save`, { method: 'POST', body: '{}' })).status).toBe(415);
    await symlink(tmpdir(), path.join(root, '.history'));
    const document = await getDocument();
    expect((await post('/api/save', { file: 'plan.html', hash: document.hash, changes: [] })).status).toBe(403);
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toBe(source);
  });

  it('imports a new copy and refuses path names and linked import destinations', async () => {
    const result = await post('/api/import', { name: '기획.html', html: '<h1>가져오기</h1>' });
    expect(result.status).toBe(201);
    const document = await result.json() as HtmlDocument;
    expect(document.file).toMatch(/^imports\/[a-f0-9-]+\/기획.html$/);
    expect(await readFile(path.join(root, document.file), 'utf8')).toBe('<h1>가져오기</h1>');
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toBe(source);
    expect((await post('/api/import', { name: '../escape.html', html: '<p>x</p>' })).status).toBe(400);
    expect((await post('/api/import', { name: 'escape.js', html: '<p>x</p>' })).status).toBe(400);
    await rm(path.join(root, 'imports'), { recursive: true });
    await symlink(tmpdir(), path.join(root, 'imports'));
    expect((await post('/api/import', { name: 'plan.html', html: '<p>x</p>' })).status).toBe(403);
  });

  it('enforces the save request size limit without touching the document', async () => {
    const result = await post('/api/save', { file: 'plan.html', hash: 'unused', changes: [], extra: 'x'.repeat(1024 * 1024) });
    expect(result.status).toBe(413);
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toBe(source);
  });

  it('atomically saves clone/delete operations, rebases IDs, and allows a subsequent structural save', async () => {
    const document = await getDocument();
    const id = document.nodes[0]!.id;
    const response = await post('/api/save', { file: 'plan.html', hash: document.hash, changes: [{ id: `c1:${id}`, text: 'Copy' }], operations: [{ type: 'duplicate', id, copyId: 'c1', changes: [] }, { type: 'delete', id }] });
    expect(response.status).toBe(200);
    const saved = await response.json() as HtmlDocument & { backup: string };
    expect(saved.nodes.map(node => node.text)).toEqual(['Copy']);
    expect(saved.nodes[0]!.id).toMatch(/^e\d+$/);
    expect(await readFile(path.join(root, saved.backup), 'utf8')).toBe(source);
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toBe(source.replace('Original', 'Copy'));
    const next = await post('/api/save', { file: 'plan.html', hash: saved.hash, changes: [], operations: [{ type: 'delete', id: saved.nodes[0]!.id }] });
    expect(next.status).toBe(200);
    expect((await next.json() as HtmlDocument).nodes).toEqual([]);
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toBe(source.replace('<h1>Original</h1>', ''));
  });

  it('does not write or create backups for invalid structural operations', async () => {
    const document = await getDocument();
    const id = document.nodes[0]!.id;
    const result = await post('/api/save', { file: 'plan.html', hash: document.hash, changes: [], operations: [{ type: 'delete', id }, { type: 'duplicate', id, copyId: 'c1', changes: [] }] });
    expect(result.status).toBe(400);
    expect(await readFile(path.join(root, 'plan.html'), 'utf8')).toBe(source);
    expect(await readdir(root)).not.toContain('.history');
  });
});
