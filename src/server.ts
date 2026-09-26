import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, realpath, mkdir, writeFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describeDocument, editHtml, previewHtml, EditorError } from './editor.js';
import { sourceHash } from './hash.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const htmlExtensions = new Set(['.html', '.htm']);
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const inside = (root: string, target: string) => target === root || target.startsWith(`${root}${path.sep}`);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unknown error";

function validateRelative(file: unknown): string {
  if (typeof file !== 'string' || !file || file.includes('\0') || file.includes('\\') || path.isAbsolute(file) || file.split('/').some(part => part === '..' || part === '.')) throw new EditorError(400, "A relative file path inside the project is required.");
  return file;
}

async function resolveFile(root: string, file: unknown): Promise<string> {
  const relative = validateRelative(file);
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) throw new EditorError(403, "Files outside the project cannot be opened.");
  let actual: string;
  try { actual = await realpath(candidate); } catch { throw new EditorError(404, "File not found."); }
  if (!inside(root, actual)) throw new EditorError(403, "Links pointing outside the project cannot be opened.");
  return actual;
}

function validateHtml(file: string) {
  if (!htmlExtensions.has(path.extname(file).toLowerCase())) throw new EditorError(400, "Only HTML files can be edited.");
}

function documentInfo(file: string, source: string) {
  return { file, name: path.basename(file), hash: sourceHash(source), ...describeDocument(source), previewUrl: `/preview/${file.split('/').map(encodeURIComponent).join('/')}?v=${sourceHash(source)}` };
}
export type HtmlDocument = ReturnType<typeof documentInfo>;

async function jsonBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new EditorError(415, "An application/json request is required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new EditorError(413, "The file or edits are too large.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch { throw new EditorError(400, "Invalid JSON request."); }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function validateRequest(request: IncomingMessage) {
  const host = request.headers.host;
  if (!host) throw new EditorError(403, "Only local addresses are allowed.");
  let address: URL;
  try { address = new URL(`http://${host}`); } catch { throw new EditorError(403, "Invalid local address."); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.username || address.password || address.pathname !== '/' || Number(address.port || '80') !== request.socket.localPort) throw new EditorError(403, "Only local addresses are allowed.");
  if (request.headers.origin && request.headers.origin !== address.origin) throw new EditorError(403, "Requests from other sites are not allowed.");
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new EditorError(403, "Requests from other sites are not allowed.");
  return address;
}

async function safeDirectory(root: string, relative: string) {
  const directory = path.join(root, relative);
  // Verify an existing parent before creation, so a linked imports/.history cannot write outside root.
  const parts = relative.split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const actual = await realpath(current);
    if (!inside(root, actual)) throw new EditorError(403, "The save folder points outside the project.");
  }
  return directory;
}

export function createHtmlEditorServer({ root: suppliedRoot }: { root: string }) {
  const rootPromise = realpath(path.resolve(suppliedRoot));
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => undefined);
    return next;
  };

  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const address = validateRequest(request);
      const url = new URL(request.url ?? '/', address);
      const root = await rootPromise;
      if (request.method === 'GET' && url.pathname === '/api/files') {
        const files: { file: string; name: string }[] = [];
        const walk = async (relative: string) => {
          const entries = await readdir(path.join(root, relative), { withFileTypes: true });
          entries.sort((a, b) => a.name.localeCompare(b.name));
          for (const entry of entries) {
            if (files.length >= 200) return;
            if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
            const file = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile() && htmlExtensions.has(path.extname(file).toLowerCase())) files.push({ file, name: entry.name });
          }
        };
        await walk('');
        return json(response, 200, { files });
      }
      if (request.method === 'GET' && url.pathname === '/api/document') {
        const file = validateRelative(url.searchParams.get('file'));
        validateHtml(file);
        const actual = await resolveFile(root, file);
        return json(response, 200, documentInfo(file, await readFile(actual, 'utf8')));
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        const body = await jsonBody(request, 5 * 1024 * 1024);
        const result = await mutate(async () => {
          if (typeof body.name !== 'string' || path.basename(body.name) !== body.name || body.name.includes('\\') || body.name.includes('\0') || typeof body.html !== 'string' || !body.html.trim()) throw new EditorError(400, "An HTML filename and content are required.");
          validateHtml(body.name);
          const relative = `imports/${randomUUID()}`;
          const directory = await safeDirectory(root, relative);
          const file = `${relative}/${body.name}`;
          await writeFile(path.join(directory, body.name), body.html, { encoding: 'utf8', flag: 'wx' });
          return documentInfo(file, body.html);
        });
        return json(response, 201, result);
      }
      if (request.method === 'POST' && url.pathname === '/api/save') {
        const body = await jsonBody(request, 1024 * 1024);
        const result = await mutate(async () => {
          const file = validateRelative(body.file);
          validateHtml(file);
          const actual = await resolveFile(root, file);
          const source = await readFile(actual, 'utf8');
          const originalMode = (await stat(actual)).mode;
          if (typeof body.hash !== 'string' || sourceHash(source) !== body.hash) throw new EditorError(409, "Another program changed the file. Nothing was saved. Reopen it to see the latest content.");
          const updated = editHtml(source, body.changes, body.operations);
          const history = await safeDirectory(root, '.history');
          const backupName = `${path.basename(file)}.${new Date().toISOString().replaceAll(':', '-')}.${randomUUID()}.bak`;
          const temporary = path.join(path.dirname(actual), `.muse-${randomUUID()}.tmp`);
          if (sourceHash(await readFile(actual, 'utf8')) !== body.hash) throw new EditorError(409, "The original changed just before saving. Reopen the document.");
          await writeFile(path.join(history, backupName), source, { encoding: 'utf8', flag: 'wx' });
          try {
            await writeFile(temporary, updated, { encoding: 'utf8', flag: 'wx', mode: originalMode });
            if (sourceHash(await readFile(actual, 'utf8')) !== body.hash) throw new EditorError(409, "The original changed just before saving. Reopen the document.");
            await rename(temporary, actual);
          } catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
          }
          return { ...documentInfo(file, updated), backup: `.history/${backupName}` };
        });
        return json(response, 200, result);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/preview/')) {
        let file: string;
        try { file = decodeURIComponent(url.pathname.slice('/preview/'.length)); } catch { throw new EditorError(400, "Invalid file path encoding."); }
        const actual = await resolveFile(root, file);
        const extension = path.extname(file).toLowerCase();
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin");
        if (htmlExtensions.has(extension)) {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          return response.end(previewHtml(await readFile(actual, 'utf8')));
        }
        if (!mimeTypes[extension]) throw new EditorError(403, "This file type is not supported in previews.");
        response.setHeader('Content-Type', mimeTypes[extension]);
        return response.end(await readFile(actual));
      }
      if (request.method === 'GET' && ['/reports/weekly-report.html', '/reports/decision-brief.html', '/reports/ko/weekly-report.html', '/reports/ko/decision-brief.html'].includes(url.pathname)) {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return response.end(await readFile(new URL(`../fixtures${url.pathname}`, import.meta.url), 'utf8'));
      }
      if (request.method === 'GET' && ['/', '/index.html', '/app.js', '/i18n.js', '/locales-ko.js', '/canvas.js', '/snapping.js', '/layers.js', '/workspace.js', '/document-api.js', '/structure.js', '/report-start.js', '/styles.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
        return response.end(await readFile(path.join(publicRoot, file)));
      }
      throw new EditorError(404, "The requested address was not found.");
    } catch (error) {
      const status = error instanceof EditorError ? error.status : 500;
      if (!response.headersSent) json(response, status, { error: status === 500 ? "Could not process the local file." : errorMessage(error) });
      else response.end();
    }
  });
}
