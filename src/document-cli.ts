import { applyDocument, inspectDocument, commandError, DocumentCommandError, type ApplyOptions } from './document-commands.js';

const help = `Pagecraft document CLI — edit the same UTF-8 HTML used by the visual editor.

Usage:
  npm run --silent document -- inspect report.html [--limit 50] [--offset 0] [--query text]
  npm run --silent document -- apply report.html --patch edits.json --dry-run
  npm run --silent document -- apply report.html --patch edits.json --output reviewed.html
  npm run --silent document -- apply report.html --patch edits.json --write

inspect returns JSON with a SHA-256 hash, bounded node text and editable style names.
apply requires patch version 1, that hash, a changes array, and exactly one output mode.
Changes use {"target":"stable-html-id","text":"New text"} or an inspected "id".
Optional operations use the visual editor's duplicate/delete format and inspected ids.
--dry-run validates without writing. --output never overwrites. --write creates a
backup in .history beside the original, checks its hash again, then replaces it.
Source limit: 16 MiB. Patch limit: 1 MiB. Inspection: 50 nodes by default, 200 maximum.
Commands print versioned JSON; failures print JSON to stderr and exit with code 1.
The CLI does not run HTML scripts, contact an AI provider, or start a web server.
`;

async function main(args: string[]) {
  if (args.length === 0 || args.length === 1 && ['--help', '-h', 'help'].includes(args[0]!)) {
    process.stdout.write(help);
    return;
  }
  const [command, file, ...rest] = args;
  if (!['inspect', 'apply'].includes(command!) || !file || file.startsWith('--')) throw new DocumentCommandError('INVALID_ARGUMENT', 'Use inspect <file.html> or apply <file.html>. See --help.');
  const allowed = command === 'inspect' ? ['--limit', '--offset', '--query'] : ['--patch', '--dry-run', '--write', '--output'];
  const options = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index]!;
    if (!allowed.includes(name) || options.has(name)) throw new DocumentCommandError('INVALID_ARGUMENT', `Unknown or repeated option "${name}".`);
    if (name === '--dry-run' || name === '--write') options.set(name, true);
    else {
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new DocumentCommandError('INVALID_ARGUMENT', `${name} requires a value.`);
      options.set(name, value);
    }
  }
  let result: unknown;
  if (command === 'inspect') {
    const integer = (name: string) => {
      const value = options.get(name);
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new DocumentCommandError('INVALID_ARGUMENT', `${name} requires an integer.`);
      return Number(value);
    };
    result = await inspectDocument(file, { limit: integer('--limit'), offset: integer('--offset'), query: options.get('--query') as string | undefined });
  } else {
    const patch = options.get('--patch');
    if (typeof patch !== 'string' || ['--dry-run', '--write', '--output'].filter(name => options.has(name)).length !== 1) throw new DocumentCommandError('INVALID_ARGUMENT', 'apply requires --patch and exactly one of --dry-run, --write or --output.');
    const mode: ApplyOptions = options.has('--output') ? { patch, mode: 'output', output: options.get('--output') as string }
      : { patch, mode: options.has('--write') ? 'write' : 'dry-run' };
    result = await applyDocument(file, mode);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${JSON.stringify({ version: 1, error: commandError(error) })}\n`);
  process.exitCode = 1;
});
