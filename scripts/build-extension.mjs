import './build-web.mjs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const destination = new URL('extension-dist/', root);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await mkdir(destination, { recursive: true });
// The extension opens the same local file editor in its own tab. No page injection.
const assets = ['index.html', 'app.js', 'browser-worker.js', 'styles.css', 'manifest.webmanifest', 'icon.svg'];
for (const asset of assets) await copyFile(new URL(`web-dist/${asset}`, root), new URL(asset, destination));
await mkdir(new URL('reports/', destination), { recursive: true });
for (const locale of ['ko', 'zh-CN', 'ja']) await mkdir(new URL(`reports/${locale}/`, destination), { recursive: true });
for (const name of ['', 'ko/', 'zh-CN/', 'ja/'].flatMap(prefix => ['weekly-report.html', 'decision-brief.html'].map(file => prefix + file))) await copyFile(new URL(`web-dist/reports/${name}`, root), new URL(`reports/${name}`, destination));
await writeFile(new URL('manifest.json', destination), JSON.stringify({
  manifest_version: 3,
  name: 'Pagecraft',
  version,
  description: 'Open HTML. Edit visually. Save the file. Works locally without a server.',
  action: { default_title: 'Open Pagecraft' },
  background: { service_worker: 'background.js' },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none';" },
}, null, 2) + '\n');
await writeFile(new URL('background.js', destination), `// Open the editor only when its toolbar action is clicked.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
`);
console.log('Extension: extension-dist/ (Manifest V3, no host access or page injection).');
