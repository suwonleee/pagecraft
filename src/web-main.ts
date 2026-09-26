import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createStaticServer } from './static-server.js';

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--port')) throw new Error('Usage: npm run serve:web -- [--port 4318]');
const port = args[0] === '--port' ? Number(args[1]) : 4318;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
const root = fileURLToPath(new URL('../web-dist/', import.meta.url));
try { await stat(new URL('../web-dist/index.html', import.meta.url)); }
catch { throw new Error('Build the browser app first: npm run build:web'); }
const server = createStaticServer({ root });
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Run npm run serve:web -- --port 4319` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  console.log(`Pagecraft browser app: http://127.0.0.1:${address.port}/\nFiles are processed in the browser. Stop the preview server with Ctrl+C.`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); server.closeAllConnections(); });
