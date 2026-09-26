import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const destination = new URL('web-dist/', root);
await mkdir(destination, { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: { app: 'public/app.js', 'browser-worker': 'src/browser-worker.ts' },
  outdir: fileURLToPath(destination), bundle: true, format: 'esm', platform: 'browser',
  target: ['chrome109', 'firefox115', 'safari17'], minify: true,
  loader: { '.html': 'text' },
  legalComments: 'eof',
});
const html = (await readFile(new URL('public/index.html', root), 'utf8')).replace('<title>', '<meta name="pagecraft-storage" content="browser">\n  <meta name="theme-color" content="#5b50bd">\n  <link rel="manifest" href="./manifest.webmanifest">\n  <link rel="icon" href="./icon.svg" type="image/svg+xml">\n  <title>');
await writeFile(new URL('index.html', destination), html);
await writeFile(new URL('styles.css', destination), await readFile(new URL('public/styles.css', root)));
const reportFiles = ['', 'ko/', 'zh-CN/', 'ja/'].flatMap(prefix => ['weekly-report.html', 'decision-brief.html'].map(file => prefix + file));
await mkdir(new URL('reports/', destination), { recursive: true });
for (const locale of ['ko', 'zh-CN', 'ja']) await mkdir(new URL(`reports/${locale}/`, destination), { recursive: true });
for (const name of reportFiles) await writeFile(new URL(`reports/${name}`, destination), await readFile(new URL(`fixtures/reports/${name}`, root)));
// The installed app uses the shell's paper mark and accent without raster assets.
await writeFile(new URL('icon.svg', destination), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#5b50bd"/><g fill="none" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l3 3v13H7z"/><path d="M14 4v3h3M9.5 11.5h5M9.5 15.5h3"/></g></svg>');
await writeFile(new URL('manifest.webmanifest', destination), JSON.stringify({
  id: './', name: 'Pagecraft', short_name: 'Pagecraft', description: 'Open HTML. Edit visually. Save the file.',
  lang: 'en', start_url: './', scope: './', display: 'standalone', background_color: '#f2f3f5', theme_color: '#5b50bd',
  icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  // Installed app: the OS "Open with" menu can hand an HTML file straight to the editor.
  file_handlers: [{ action: './', accept: { 'text/html': ['.html', '.htm'] } }],
}, null, 2));
const shell = ['index.html', 'app.js', 'browser-worker.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', ...reportFiles.map(name => `reports/${name}`)];
const fingerprint = createHash('sha256');
for (const file of shell) fingerprint.update(await readFile(new URL(file, destination)));
const revision = fingerprint.digest('hex').slice(0, 16);
await writeFile(new URL('sw.js', destination), `// Cache only the app shell. User HTML and file handles never enter this cache.
const ROOT = new URL('./', self.location);
const PREFIX = 'pagecraft-shell-' + encodeURIComponent(ROOT.pathname) + '-';
const CACHE = PREFIX + '${revision}';
const SHELL = ${JSON.stringify(shell)}.map(file => new URL(file, ROOT).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
// Do not skipWaiting: an open editor must finish using one coherent application version.
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const key = url.origin === ROOT.origin && url.pathname === ROOT.pathname ? new URL('index.html', ROOT).href : url.href;
  if (!SHELL.includes(key)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(key)) || fetch(event.request)));
});
`);
let bytes = 0, compressed = 0;
for (const file of [...shell, 'sw.js']) { const data = await readFile(new URL(file, destination)); bytes += data.length; compressed += gzipSync(data).length; }
console.log(`Browser app: ${bytes.toLocaleString()} bytes (${compressed.toLocaleString()} gzip), worker loaded only when opening HTML. Output: web-dist/`);
