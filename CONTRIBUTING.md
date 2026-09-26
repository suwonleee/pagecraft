# Contributing to Pagecraft

Use English for commit messages, pull request titles and descriptions, issues, and primary repository documentation. Keep localized README guides in `readmes/`. The editor defaults to English and offers Korean, Simplified Chinese, and Japanese. Put dynamic UI messages through `t` in `public/i18n.js` and add their equivalents to all three `public/locales-*.js` dictionaries. Keep the static shell and all four report template languages consistent. Never translate user document contents.

## Local checks

```sh
npm ci
npm run check
npm run test:e2e
npm run build
```

Browser tests use Chrome locally and Chromium in CI. To include an installed Aside browser:

```sh
PAGECRAFT_ASIDE_PATH='/Applications/Aside.app/Contents/MacOS/Aside' npm run test:e2e
```

Tests must use temporary documents and isolated browser profiles. Keep personal HTML files, backups, credentials, and generated test artifacts out of commits.

## Commit messages

Use the same commit format as llmwiki: an English Conventional Commit subject, no more than 72 characters, imperative, without a trailing period. Leave one blank line before the body. Use one factual bullet per change, with an exact `path:symbol` and line number as it stands at commit time. Include a verification bullet with commands and counts; write `verification: none` if nothing was run.

```text
fix(editor): preserve unsaved edits when cancelling a language change

- keep the current document when the user cancels the language switch
  - `public/app.js:allowDiscard` (L821): confirm before reloading the editor
- verification: npm run check, 45 tests passed; browser journey, 3 tests passed
  - `e2e/english-ui.spec.ts:language choice persists` (L65): exercise cancellation
```

Line numbers above illustrate the format; cite the actual lines in your change. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`. Scope is optional. Keep each commit on one topic. Use the human author's identity; do not add co-author, generated-by, model, or tool attribution trailers.

## Implementation guidelines

- Preserve untouched HTML source and keep saves conflict-aware and backed up.
- Keep document edits separate from canvas zoom, panning, and panel preferences.
- Update only affected elements, batch layout reads and writes, and keep the layer list virtualized.
- Add dependencies only when their value justifies their runtime and maintenance cost.
- Describe behavior changes and relevant test results in pull requests. Document remaining limitations.

## License

Pagecraft is licensed under the [MIT License](LICENSE). Contributions are accepted under the same terms.

## Translations

Keep the root README in English, with Korean, Simplified Chinese, and Japanese guides in `readmes/`. Update the matching sections when behavior changes. UI translations live in `public/locales-*.js`; preserve all message keys and numbered interpolation placeholders. New built-in samples and reports must keep the original IDs, CSS, and print rules. Never translate imported user documents. Run the localization browser tests and dictionary checks when changing language behavior.
