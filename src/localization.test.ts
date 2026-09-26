import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

const locales = ['ko', 'zh-CN', 'ja'];
const dictionaries: Record<string, Record<string, string>> = {};
for (const locale of locales) {
  const url = new URL(`../public/locales-${locale}.js`, import.meta.url).href;
  dictionaries[locale] = (await import(/* @vite-ignore */ url)).messages;
}
const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();

function ids(source: string) {
  const result: string[] = [];
  function visit(node: DefaultTreeAdapterTypes.Node) {
    for (const attr of ('attrs' in node ? node.attrs : [])) if (attr.name === 'id') result.push(attr.value);
    for (const child of ('childNodes' in node ? node.childNodes : [])) visit(child);
  }
  visit(parse(source));
  return result;
}

describe('localization assets', () => {
  for (const locale of locales) {
    it(`${locale} covers messages without losing interpolation placeholders`, () => {
      const messages = dictionaries[locale]!;
      expect(Object.keys(messages).sort()).toEqual(Object.keys(dictionaries.ko!).sort());
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), key).not.toBe('');
        expect(value, key).not.toContain('PROMPT');
        expect(placeholders(value), key).toEqual(placeholders(key));
      }
    });
    for (const file of ['welcome.html', 'reports/weekly-report.html', 'reports/decision-brief.html']) {
      it(`${locale}/${file} preserves source IDs, styles, and print rules`, async () => {
        const translated = file.replace(/([^/]+)$/, `${locale}/$1`);
        const original = await readFile(new URL(`../fixtures/${file}`, import.meta.url), 'utf8');
        const source = await readFile(new URL(`../fixtures/${translated}`, import.meta.url), 'utf8');
        expect(source).toContain(`lang="${locale}"`);
        expect(ids(source)).toEqual(ids(original));
        // Korean originals predate the English typeface; compare the new translations exactly.
        if (locale !== 'ko') expect(source.match(/<style>[\s\S]*?<\/style>/)?.[0]).toBe(original.match(/<style>[\s\S]*?<\/style>/)?.[0]);
      });
    }
  }
});

const translatorSource = (await readFile(new URL('../public/i18n.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/export /g, '');
for (const locale of ['en', ...locales]) {
  it(`${locale} substitutes values once and returns unknown messages unchanged`, () => {
    const { t, language } = runInNewContext(`${translatorSource}\n({ t, language })`, {
      korean: dictionaries.ko, chinese: dictionaries['zh-CN'], japanese: dictionaries.ja,
      localStorage: { getItem: () => locale },
    }) as { t: (message: string | readonly string[], ...values: unknown[]) => string; language: string };
    expect(language).toBe(locale);
    expect(t('constructor')).toBe('constructor');
    expect(t('An unknown error')).toBe('An unknown error');
    expect(t`Recover ${'<b>Keep {0}</b>'}`).toBe(
      (dictionaries[locale]?.['Recover {0}'] ?? 'Recover {0}').replace('{0}', '<b>Keep {0}</b>'),
    );
  });
}
