# Localization and terminology

Pagecraft uses familiar design vocabulary with short explanations of the visible result. Prefer a term a reader can connect to the canvas over a literal translation of a CSS property. Keep the underlying CSS name where it helps experienced users distinguish layout methods.

## Choosing words

- Use one term consistently across labels, tooltips, accessible names, errors, and recovery messages. In Korean, browser recovery data is **임시 보관본**, not a mix of that term and **초안**.
- Explain spacing concretely: between items, inside the border, or outside the border. Pair compact labels with localized help.
- Describe layout direction as horizontal or vertical using the selected element's writing mode. A CSS row follows the text direction, so vertical writing swaps the labels. Mixed writing modes use text-relative row and column names. Describe alignment by its visible effect; CSS `justify-content` and `align-items` need more explanation than “main axis” and “cross axis.”
- Keep **Elements** for HTML elements. They are not Photoshop layers, and Pagecraft's CSS block, flex, and grid controls are not identical to Figma auto layout.
- Use each language's own name in the language selector. Translate **Editor language**, its tooltip, and its accessible name into the current UI language; do not use country flags to represent languages.

## Reference terms

These are Pagecraft labels, not a claim that another application's labels or behavior match exactly. The English UI uses the source message keys in `public/index.html` and `public/app.js`; translations live in `public/locales-*.js`.

| English | 한국어 | 日本語 | 简体中文 |
|---|---|---|---|
| Editor language | 편집기 언어 | エディターの言語 | 编辑器语言 |
| Font size | 글꼴 크기 | フォントサイズ | 字号 |
| Font weight | 글꼴 굵기 | 文字の太さ | 字体粗细 |
| Line height | 줄 간격 | 行間 | 行距 |
| Corner radius | 모서리 반지름 | 角丸の半径 | 圆角半径 |
| Gap | 요소 간격 | 要素間の間隔 | 元素间距 |
| Padding | 안쪽 여백 | 内側の余白 | 内边距 |
| Margin | 바깥 여백 | 外側の余白 | 外边距 |
| Horizontal (row) | 가로 (행) | 横方向（行） | 横向（行） |
| Vertical (column) | 세로 (열) | 縦方向（列） | 纵向（列） |

Figma's [auto layout guide](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout) describes direction, alignment, gap, and padding. It informs the distinction between space inside a container and space between items; it does not establish equivalence with CSS layout.

Adobe's Photoshop spacing guides provide local typography references: [Korean](https://helpx.adobe.com/kr/photoshop/using/line-character-spacing.html), [Japanese](https://helpx.adobe.com/jp/photoshop/using/line-character-spacing.html), and [Simplified Chinese](https://helpx.adobe.com/cn/photoshop/using/line-character-spacing.html). Pagecraft favors short, understandable spacing labels over specialized print typography terminology. Its line-height control still edits CSS `line-height`, not Photoshop's text engine.

## Language changes

The top-right language control stays separate from document actions. It shows a small globe and the current language name, including on narrow screens. The localized **Editor language** tooltip and accessible name explain the control without adding a permanent label. The menu lists **English**, **한국어**, **简体中文**, and **日本語**. Its setting is remembered locally per browser profile and site address. The choice affects the editor, new templates, the sample, and the AI writing request, never the contents of an existing document.

Changing language reloads the editor. Whenever a document is open, including a saved document, show a dedicated confirmation explaining that the document will close and must be saved or downloaded first. Focus **Cancel** by default. Cancelling keeps the current language, document, and edits. When edits are unsaved, the confirmation action explicitly names discarding them.

Keep the selector width and confirmation action columns stable across languages. Reserve enough dialog height for translated text, allow button labels to wrap, and allow scrolling in short viewports or with enlarged text instead of clipping the content.

## Review limits

Official product documentation is a terminology reference, not evidence that first-time users understand Pagecraft. Automated checks cover dictionary completeness and interaction behavior; they do not replace native-speaker review or usability sessions. Check new terms with speakers of each language before claiming that translations have been validated by users.
