/**
 * Synthetic source-serialization probe, not an end-to-end UI or market benchmark.
 * Run: node --import tsx docs/research/roundtrip-probe.mjs
 * Requires installed Pagecraft dev dependencies and a local Chrome installation.
 * Visits the public competitor demo with a fresh isolated browser context.
 * Only synthetic fixtures are sent to that page; no user documents are loaded.
 */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeHtml, editHtml } from '../../src/editor.ts';

const competitorUrl = 'https://html.mncoleman.com/';
const referenceCommit = '9d43d6e94af8aef6743e3fe44783f22ef2d661ee';
const referenceRawBase = `https://raw.githubusercontent.com/mncoleman/html-editor/${referenceCommit}/`;
const outputUrl = new URL('./roundtrip-results.json', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const baseSource = key => `<!doctype html>\n<html lang='en'>\n<head><meta charset='utf-8'><title>Probe &copy; 2026</title></head>\n<body data-probe='${key}'>\n  <p id='first' data-tone=calm>Alpha text</p>\n  <!-- Preserve this comment and the mixed quoting below. -->\n  <aside data-note='two words' title="Keep me">Keep &mdash; middle &copy; text</aside>\n  <p id='last' class='ending'>Omega text</p>\n</body>\n</html>\n`;
const fixtures = [
  { id: 'no-op', description: 'Open and serialize without edits.', source: baseSource('no-op'), edits: [] },
  { id: 'single-text-edit', description: 'Change one leaf text while preserving surrounding source.', source: baseSource('single-text-edit'), edits: [{ selector: '#first', tag: 'p', before: 'Alpha text', after: 'Updated alpha' }] },
  { id: 'distant-text-edits', description: 'Change two separated leaf texts with untouched comments, mixed quotes and entities between them.', source: baseSource('distant-text-edits'), edits: [{ selector: '#first', tag: 'p', before: 'Alpha text', after: 'Updated alpha' }, { selector: '#last', tag: 'p', before: 'Omega text', after: 'Updated omega' }] },
  { id: 'implicit-table-body', description: 'Change one table cell where the input omits the optional tbody element.', source: "<!doctype html>\n<html lang='en'>\n<head><title>Table probe</title></head>\n<body data-probe='implicit-table-body'>\n<table id='table'>\n  <tr><td id='cell' data-role=main>Cell alpha</td><td title='keep'>Keep &copy;</td></tr>\n</table>\n</body>\n</html>\n", edits: [{ selector: '#cell', tag: 'td', before: 'Cell alpha', after: 'Updated cell' }] },
];

function expectedOutput(fixture) {
  let output = fixture.source;
  for (const edit of fixture.edits) {
    if (output.split(edit.before).length !== 2) throw new Error(`Ambiguous expected replacement: ${fixture.id}`);
    output = output.replace(edit.before, edit.after);
  }
  return output;
}
function assess(actual, expected) {
  let firstDifference = 0;
  while (firstDifference < actual.length && firstDifference < expected.length && actual[firstDifference] === expected[firstDifference]) firstDifference++;
  return {
    exactExpectedSource: actual === expected,
    actualUtf8Bytes: Buffer.byteLength(actual),
    expectedUtf8Bytes: Buffer.byteLength(expected),
    firstDifferenceCharacterOffset: actual === expected ? null : firstDifference,
    actual,
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const result = {
  observedAtUtc: new Date().toISOString(),
  kind: 'synthetic-serializer-probe',
  browser: browser.version(),
  competitor: { url: competitorUrl, referenceCommit, referenceRepository: 'https://github.com/mncoleman/html-editor', scriptHashes: [] },
  pagecraft: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }).trim(),
    editorSourceSha256: sha256(await readFile(new URL('../../src/editor.ts', import.meta.url))),
    implementation: 'Current working-tree src/editor.ts, direct describeHtml/editHtml API calls.',
  },
  methodology: {
    competitorImport: 'FileOps.importFile(new File([source], filename)); wait for its canvas document to load.',
    competitorEdits: 'Set each specified DOM leaf textContent, call EditorState.setDirty(true), then FileOps.currentHtml(). No editing UI or OS file save is exercised.',
    pagecraftEdits: 'Resolve the same element using describeHtml(), then pass the same text replacements to editHtml().',
    assertions: 'Exact equality with original input plus only the specified text replacements; also compare normalized DOM trees to distinguish source formatting changes from semantic tree changes.',
    fixtureSelection: 'Four declared synthetic cases: no-op, one leaf edit, two separated edits, implicit tbody. Every declared case is recorded; no retries or selection of favorable output.',
    limitations: [
      'This is not an install, user-experience, full UI, performance, security, or operating-system save benchmark.',
      'The competitor is a live deployment; recorded script hashes establish which relevant scripts match the pinned source, not the provenance of the entire deployment.',
      'Pagecraft uses the current local working-tree editor implementation; the source hash is recorded because work may be uncommitted.',
      'Four fixtures cannot establish general compatibility, superiority, adoption or market demand.',
      'Different execution environments are intentional: each product serializer receives equivalent content edits through its supported internal model. Timings and memory are not compared.',
    ],
  },
  fixtures: [],
  pageErrors,
};
try {
  await page.goto(competitorUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => window.FileOps?.importFile && window.FileOps?.currentHtml && window.EditorState?.state);
  for (const path of ['js/file.js', 'js/state.js', 'js/canvas.js', 'js/mode-switch.js']) {
    try {
      const deployed = await context.request.get(new URL(path, competitorUrl).href);
      const reference = await context.request.get(referenceRawBase + path);
      const deployedBody = await deployed.body();
      const referenceBody = await reference.body();
      result.competitor.scriptHashes.push({ path, deployedStatus: deployed.status(), referenceStatus: reference.status(), deployedSha256: sha256(deployedBody), referenceSha256: sha256(referenceBody), matchesReferenceCommit: deployed.ok() && reference.ok() && deployedBody.equals(referenceBody) });
    } catch (error) { result.competitor.scriptHashes.push({ path, error: String(error) }); }
  }
  for (const fixture of fixtures) {
    const expected = expectedOutput(fixture);
    const record = { id: fixture.id, description: fixture.description, source: fixture.source, edits: fixture.edits, expected };
    try {
      const nodes = describeHtml(fixture.source);
      const changes = fixture.edits.map(edit => {
        const node = nodes.find(node => node.label.split(' · ')[0] === edit.tag + edit.selector);
        if (!node || node.text !== edit.before) throw new Error(`Pagecraft target mismatch: ${edit.selector}`);
        return { id: node.id, text: edit.after };
      });
      record.pagecraft = assess(editHtml(fixture.source, changes), expected);
    } catch (error) { record.pagecraft = { error: String(error) }; }
    try {
      await page.evaluate(async fixture => {
        window.EditorState.setDirty(false);
        await window.FileOps.importFile(new File([fixture.source], fixture.id + '.html', { type: 'text/html' }));
      }, fixture);
      await page.waitForFunction(id => window.EditorState.state.doc?.body?.dataset.probe === id, fixture.id);
      const actual = await page.evaluate(fixture => {
        const { state } = window.EditorState;
        if (state.mode !== 'visual') throw new Error(`Expected visual mode, received ${state.mode}`);
        if (state.sourceHtml !== fixture.source) throw new Error('Imported source differs before editing');
        for (const edit of fixture.edits) {
          const target = state.doc.querySelector(edit.selector);
          if (!target || target.textContent !== edit.before) throw new Error(`Competitor target mismatch: ${edit.selector}`);
          target.textContent = edit.after;
        }
        if (fixture.edits.length) window.EditorState.setDirty(true);
        return window.FileOps.currentHtml();
      }, fixture);
      record.competitor = assess(actual, expected);
    } catch (error) { record.competitor = { error: String(error) }; }
    for (const key of ['pagecraft', 'competitor']) {
      if (typeof record[key]?.actual !== 'string') continue;
      const semantic = await page.evaluate(({ actual, expected, edits }) => {
        const parser = new DOMParser();
        const actualDoc = parser.parseFromString(actual, 'text/html');
        const expectedDoc = parser.parseFromString(expected, 'text/html');
        return {
          normalizedDomMatchesExpected: actualDoc.documentElement.outerHTML === expectedDoc.documentElement.outerHTML,
          intendedTextsMatch: edits.every(edit => actualDoc.querySelector(edit.selector)?.textContent === edit.after),
        };
      }, { actual: record[key].actual, expected, edits: fixture.edits });
      Object.assign(record[key], semantic);
    }
    result.fixtures.push(record);
  }
} catch (error) {
  result.error = String(error);
} finally {
  await context.close();
  await browser.close();
  result.completedAtUtc = new Date().toISOString();
  await writeFile(outputUrl, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ output: fileURLToPath(outputUrl), error: result.error, scriptsMatchPinnedCommit: result.competitor.scriptHashes.map(({ path, matchesReferenceCommit }) => ({ path, matchesReferenceCommit })), fixtures: result.fixtures.map(({ id, pagecraft, competitor }) => ({ id, pagecraft: { exactSource: pagecraft.exactExpectedSource, semanticDom: pagecraft.normalizedDomMatchesExpected, error: pagecraft.error }, competitor: { exactSource: competitor.exactExpectedSource, semanticDom: competitor.normalizedDomMatchesExpected, error: competitor.error } })) }, null, 2));
