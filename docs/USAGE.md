# Using Pagecraft

The interface starts in English. Choose **English**, **한국어**, **简体中文**, or **日本語** in the **Editor language** menu. Its accessible name and tooltip use the current language. Menus, messages, new templates, the sample, and the AI writing request follow the choice. The document itself is never translated. This guide includes Korean labels where helpful.

The preference is saved in this browser under `pagecraft-language` (`en`, `ko`, `zh-CN`, or `ja`), separately for each profile and site address. Missing or unsupported values use English. Clearing site data resets it; no server setting or account is needed.

Changing language reloads the editor and closes the current document. A dedicated confirmation appears whenever a document is open, including a saved document. **Cancel** receives focus by default and keeps the document and edits open. Save your file before confirming.

## Your first edit

1. Run `npm run build:web` and `npm run serve:web` from the installed repository, then open **http://127.0.0.1:4318**.
2. Choose **Try the sample** (샘플로 편집해 보기), drop one self-contained HTML file, or use **Import a copy** (HTML 사본 가져오기). All three edit a copy; the sample is bundled and works offline.
3. Double-click text to edit it. Select **Focus selection** (선택 확대) when the overview is too small to read. Use the save control to write to an authorized file or download the edited HTML.

There is currently no hosted app URL. The local static server supplies app files; document editing happens in your browser. Node.js is needed to build or serve locally, not by someone using a deployed browser build.

## Starting a report or pasting HTML

Open **Report** (보고서) from the top bar, or **Start with a report** (보고서로 시작) on the welcome screen. Choose a weekly report or decision brief, edit the visible placeholders, and save. Freshly created reports can be downloaded before any edit; they have no original file to overwrite. Their unsaved contents also use browser draft recovery.

Expand **Paste HTML code** (HTML 코드 붙여넣기), enter a filename and a complete HTML document, and select **Open pasted HTML**. A single outer Markdown HTML fence is accepted. Invalid filenames, incomplete HTML, and oversized input are rejected before asking to discard existing edits. Canceling replacement preserves the current document and leaves the pasted code available in the report panel.

**Ask AI to write a report** (AI에게 보고서 작성 요청하기) provides an editable-report writing request to copy into your own AI tool. If automatic clipboard access is denied, the text is selected for manual copying. Pagecraft does not call that tool or upload your report.

For a person and coding agent editing the same report, use the [human/agent handoff guide](AI_EDITING.md). Save or download the person's work before CLI inspection; reload the result after the agent writes. Uncommitted browser edits are not visible to file-based tools, and conflicts require review rather than automatic merging.

## Optional extension package

The private trial package opens the same editor from a browser toolbar button. It includes the app files, works without a local server, and is not published in an extension store.

1. Obtain and extract a prebuilt package, or build one from an installed checkout with `npm run build:extension`.
2. In Chrome, open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose `extension-dist/`, or the extracted package directory containing `manifest.json`.
4. Open Pagecraft from the extension menu or pin its icon to the toolbar. Choose your HTML inside the editor.

People loading a prebuilt package do not need Node.js. Developers building from source need `npm ci` followed by `npm run build:extension`. [Chrome's unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

The extension does not inspect the active website or add an editing overlay to other pages. It requests no host, `tabs`, `storage`, or `nativeMessaging` permissions and has no content scripts. File saving still uses browser file permission or downloads; the extension does not grant unrestricted access to your project folder.

Aside may offer equivalent extension controls, but its installation UI and native picker behavior require manual verification. Compatibility is not guaranteed solely because it uses Chromium. Packaging and offline editing passed in an isolated bundled Chromium extension profile; manual browser installation has not been verified.

## Opening files and save locations

| Mode and action | Save destination | CSS, images, and fonts |
|---|---|---|
| Browser: **Open HTML**, where supported | The chosen file after write permission is granted | Embedded assets only |
| Browser: **Import HTML** | Downloaded copy; no Save As picker | Embedded assets only |
| Local server: `npm start` | Repository's `.pagecraft/` workspace | Assets inside the workspace |
| Local server: **Import HTML** | A copy at `imports/<id>/<filename>` inside the workspace | Embedded assets only; linked files are not copied |
| Local server: pass a file or folder path | The selected HTML file itself | Assets inside the selected folder, or the file's parent folder |

Browser mode accepts one UTF-8 `.html` or `.htm` file up to 16MiB when opening or importing. The session file list retains at most 10 documents within a 32MiB total source budget. Older entries are removed as needed while the active document is kept; reopen a removed file from disk when needed. Selecting a file does not grant access to the folder around it. Use folder mode if the document references other local files:

```sh
npm start -- ./drafts
npm start -- ./document.html --port 4319
npm start -- --no-open
```

If `drafts/pages/index.html` references `../assets/style.css`, open `./drafts` as the workspace. Files outside that workspace cannot be read. Keep the local server running while using folder mode; stop it with `Ctrl+C`.

With no argument, `npm start` creates `getting-started.html` only when missing. Subsequent runs preserve your edits. Pagecraft does not change the operating system's default app for HTML files.

Dropping a file works over the editor and the document preview. It uses the same copy import as the file chooser and does not grant write permission to the dropped original. Multiple files, unsupported extensions, empty files, and files above the input limit are rejected before asking to discard changes. Canceling the discard confirmation keeps the current document and edits.

## Preview compatibility

The **Preview items to check** notice (미리보기에서 확인할 항목) appears when detected resources may not be available. Expand it for the affected categories and counts. Document scripts do not run, and external styles/images/media are blocked. Browser mode also cannot read separate local files; embed their contents in the HTML or use the local folder server for supported workspace assets.

The notice is informational: it does not remove those references from your saved HTML or fetch resources. Counts cover executable HTML script tags, stylesheet links, and `src` on `img`, `source`, `video`, and `audio`, plus video `poster`. Each attribute occurrence is counted, including repeated references. JSON script data, embedded data URLs, and fragments are excluded.

CSS `url()`/`@import`, `srcset`, SVG references, event handlers, and runtime-generated content are not analyzed. **No notice does not guarantee a complete preview.** Reopen your saved/downloaded HTML and check its appearance. Folder mode can resolve supported references within its workspace, but does not enable document scripts or external CDNs.

## Installation and offline use

Installation is optional. When your browser exposes an install prompt, Pagecraft can offer an **Install** control. Browser support and the browser's own installation menu vary; the editor remains usable in a normal tab.

After the first successful load has cached the browser app, its interface can reopen offline. This cache contains app files, not your documents. The open-file list and file permissions are session-only. Pending edits have a separate, bounded local recovery store: after reloading, use **Recover drafts** to open a copy. Save or download before closing when possible; only edits whose status reached **Temporarily stored in this browser** are recoverable. [Recovery steps and limits](#recovering-unsaved-browser-edits)

After installation, Chromium-based desktop browsers can show Pagecraft in the operating system's **Open with** menu for `.html` and `.htm` files. A file opened that way behaves like **Open HTML**: the editor asks before discarding unsaved changes, and saving writes back into that file after the browser's permission prompt. Whether the menu entry appears depends on the browser and operating system; Aside has not been verified.

Installing a web app does not grant unrestricted disk access. Direct saving depends on browser APIs, permissions, and a secure context such as HTTPS or localhost. Opening build files through `file://` is not the supported launch method. [Browser installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

The extension package already contains the app files, so its editor does not depend on an initial website cache or a running static server. It uses the same session file permissions and local draft recovery. Web-app and extension origins have separate backup and draft stores.

## Selecting and editing

| Task | Controls |
|---|---|
| Select one or more elements | Click an element; **Shift-click** to add or remove it. Also works in the element list |
| Box selection | **Drag on empty canvas**. Selects fully enclosed elements; hold Shift to add to the selection |
| Edit text or styles | Double-click text or use the properties panel. Style changes apply to all selected elements |
| Move or resize | Drag a selected element; hold Shift to constrain movement to one axis. Resize handles apply to a single selection |
| Nudge | Arrow keys move by 1px; Shift+arrow keys move by 10px |

Dragging one element in a multiple selection moves the selection together. **Drag alignment** (드래그 자동 정렬) is enabled by default: nearby edges and centers show guide lines and snap within six screen pixels. Hold **Alt/Option** to bypass it for the current drag, or turn off the toolbar toggle; the preference is remembered. Shift still constrains movement to one axis. Guides affect movement only, not resize handles, and are not included in the saved HTML. Large documents use a bounded set of nearby references, so every distant element is not an alignment target. When a parent and its descendant are selected, movement, duplication, deletion, and alignment process the parent once.

Text editing is disabled for containers with child elements. Select a text element inside instead. While typing, Space and deletion keys retain their text-editing behavior.

The properties panel shows computed values even when they are outside the built-in presets, such as **Current · 650** (현재 · 650) for font weight. **Mixed** (혼합) means the selected elements have different values. Selecting **Default** removes the editor's override and restores the document's own style.

## Duplicating, deleting, and aligning

| Task | Controls and result |
|---|---|
| Duplicate | **Duplicate** (복제) or `⌘/Ctrl+D`. Copies current text, styles, and children immediately after the source element |
| Delete | **Delete** (삭제), `Delete`, or `Backspace`. Removes the element from saved or exported HTML |
| Align | Select at least two elements, then choose left, horizontal center, right, top, vertical center, or bottom |
| Undo or redo | `⌘/Ctrl+Z` or `⌘/Ctrl+Shift+Z`. Each operation on multiple elements is one undo step |
| Cancel a gesture | Press `Esc` during a drag or box selection |

Duplicate and deletion shortcuts work when the canvas or element list has focus. Use toolbar buttons if the browser intercepts a shortcut.

Copies can be edited independently. HTML `id` values become unique, and internal links and ARIA references in the copied subtree are remapped. Ordinary elements need an explicit closing tag to be duplicated; void elements such as `<img>` do not.

Movement and alignment use CSS `translate`, preserving DOM order and Flex/Grid structure. Moving an ordinary inline text element changes its display to `inline-block`.

## Where a save goes

Saving writes the file you opened. It never produces a second copy unless you ask for
one with **사본 내려받기**.

| How the document was opened | ⌘/Ctrl+S |
|---|---|
| `npm start` with a folder or file | Writes the file, keeping a `.history` backup |
| Browser app · **HTML 파일 열기** | Writes the file through its handle, after a one-time write permission |
| Browser app · dropped onto the canvas | The same, where the browser hands over the file's handle |
| Browser app · **HTML 사본 가져오기** | Downloads an edited copy; the original is untouched |

The save button says which one applies: `원본 파일에 저장` or `HTML 내려받기`. A copy also
carries a notice above the canvas saying its save downloads a new file, with **원본
파일로 열기** next to it; the new download's `(2)` suffix is the browser avoiding a name
collision in the download folder, not a failed save. A browser without the File System
Access API only offers the copy path, and says so in the same notice.

The service worker never swaps the editor underneath an open document, so a new
version waits until every Pagecraft tab is closed. While one waits, the same notice
area says so.

### Picking up where you left off

The browser app remembers the files you opened through a handle and lists them under
**이어서 작업하기** on the welcome screen and **최근 파일** in the left panel. Only the
handle is stored, in this browser; no file content is kept. Clicking one re-asks for
permission and reopens that same file, so saving continues in place. A file that was
moved, renamed or deleted drops off the list when you try it. Files opened as a copy
are not listed, because there is no file to go back to.

## Documents the editor cannot take apart

A drawn document — an SVG mindmap, a `<canvas>` chart, an embedded frame — renders
and is preserved byte for byte, but it holds no HTML element to select. When a
document has nothing else to edit, the element panel and the notice above the canvas
both say so instead of looking broken. A drawn figure sitting beside ordinary text
needs no notice, and the text around it stays editable as usual.

Script-built content is the other case: the preview never runs document scripts, so a
page that draws itself in JavaScript arrives empty. The notice counts the scripts it
skipped, and the saved file keeps every one of them.

## Panning and zooming

| Task | Controls |
|---|---|
| Pan | **Space-drag**, hand tool `H`, middle mouse button, or ordinary wheel/trackpad scrolling |
| Return to selection | Press `V`; releasing Space restores the previous tool |
| Zoom | Bottom `− / +` controls, `⌘/Ctrl+wheel`, or trackpad pinch; 25–300%, and below 25% for a document too wide to fit at that floor |
| Reset or fit the view | `0` resets to 100%; `Shift+1` or **Fit width** (너비 맞춤) fits the workspace, and a fitted view keeps following the canvas as panels or the window resize |
| Read the selected element | **Focus selection** (선택 확대) centers the primary selected element at up to 100%, shrinking larger elements to fit within the same minimum |
| Panels and preview width | Toggle file/element and properties panels; inspect responsive layouts with the document-width menu |

### Document mode and screen mode

The preview frame is both the document's CSS viewport and the artboard the canvas
shows, and those two roles want different sizes. **Screen mode** (화면 모드), next to
the document-width menu, decides which one wins.

| | Document mode (default) | Screen mode |
|---|---|---|
| Frame size | Grows to the document's own content | Stays the selected size, e.g. 1440×900 |
| Scrolling | None; the whole page is laid out at once | The document scrolls inside the frame |
| `vh`, `dvh`, `vmin` | Resolve against the grown frame, so they are wrong | Resolve against the selected size |
| Suits | Reports, fixed-px slide decks, long pages | `100vh` decks, sticky and fixed layouts |

In document mode a page laid out wider than the selected width — a 1600px or 4K
slide deck, a wide table — widens the frame to its own content instead of clipping
the right edge. The size readout then reads `<width> px · 내용 너비`, and the zoom
floor drops below 25% so **Fit width** still reaches the whole document. There is no
maximum document width. Responsive documents keep the width you select.

Screen mode turns on by itself when the document's CSS uses a viewport-height length
(`vh`, `dvh`, `svh`, `lvh`, `vb`, `vmin`, `vmax`); the compatibility notice says so.
An ordinary wheel or trackpad scroll then scrolls the document inside the frame, and
`⌘/Ctrl+wheel` and Space-drag still zoom and pan the canvas. Your own choice of mode
holds until you open a different document.

Pan, zoom, and preview width are view settings, not HTML changes. Saving preserves the selection, view position, and zoom. In narrow windows, open panels as needed and close them with `Esc`. Search files or elements; use arrow keys, Home, and End in the element list.

Fresh laptop sessions keep the file panel collapsed to reserve canvas space; saved panel preferences take precedence. Selection actions appear as needed without moving the canvas between clicks. On narrow screens, scroll the selection-action row horizontally to reach all alignment controls. Space and Enter retain their normal activation behavior on focused editor buttons and dialogs; focus the canvas or use the hand tool to pan.

On desktop, **Focus canvas** (캔버스 집중 모드), next to the properties toggle, temporarily hides both panels. Click it again to restore their previous arrangement. This does not save a new panel preference, alter the document, or rescale your view; **Fit width** can use the extra space. Narrow screens already use full-width canvas drawers.

Duplicate, delete, and alignment controls share the bottom bar with zoom controls. Recovery feedback and temporary notifications appear below that bar, without covering the document or buttons. Long notifications are abbreviated in narrow windows; hover over one to read its complete text. Persistent operation errors remain above the canvas with their retry controls.

## Saving and recovery

The original file is never saved automatically. `⌘/Ctrl+S` and `⌘/Ctrl+Enter` invoke the current document's save action, including with Korean keyboard layouts. If Aside on macOS consumes `⌘S`, use **Control+S or the save control**.

| Situation | Behavior |
|---|---|
| Browser direct save | Requires file permission, checks for external file changes, backs up the previous original in browser storage, and writes to the authorized file |
| Browser download | **Download a copy** (사본 내려받기) exports edited HTML as a separate file; retains the unsaved indicator because the original was not updated |
| Local-server save | Writes the selected file after conflict checks and backs up the previous original in `.history/` |
| Failed or canceled save | Keeps edits; permission denial or picker cancellation does not count as a successful save |
| Another program changed the file | Refuses to overwrite the changed original; preserve your edits before reloading the file |

Imported copies use download only; there is no Save As picker. **Download a copy** is also available when a file was opened for direct saving, so its edited contents can be exported separately.

After requesting a download, the header keeps **Copy download requested** (사본 다운로드 요청됨) visible after the toast disappears. Check the browser's download list: the app cannot confirm that the browser completed the download. The original remains unchanged, edits and undo remain available, and subsequent edits display **Changed after download request** (다운로드 요청 후 변경). Canceling a drag restores the previous request status. Undo/redo conservatively counts as a later revision, even if it returns to equivalent content.

A successful direct save clears undo history against the new saved state. Editing is locked during saving. Pending drag or IME input is committed before submission. Opening or reloading another document prompts before discarding unsaved edits.

Browser backups contain the **previous original**, not unsaved edits. They use IndexedDB and retain at most **10 recent backups across documents for the app's origin**. The **Download backup** button exports the most recent original across those documents; it is not a history browser. Clearing browser site data removes those backups; different browsers and origins have separate stores. Download an original you need to keep independently.

Local-server backups are not automatically deleted. To restore one, stop the server, find the desired `.bak` file under `.history/`, and copy it to the original HTML location after keeping a separate copy of the current file.

## Recovering unsaved browser edits

1. Edit an imported or directly opened HTML file. Wait for **Temporarily stored in this browser** (이 브라우저에 임시 보관됨).
2. After reloading the app, select **Recover drafts** (임시 보관본 N개 복구), then **Restore** (복구) beside the desired name and time. During editing, the same list opens with **Recover drafts** (임시 보관본 복구).
3. Continue editing the `*.recovered.html` copy and download it to keep a file. Recovery does not retain a file handle or the previous undo history; new edits can be undone.

Drafts are local safety copies, separate from file saving and previous-original backups. They are written after approximately one second of idle editing, or after five seconds of continuous non-composing edits. Dragging and IME composition defer storage until the interaction finishes. An immediate browser/process crash before storage completes can lose the newest edits; this is not a guaranteed unload save.

The store keeps at most **5 drafts and 20 MiB of source plus edit payload** per browser origin. Each source is limited to 16 MiB and edits to 1 MiB. Oldest drafts are pruned first; quota limits can be lower. Site-data clearing removes drafts, and different browsers, deployments, and extension installations do not share them. If storage fails, use HTML download; **Retry** (다시 시도) attempts local storage again.

An explicit successful write to the original clears that document's draft. Downloads retain it because the editor cannot confirm browser download completion. Confirming discard and successfully switching documents clears the old document's draft. Restoring from the list keeps the source draft for other tabs, and the recovered copy creates its own record; both count toward the cap. Another tab's removal is detected when the app regains focus or the list refreshes. Use **Delete**, followed by **Confirm deletion** (삭제 확인), to remove an entry. Deleting the active draft leaves the open editor unchanged; the next edit resumes storage.

The folder server does not currently store unsaved recovery drafts. Its explicit saves and `.history/` backups are unchanged.

## Supported content and limits

- **Static HTML:** Preview scripts, form submissions, and external CDN resources are blocked. Original scripts, metadata, and comments outside edited ranges remain in saved files.
- **Editable content:** Text, allowed styles, duplication, and deletion of HTML elements. SVG, MathML, and form internals are not directly editable. PPTX, Figma, and draw.io files cannot be imported.
- **Duplicate appearance:** Supported ID-based styles are captured when duplicating. Responsive behavior, SVG, pseudo-elements, `transform`, background images, and unsupported style rules can differ.
- **Document structure:** Copies become following siblings. Reparenting, reordering, grouping, and new shapes are unsupported. Style changes go into HTML; external CSS files are not modified.
- **Size limits:** Browser input is limited to 16MiB, with at most 10 session documents and 32MiB retained source. The local server lists up to 200 files and limits import JSON to 5MiB and save JSON to 1MiB. Structural edits allow 500 commands, 50,000 allocated source/copied elements, and 16MiB output. JSON overhead reduces the server's effective import file limit.

Edits do not synchronize back to another tool's source planning data. A generator can overwrite edited HTML when regenerating it; keep an editing copy when needed.

## Troubleshooting

| Symptom | Check or fix |
|---|---|
| The local address does not open | Browser app: run `npm run serve:web` and use port 4318. Folder mode: keep `npm start` running and use its printed address |
| Direct file saving is unavailable | Use HTML download; native file pickers depend on browser support and permission |
| Downloads are canceled in Aside automation | This also occurs with a plain Blob download outside Pagecraft. Verify its download UI manually, or use Chrome or the local folder server; automated Aside downloads are not certified |
| CSS or images are missing | Embed assets in browser mode, or open their containing folder through the local server |
| The file is missing after reloading | Use **Recover drafts** for temporarily stored edits, or open the HTML again; file permissions are session-only |
| The port is in use in folder mode | Run `npm start -- --port 4319` |

[README](../README.md) · [Architecture](ARCHITECTURE.md)
