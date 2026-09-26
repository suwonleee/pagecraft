import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
export function createStaticServer({ root }: { root: string }) {
  const rootPromise = realpath(root);
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(405).end(); return; }
      const url = new URL(request.url || '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const base = await rootPromise;
      const resolved = path.resolve(base, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!resolved.startsWith(`${base}${path.sep}`) || pathname.includes('\\') || pathname.includes('\0')) { response.writeHead(403).end(); return; }
      const actual = await realpath(resolved);
      if (!actual.startsWith(`${base}${path.sep}`)) { response.writeHead(403).end(); return; }
      const type = types[path.extname(actual)];
      if (!type) { response.writeHead(404).end(); return; }
      const contents = await readFile(actual);
      response.setHeader('Content-Type', type);
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch { response.writeHead(404).end('Not found'); }
  });
}
