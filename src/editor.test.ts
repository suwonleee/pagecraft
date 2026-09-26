import { describe, expect, it, vi } from 'vitest';
import { describeDocument, describeHtml, editHtml, previewHtml, type StructuralOperation } from './editor.js';
import { browserPreviewPolicy, handleBrowserRequest } from './browser-worker.js';
import { sourceHash } from './hash.js';
import { parse } from 'parse5';

vi.mock('parse5', async importOriginal => {
  const original = await importOriginal<typeof import('parse5')>();
  return { ...original, parse: vi.fn(original.parse) };
});

describe('document compatibility diagnostics', () => {
  it('counts supported reference occurrences without changing source identities or reparsing', () => {
    const source = `<!doctype html><head>
      <link rel="alternate StyleSheet" href="https://cdn.example/a.css">
      <link rel="stylesheet" href="//cdn.example/b.css">
      <link rel="stylesheet" href="./styles.css">
      <link rel="preload" as="style" href="ignored.css">
      <script src="app.js"></script><script type="module">import './module.js';</script>
      <script type="TEXT/JAVASCRIPT">classic()</script><script type="application/x-javascript">legacy()</script>
      <script type="application/json">{"title":"Data"}</script><script type="application/ld+json">{}</script>
      <script type="text/plain">data()</script><script type="importmap">{}</script><script type="speculationrules">{}</script>
      <script type="text/javascript; charset=utf-8">notAJavaScriptType()</script>
      </head><body><p id='title'>Keep &amp; edit</p>
      <img src="https://images.example/a.png"><img src="https://images.example/a.png">
      <picture><source src="//images.example/b.webp"><img src="images/a.png"></picture>
      <video src="/movie.mp4" poster="https://images.example/poster.png"></video>
      <audio src="file:///audio.mp3"></audio><img src="blob:local-id">
      </body>`;
    const expectedNodes = describeHtml(source);
    const originalHash = sourceHash(source);
    vi.mocked(parse).mockClear();
    const result = describeDocument(source);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ nodes: expectedNodes, compatibility: { scripts: 4, externalStyles: 2, localStyles: 1, externalAssets: 4, localAssets: 4, viewportHeight: 0, drawn: 0 } });
    expect(sourceHash(source)).toBe(originalHash);
    expect(editHtml(source, [])).toBe(source);
  });

  it('ignores embedded data, fragments, foreign SVG elements and uninspected CSS or srcset', () => {
    const source = `<!doctype html><style>p { background: url(external.png) }</style>
      <link rel="stylesheet" href="data:text/css,p{}"><link rel="stylesheet" href="#embedded">
      <script type="application/ld+json">{"image":"https://example.com/a.png"}</script>
      <p style="background:url(other.png)">Self-contained</p>
      <img src=" DATA:image/png;base64,AA== " srcset="not-inspected.png 2x"><img src="#fragment"><img src=" ">
      <video poster="data:image/png;base64,AA=="></video>
      <svg><defs><path id="shape" d="M0 0"/></defs><use href="#shape"/><image href="outside.svg"/><script>svg()</script></svg>`;
    expect(describeDocument(source)).toEqual({
      nodes: describeHtml(source),
      compatibility: { scripts: 0, externalStyles: 0, localStyles: 0, externalAssets: 0, localAssets: 0, viewportHeight: 0, drawn: 1 },
    });
  });

  it('counts drawn surfaces once per outermost container', () => {
    const source = `<!doctype html><body><svg><g><rect/></g><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">안</div></foreignObject></svg>
      <canvas id="c"></canvas><p>보통 문단</p><iframe src="about:blank"></iframe>`;
    expect(describeDocument(source).compatibility.drawn).toBe(3);
    expect(describeDocument('<!doctype html><body><p>그림 없음</p>').compatibility.drawn).toBe(0);
  });

  it('counts viewport-height lengths in embedded CSS and inline styles but not in text', () => {
    const source = `<!doctype html><style>.slide{height:100vh}.tall{min-height:80dvh;max-height:50vmax}</style>
      <p style="height:calc(100vh - 40px)">화면 높이</p><p style="width:100vw">가로는 선택한 너비를 따릅니다</p>
      <p>본문에 100vh 라고 적혀 있어도 세지 않습니다</p>`;
    expect(describeDocument(source).compatibility.viewportHeight).toBe(4);
    expect(describeDocument('<!doctype html><style>.a{width:50vw}</style><p>vh</p>').compatibility.viewportHeight).toBe(0);
  });

  it('includes compatibility in worker responses while preserving hashes, bytes and preview policy', async () => {
    const source = '<!doctype html><link rel="stylesheet" href="./local.css"><p>Draft</p><img src="//cdn.example/a.png"><script type="application/json">{}</script>';
    const opened = await handleBrowserRequest({ id: 'compatibility', type: 'describe', source });
    if (!('result' in opened)) throw new Error('Description failed');
    expect(opened.result).toMatchObject({ source, hash: sourceHash(source), ...describeDocument(source) });
    expect(opened.result.preview).toBe(previewHtml(source, browserPreviewPolicy));
    const title = opened.result.nodes.find(node => node.tag === 'p')!;
    const edited = await handleBrowserRequest({ id: 'edited-compatibility', type: 'edit', source, changes: [{ id: title.id, text: 'Edited' }] });
    if (!('result' in edited)) throw new Error('Editing failed');
    const expected = source.replace('<p>Draft</p>', '<p>Edited</p>');
    expect(edited.result).toMatchObject({ source: expected, hash: sourceHash(expected), compatibility: opened.result.compatibility });
  });
});

describe('source-preserving HTML editing', () => {
  const source = `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><style>p{color:blue}</style></head>\n<body><!-- preserve -->\n<section class='box'><p id="title">원문 &amp; 문구</p><p style='color: red !important; font-size: 12px'>두 번째</p><button disabled>확인</button><img src="a.png"></section>\n<script>window.source = '<p>keep</p>';</script></body></html>\n`;

  it('preserves every byte except the selected text and style attribute', () => {
    const node = describeHtml(source).find(item => item.text === '원문 & 문구')!;
    const edited = editHtml(source, [{ id: node.id, text: '<새 문구> & "안녕"', styles: { color: '#123456' } }]);
    expect(edited).toBe(source.replace('<p id="title">원문 &amp; 문구</p>', '<p id="title" style="/*muse:color*/color: #123456 !important;/*/muse:color*/">&lt;새 문구&gt; &amp; "안녕"</p>'));
    expect(describeHtml(edited).find(item => item.tag === 'p')?.text).toBe('<새 문구> & "안녕"');
    expect(editHtml(source, [])).toBe(source);
  });

  it('replaces editor overrides and clears them back to original inline styles', () => {
    const node = describeHtml(source).find(item => item.text === '두 번째')!;
    const once = editHtml(source, [{ id: node.id, styles: { color: 'green', 'font-family': '"My Font", sans-serif' } }]);
    expect(once).toContain('color: red !important; font-size: 12px;/*muse:color*/');
    expect(once).toContain('&quot;My Font&quot;');
    const current = describeHtml(once).find(item => item.text === '두 번째')!;
    const twice = editHtml(once, [{ id: current.id, styles: { color: 'orange' } }]);
    expect(twice.match(/muse:color\*\//g)).toHaveLength(2);
    expect(twice).not.toContain('color: green');
    const restored = editHtml(twice, [{ id: describeHtml(twice).find(item => item.text === '두 번째')!.id, styles: { color: '', 'font-family': '' } }]);
    expect(restored).toContain('style="color: red !important; font-size: 12px;"');
    expect(restored).not.toContain('muse:');
  });

  it('limits selection to real source HTML and leaves non-leaf content intact', () => {
    const nodes = describeHtml('<h1>A <b>B</b></h1><div></div><svg><text>no</text></svg><form><button>no</button></form><template><p>no</p></template>');
    expect(nodes.map(node => node.tag)).toEqual(['h1', 'b', 'div']);
    expect(nodes[0]!.text).toBeNull();
    expect(nodes[1]!.parentId).toBe(nodes[0]!.id);
    expect(nodes[2]!.text).toBe('');
    expect(() => editHtml('<h1>A <b>B</b></h1>', [{ id: 'e0', text: 'erase child' }])).toThrow('text editing');
  });

  it('describes whether source tags can be duplicated before the preview is changed', () => {
    const nodes = describeHtml('<p>Implicit<p>Explicit</p><img src="x.png"><div>Unclosed');
    expect(nodes.map(node => [node.tag, node.canDuplicate])).toEqual([
      ['p', false], ['p', true], ['img', true], ['div', false],
    ]);
  });

  it('saves an element offset while preserving existing transforms, siblings and source dimensions', () => {
    const original = '<main style="width:1440px"><article id="a" style="transform:rotate(2deg);translate:10px 5px">카드</article><p>다음 요소</p></main>';
    const node = describeHtml(original).find(item => item.tag === 'article')!;
    const moved = editHtml(original, [{ id: node.id, styles: { translate: '210px -15px' } }]);
    expect(moved).toContain('style="width:1440px"');
    expect(moved).toContain('transform:rotate(2deg);translate:10px 5px');
    expect(moved).toContain('translate: 210px -15px !important');
    expect(moved).toContain('>카드</article><p>다음 요소</p></main>');
    for (const property of ['transform', 'scale']) {
      expect(() => editHtml(original, [{ id: node.id, styles: { [property]: '0.5' } }])).toThrow('Unsupported style');
    }
  });

  it('instruments only the preview and removes refresh, CSP meta, base, and disabled state', () => {
    const html = '<html><head><base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"><meta http-equiv="Content-Security-Policy" content="style-src none"></head><body><button data-muse-edit-id="fake" disabled>OK</button></body></html>';
    const preview = previewHtml(html);
    expect(preview).not.toContain('<base');
    expect(preview).not.toContain('<meta');
    expect(preview).not.toContain('disabled');
    expect(preview).not.toContain('fake');
    expect(preview.match(/data-muse-edit-id=/g)).toHaveLength(1);
    expect(editHtml(html, [])).toBe(html);
    expect(previewHtml('<img src="a.png"/>')).toContain('data-muse-edit-id="e0"/>');
  });

  it('rejects stale identities, duplicate edits and CSS injection', () => {
    const node = describeHtml(source).find(item => item.tag === 'p')!;
    for (const value of ['red; position:fixed', 'url(https://example.com)', 'red/* comment */', '</style>', 'red\\3b', 'red !important']) {
      expect(() => editHtml(source, [{ id: node.id, styles: { color: value } }])).toThrow();
    }
    expect(() => editHtml(source, [{ id: node.id, styles: { animation: 'none' } }])).toThrow();
    expect(() => editHtml(source, [{ id: 'not-found', text: 'x' }])).toThrow();
    expect(() => editHtml(source, [{ id: node.id }, { id: node.id }])).toThrow();
  });

  it('duplicates a captured subtree, preserves original bytes and saves independent later changes', () => {
    const original = `<!doctype html>\n<style>/* untouched */ .box {display:flex}</style><main>\n<!-- before --><section class='box'><p id='title'>A &amp; B</p><img src='same.png'></section>\n<!-- after --><p>Keep</p></main><script>window.keep = '<section>x</section>';</script>`;
    const nodes = describeHtml(original);
    const section = nodes.find(node => node.tag === 'section')!;
    const title = nodes.find(node => node.text === 'A & B')!;
    const edited = editHtml(original, [{ id: title.id, text: 'Original later' }, { id: `c1:${title.id}`, styles: { color: 'blue' } }], [
      { type: 'duplicate', id: section.id, copyId: 'c1', changes: [{ id: title.id, text: 'Captured <text>', styles: { color: 'red' } }] },
    ]);
    expect(edited).toBe(original.replace("<section class='box'><p id='title'>A &amp; B</p><img src='same.png'></section>", `<section class='box'><p id='title'>Original later</p><img src='same.png'></section><section class='box'><p id="title--c1" style="/*muse:color*/color: blue !important;/*/muse:color*/">Captured &lt;text&gt;</p><img src='same.png'></section>`));
    expect(edited).not.toContain('data-muse-edit-id');
  });

  it('copies current nested structure and supports copy-of-copy edits plus deleting originals and copies', () => {
    const original = '<main><section><p>A</p><p>B</p></section><footer>Keep</footer></main>';
    const nodes = describeHtml(original);
    const section = nodes.find(node => node.tag === 'section')!;
    const a = nodes.find(node => node.text === 'A')!;
    const b = nodes.find(node => node.text === 'B')!;
    const edited = editHtml(original, [{ id: `c3:c2:c1:${a.id}`, text: 'Final' }], [
      { type: 'duplicate', id: a.id, copyId: 'c1', changes: [{ id: a.id, text: 'First copy' }] },
      { type: 'delete', id: b.id },
      { type: 'duplicate', id: section.id, copyId: 'c2', changes: [{ id: `c1:${a.id}`, text: 'Snapshot' }] },
      { type: 'duplicate', id: `c2:c1:${a.id}`, copyId: 'c3', changes: [] },
      { type: 'delete', id: section.id },
      { type: 'delete', id: `c2:c1:${a.id}` },
    ]);
    expect(edited).toBe('<main><section><p>A</p><p>Final</p></section><footer>Keep</footer></main>');
  });

  it('remaps clone HTML IDs and local references, including excluded SVG/form/template descendants', () => {
    const original = `<div id="card"><label for='input' aria-labelledby="title external">Name</label><p id="title">A</p><form><input id="input" list="choices"><datalist id="choices"></datalist></form><a href="#title">Inside</a><a href="#external">Outside</a><svg><defs><clipPath id="clip"></clipPath></defs><use href="#clip" clip-path="url(#clip)" /></svg><template><p id="template">Hidden</p></template></div><p id="title--c1">Collision</p>`;
    const id = describeHtml(original)[0]!.id;
    const edited = editHtml(original, [], [{ type: 'duplicate', id, copyId: 'c1', changes: [] }]);
    const copied = edited.slice(original.indexOf('</div>') + 6, edited.lastIndexOf('<p id="title--c1">'));
    expect(copied).toContain('id="card--c1"');
    expect(copied).toContain('for="input--c1" aria-labelledby="title--c1--2 external"');
    expect(copied).toContain('id="title--c1--2"');
    expect(copied).toContain('id="input--c1" list="choices--c1"');
    expect(copied).toContain('href="#title--c1--2"');
    expect(copied).toContain('href="#external"');
    expect(copied).toContain('href="#clip--c1" clip-path="url(#clip--c1)"');
    expect(copied).toContain('id="template--c1"');
    expect(edited.slice(0, original.indexOf('</div>') + 6)).toBe(original.slice(0, original.indexOf('</div>') + 6));
  });

  it('deletes only selected source spans and retains adjacent comments and excluded source', () => {
    const original = '<main><!-- before --><section><p>Remove</p><script>inside()</script></section>\n<!-- after --><p>Keep</p><script>outside()</script></main>';
    const id = describeHtml(original).find(node => node.tag === 'section')!.id;
    expect(editHtml(original, [], [{ type: 'delete', id }])).toBe('<main><!-- before -->\n<!-- after --><p>Keep</p><script>outside()</script></main>');
  });

  it('saves 2,001 edited elements and their duplicate snapshot without the former 1,000-change limit', () => {
    const original = '<main>' + Array.from({ length: 2001 }, (_, index) => `<p>Row ${index}</p>`).join('') + '</main>';
    const [main, ...rows] = describeHtml(original);
    const changes = rows.map((node, index) => ({ id: node.id, text: `Edited ${index}` }));
    const edited = '<main>' + Array.from({ length: 2001 }, (_, index) => `<p>Edited ${index}</p>`).join('') + '</main>';
    expect(editHtml(original, changes)).toBe(edited);
    expect(editHtml(original, changes, [{ type: 'duplicate', id: main!.id, copyId: 'c1', changes }])).toBe(edited + edited);
    expect(() => editHtml(original, Array.from({ length: 10_001 }, () => changes[0]))).toThrow('10,000');
    expect(() => editHtml(original, [], [{ type: 'duplicate', id: main!.id, copyId: 'c1', changes: Array.from({ length: 10_001 }, () => changes[0]) }])).toThrow('10,000');
  });

  it('rejects stale/deleted targets, foreign snapshots, malformed operations and exponential expansion', () => {
    const original = '<section><p>A</p></section><p>B</p>';
    const [section, a, b] = describeHtml(original);
    expect(() => editHtml(original, [], {})).toThrow();
    expect(() => editHtml(original, [], [{ type: 'insert', id: section!.id, html: '<script>bad()</script>' }])).toThrow();
    expect(() => editHtml(original, [], [{ type: 'duplicate', id: section!.id, copyId: 'c1', changes: [{ id: b!.id, text: 'outside' }] }])).toThrow();
    expect(() => editHtml(original, [{ id: a!.id, text: 'deleted' }], [{ type: 'delete', id: section!.id }])).toThrow();
    expect(() => editHtml(original, [], [{ type: 'delete', id: section!.id }, { type: 'delete', id: a!.id }])).toThrow();
    expect(() => editHtml(original, [], [1, 2].map(() => ({ type: 'duplicate', id: a!.id, copyId: 'c1', changes: [] })))).toThrow();
    expect(() => editHtml(original, [], [{ type: 'duplicate', id: a!.id, copyId: 'c1', changes: [{ id: a!.id, styles: { color: 'red;display:none' } }] }])).toThrow();
    expect(() => editHtml('<div><p>Unclosed</p>', [], [{ type: 'duplicate', id: 'e0', copyId: 'c1', changes: [] }])).toThrow('closing tag');
    expect(() => editHtml('<main><table>Loose<p>Fostered</p><tr><td>Cell</td></tr></table></main>', [], [{ type: 'delete', id: 'e0' }])).toThrow('boundaries');
    const growing = '<main><section>' + 'x'.repeat(1024 * 1024) + '</section></main>';
    const main = describeHtml(growing)[0]!.id;
    const sectionId = describeHtml(growing)[1]!.id;
    const operations: StructuralOperation[] = Array.from({ length: 17 }, (_, index) => ({ type: 'duplicate', id: sectionId, copyId: `c${index}`, changes: [] }));
    expect(() => editHtml(growing, [], operations)).toThrow('16 MiB');
    expect(() => editHtml(growing, [], Array.from({ length: 501 }, () => ({ type: 'delete', id: main })))).toThrow('500');
  });
});

describe('browser worker editing protocol', () => {
  it('places the trusted policy before every untrusted source byte and preserves rendering mode', async () => {
    const sources = [
      '<!doctype html><p>Standards</p>',
      '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd"><p>Almost standards</p>',
      '<p>Quirks</p>',
      '<!--><script>globalThis.compromised=true</script><!-- --><!doctype html><p>Comment attack</p>',
      '<!doctype html PUBLIC "malformed\"><script>globalThis.compromised=true</script><p>Doctype attack</p>',
      '\uFEFF<!-- harmless --><!doctype html><meta http-equiv="Content-Security-Policy" content="script-src *"><p>Original policy</p>',
    ];
    expect(new Set(sources.map(source => parse(source).mode))).toEqual(new Set(['no-quirks', 'limited-quirks', 'quirks']));
    for (const source of sources) {
      const response = await handleBrowserRequest({ id: 1, type: 'describe', source });
      if (!('result' in response)) throw new Error('Description failed');
      const { preview } = response.result;
      const metaAt = preview.indexOf('<meta http-equiv="Content-Security-Policy"');
      const beforePolicy = preview.slice(0, metaAt);
      expect(beforePolicy === '' || beforePolicy === '<!doctype html>' || beforePolicy === '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">').toBe(true);
      expect(preview.slice(preview.indexOf('>', metaAt) + 1)).toBe(previewHtml(source));
      const document = parse(preview);
      expect(document.mode).toBe(parse(source).mode);
      const html = document.childNodes.find(node => node.nodeName === 'html');
      if (!html || !('childNodes' in html)) throw new Error('Missing HTML element');
      const head = html.childNodes.find(node => node.nodeName === 'head');
      if (!head || !('childNodes' in head)) throw new Error('Missing head element');
      const policy = head.childNodes[0];
      expect(policy?.nodeName).toBe('meta');
      if (!policy || !('attrs' in policy)) throw new Error('Missing policy element');
      expect(policy.attrs.find(attribute => attribute.name === 'content')?.value).toBe(browserPreviewPolicy);
      expect(response.result.source).toBe(source);
      expect(editHtml(source, [])).toBe(source);
    }
  });

  it('escapes trusted policy attributes without changing the policy text', () => {
    const policy = `script-src 'none'; report-to "a&b<group>"`;
    const preview = previewHtml('<p>Content</p>', policy);
    expect(preview).toContain('&quot;a&amp;b&lt;group&gt;&quot;');
    expect(preview).not.toContain('content="script-src \'none\'; report-to "');
  });

  it('describes and edits the same source with Node-compatible hashes and preview-only markers', async () => {
    const source = `<!doctype html>\n<!-- keep --><section><p id='title'>한글 😀 &amp; text</p></section><script>keep()</script>`;
    const described = await handleBrowserRequest({ id: 'open', type: 'describe', source });
    expect(described.id).toBe('open');
    expect(described).toHaveProperty('result.hash', sourceHash(source));
    if (!('result' in described)) throw new Error('Description failed');
    expect(described.result.source).toBe(source);
    expect(described.result.nodes).toEqual(describeHtml(source));
    expect(described.result.preview).toBe(previewHtml(source, browserPreviewPolicy));
    const section = described.result.nodes[0]!;
    const title = described.result.nodes[1]!;
    const changes = [{ id: `c1:${title.id}`, text: '복제 🚀 <value>' }];
    const operations = [{ type: 'duplicate', id: section.id, copyId: 'c1', changes: [] }];
    const edited = await handleBrowserRequest({ id: 2, type: 'edit', source, changes, operations });
    expect(edited.id).toBe(2);
    if (!('result' in edited)) throw new Error('Editing failed');
    const expected = editHtml(source, changes, operations);
    expect(edited.result.source).toBe(expected);
    expect(edited.result.hash).toBe(sourceHash(expected));
    expect(edited.result.nodes).toEqual(describeHtml(expected));
    expect(edited.result.preview).toContain('data-muse-edit-id');
    expect(edited.result.source).not.toContain('data-muse-edit-id');
    expect(edited.result.source).toContain('<!-- keep -->');
    expect(edited.result.source).toContain('<script>keep()</script>');
  });

  it('returns request-correlated errors without relaxing engine validation', async () => {
    for (const value of [null, {}, { id: 1, type: 'unknown', source: '<p>A</p>' }, { id: 2, type: 'describe', source: 12 }]) {
      expect(await handleBrowserRequest(value)).toHaveProperty('error.status', 400);
    }
    const failed = await handleBrowserRequest({ id: 'invalid-style', type: 'edit', source: '<p>A</p>', changes: [{ id: 'e0', styles: { color: 'red;display:none' } }] });
    expect(failed).toMatchObject({ id: 'invalid-style', error: { status: 400 } });
    expect(await handleBrowserRequest({ id: 3, type: 'edit', source: '<p>A</p>' })).toHaveProperty('error.status', 400);
  });

  it('limits source and edited output by UTF-8 bytes instead of character count', async () => {
    const oversized = '가'.repeat(Math.floor(16 * 1024 * 1024 / 3) + 1);
    expect(oversized.length).toBeLessThan(16 * 1024 * 1024);
    expect(await handleBrowserRequest({ id: 1, type: 'describe', source: oversized })).toHaveProperty('error.status', 413);
    expect(await handleBrowserRequest({ id: 2, type: 'edit', source: '<p>A</p>', changes: [{ id: 'e0', text: oversized }] })).toHaveProperty('error.status', 413);
  });
});
