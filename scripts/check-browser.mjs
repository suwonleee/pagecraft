import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const folder = new URL('../public/', import.meta.url);
const files = (await readdir(folder)).filter((file) => file.endsWith('.js'));
for (const file of files) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(file, folder))], { stdio: 'inherit' });
console.log(`Browser JavaScript: ${files.length} files checked`);
