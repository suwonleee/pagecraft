# Architecture

Pagecraft shares one visual editor and one source-preserving HTML engine across two execution modes. **Browser mode** edits individual files locally, either through a static web app or its optional bundled extension. **Folder mode** runs a loopback HTTP server to read assets and save documents within a project folder. File access changes between modes; canvas editing behavior remains shared.

## Code map

| Location | Responsibility |
|---|---|
| `src/editor.ts` | Source locations, editable-element discovery, text/style patches, and structural changes |
| `src/browser-worker.ts` | Browser execution of the shared editing engine in a dedicated worker |
| `src/main.ts`, `src/server.ts`, `src/hash.ts` | Folder workspace, loopback API, file writes, and server hashing |
| `public/` | Document coordination, file access, canvas, virtualized layers, workspace panels, and structure editing |
| `scripts/`, `fixtures/`, `src/*.test.ts`, `e2e/` | Builds, local serving, synthetic documents, and automated checks |

## Report entry points and agent commands

`public/report-start.js` adds a small native dialog for two report starters, pasted HTML, and a copyable provider-independent writing request. Templates are separate static assets loaded into the editor only when chosen. The service worker precaches these trusted bundled templates for offline use; it still does not cache user documents. The extension includes the same assets. Folder mode serves only the two exact template routes. Both modes import through the existing document adapter; created browser documents are download-ready and recoverable without a synthetic text edit.

`src/document-cli.ts` and `src/document-commands.ts` expose bounded JSON inspection and source patches to coding agents. They use the shared engine and SHA-256 hashes, without a browser, server, provider SDK, or extra runtime dependency. `EditableNode.htmlId` exposes authored stable IDs; CLI output bounds/paginates text while edits still use validated source locations. The CLI code and schema are not included in the browser bundle. [Full contract](AI_EDITING.md)

## Distribution and browser capabilities

| Option | UX purpose | Limits |
|---|---|---|
| Static browser app | Open an address and edit a self-contained HTML file | Direct disk saves require supported APIs and permission; download is the fallback |
| Optional installed PWA | Launch the same app from a desktop or home-screen icon | Installation varies by browser and OS; it does not add universal filesystem access |
| Local folder server | Work on HTML with linked project assets and local backups | Requires Node.js and a running local process |
| Optional Manifest V3 extension | Open a bundled copy of the same editor from a toolbar button | Private unpacked package; installation and native picker behavior depend on the browser |

The browser web app remains the default distribution for reaching different browsers. `npm run build:web` produces `web-dist/`, which uses only relative paths and can be served by any static host under any path; open it with a trailing slash. It cannot be opened through `file://`, because browsers block ES modules and workers from a `null` origin. The `Release` workflow attaches `pagecraft-web` and `pagecraft-extension` archives to a GitHub release for each `v*` tag, and the `Pages` workflow deploys `web-dist/` to GitHub Pages once the repository is public (a private repository on the free plan cannot use Pages). The public browser app is hosted at [suwonleee.github.io/pagecraft](https://suwonleee.github.io/pagecraft/). There is no extension-store release. A protected HTTPS deployment removes Git and Node setup for end users; access control belongs at the host. Do not expose the folder server as a public editing service.

The browser adapter detects capabilities rather than selecting behavior from a browser name. File System Access pickers require a secure context and user interaction. They are not available in every browser; file inputs and downloads provide a useful fallback, but cannot reproduce in-place saving. Pagecraft uses a file handle obtained at opening for direct writes; imported copies download without a Save As picker. [Chrome file access guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

A manifest supports optional installation. An install button appears only when the browser provides an install prompt. Browser and OS behavior vary. The manifest declares `file_handlers` for `.html` and `.htm`: after installation, Chromium-based desktop browsers can offer the app in the operating system's Open With menu and deliver the chosen file's handle through `window.launchQueue`, which the app routes into the same handle-based open path as the picker, so saves return to that file. The consumer is registered only where direct opening is available; Firefox and Safari ignore the declaration. Real OS launches are verified manually; the automated test supplies the queue. [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [File Handling API](https://developer.chrome.com/docs/capabilities/web-apis/file-handling)

`npm run build:extension` packages the same static app and worker under `extension-dist/` with a Manifest V3 launcher. The toolbar action opens the extension's own editor tab. It does not capture the active website and has no content scripts, host permissions, or `tabs`, `storage`, or `nativeMessaging` permissions. IndexedDB backups use the ordinary browser API; no extension storage permission is needed. A prebuilt package can be extracted and loaded in developer mode without Node.js or a local server.

This package does not include dedicated Chrome/Aside editing engines or a native filesystem bridge. Direct file access retains the shared browser adapter's permission checks and download fallback. A future native bridge would require a registered native messaging host; simply granting an extension access to `file://` URLs would not provide arbitrary project-file writes. [Extension permissions](https://developer.chrome.com/docs/extensions/mv3/declare_permissions), [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

Chrome supports loading unpacked extensions in developer mode. Aside installation controls and native picker behavior still need manual verification; sharing the Chromium engine does not establish compatibility. [Chrome unpacked-extension setup](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

## Document and view state

A document holds its last saved source, unsaved per-element patches, and duplicate/delete operations. Selection is a set of element IDs. DOM elements and metadata are indexed in Maps. Pan, zoom, and panel preferences remain separate from document changes and undo history.

The editing engine marks preview elements with IDs derived from source positions. Successful direct saves can change those positions, so the client reconnects its current DOM to the returned IDs. Normal saves retain the iframe and view. The preview reloads only if the returned structure does not match the expected document.

File switching commits after the new preview loads successfully. Failures retain the current document and unsaved changes. Saving locks editing and commits an active drag or IME composition before submission.

`describeDocument()` returns editable nodes and limited HTML-reference diagnostics in the same parse traversal. The API and worker return these counts with document metadata. The UI updates the notice on opening or accepting a saved document, not on pointer movement. The browser sample is bundled as text; file drops in the parent or preview use the shared copy-import path, which validates files before requesting draft discard.

Browser documents and file handles are session-only. The session list retains at most 10 documents within a 32MiB source budget; older entries are evicted while the active document remains. Unsaved browser edits have a separate bounded IndexedDB recovery store. Reloading offers recovery as a new downloadable copy; it does not recreate a native file handle or the old undo history. There is no persistent recent-file list for clean documents. Browser backups remain a separate store of previous originals.

### Unsaved draft recovery

`public/draft-recovery.js` coordinates browser-only safety copies through `public/draft-store.js`. It observes document identity, edit revision, dirty state, and busy interactions. One-second debounce and a five-second maximum delay avoid per-keystroke persistence; active gestures and IME composition defer writes. There is no polling interval. A monotonic generation distinguishes canceled/reused editor revisions, and a serial queue orders writes and deletions. Errors leave editing and download available.

IndexedDB `pagecraft-drafts` version 1 separates immutable sources, validated edit records, and list metadata. Matching source hashes reuse the stored source without encoding or writing it again. Listing and pruning read metadata only. Transactions atomically write and prune to at most 5 records and 20 MiB of source plus edits; individual limits are 16 MiB source and 1 MiB edits. These are payload limits, excluding IndexedDB overhead. Recovery reparses through the existing worker and source-patching engine; it never serializes the preview DOM or executes source scripts.

`restoreDraft()` creates a new adapter document without a handle, named `*.recovered.html`. The source draft remains available to other tabs, subject to normal pruning; the recovered document gets a separate record. File switching removes the previous draft only after preview commit. A successful native save clears its draft, while download retains it. Visibility/focus events flush or refresh opportunistically; they do not guarantee persistence during process termination. Explicit deletion suppresses recreation until another edit. Focus/list refresh detects records pruned by other tabs without background polling. [Recovery contract](USAGE.md#recovering-unsaved-browser-edits)

### Drag alignment

`public/snapping.js` captures target geometry after the drag threshold, then calculates edge/center adjustments numerically within six screen CSS pixels at the current zoom. It reads at most 200 stationary target rectangles and visits at most 800 candidate nodes, starting near the selected elements and their ancestors. Moving-selection bounds add work proportional to selection size. References are refreshed on the next drag; at most two guide elements render outside the preview. Alt/Option bypasses snapping, Shift restricts its axis, and a local preference disables it. Resize handles remain unsnapped. This bounds reference work without promising exhaustive alignment targets in very large or nested documents.

## Save contract

The shared engine uses `parse5` source locations to patch only affected ranges. Text changes replace the relevant text range; style changes append managed overrides; structural changes reuse untouched source slices. Deletion removes a subtree including noneditable descendants. This preserves formatting outside edited ranges without serializing the full preview DOM.

The internal `data-muse-edit-id` and `/*muse:...*/` markers remain for compatibility with previously edited files. They do not require another project's packages or runtime. Preview-only markers are not added to saved source.

### Browser files

1. Opening reads the chosen HTML, records a SHA-256 source hash, and obtains editable-element metadata from the worker.
2. Direct saving requires a writable file handle and compares the current disk contents against the saved source hash.
3. The engine applies validated edits; the previous original is stored in IndexedDB before replacement.
4. A file write counts as successful after the writable stream closes. The editor then adopts the new source state and clears undo history.
5. Cancelled opening pickers, denied permission, write failures, and conflicts keep unsaved edits. Download exports a copy and retains the dirty state; it is also available for documents with a writable file handle.

Browser backups retain at most 10 recent originals across documents for the app's origin. An IndexedDB cursor prunes older entries without loading every stored backup into memory. They remain until pruned or browser site data is cleared, and can be downloaded. They are not backups of pending edits and are not synchronized across browsers.

Native file opening and write permission requests must happen within user activation. Do not defer them until after a long asynchronous transformation. Downloading can provide a file even without native save support, but cannot prove that the original was updated. [File access and write completion](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

### Local folder files

The server validates the submitted source hash and editing operations, backs up the previous source under the workspace's `.history/`, then replaces the original through a temporary file in the same directory. It rechecks the source hash immediately before replacement and returns the saved metadata and backup path. Imports and saves are serialized within the server.

Both modes detect external changes with hash checks. These checks do not lock files against other programs. [User-facing recovery behavior](USAGE.md#saving-and-recovery)

## Resource use

- **One worker, loaded on demand:** Browser parsing and source patching use one dedicated worker. Folder mode runs the same engine on the server. No worker is created per element or pointer event.
- **Delta history:** Up to 100 operations store before/after values for affected elements; structural history retains required subtrees. Large repeated duplications can still increase memory use.
- **Updates per animation frame:** Element drag and camera pointer/wheel events are combined using `requestAnimationFrame`, with geometry reads separated from writes. Camera coordinates use the last rendered iframe scale while pending zoom input accumulates. Selection overlays share the transformed artboard, so camera movement does not remeasure selected elements. Actual document edits and layout changes still refresh geometry. Box selection computes element bounds once after the drag threshold, so a blank click does not measure the document.
- **Bounded list rendering:** The element list is virtualized, search data is cached, and events are delegated. Maps support element lookup and updates target affected nodes.
- **Shared source ranges:** Structural changes share original source slices and join the final output once. Duplication avoids adding styles already preserved through inheritance.

The compiled server has one direct runtime dependency, `parse5`. The static build bundles the editing engine for the worker; no browser CDN dependency, frontend framework, or WASM module is required. Build and test tools are development dependencies.

TypeScript removes types before execution; it does not make rendering faster by itself. Resource use depends on DOM work, layouts, copying, and loaded assets. Virtualizing the layer list does not bound the full iframe DOM or image memory. [Document limits](USAGE.md#supported-content-and-limits)

Worker execution is lazy, while its script is included in the service worker’s initial offline precache.

## Privacy, isolation, and offline behavior

Browser mode processes the chosen HTML on the device. It does not upload document contents to an editing server. The static host supplies application assets. Browser mode supports self-contained UTF-8 HTML input up to 16MiB, matching the engine's output limit so saved files can be reopened. Choosing one file does not authorize reading its sibling CSS, images, or fonts.

The local folder server binds to `127.0.0.1`, validates requested and resolved paths against the workspace, rejects path and symbolic-link escapes, and checks Host and Origin headers. Supported assets must reside inside the workspace.

Both previews use iframe sandboxing and CSP to block scripts, form submission, and external requests. Browser mode permits parent-installed event handlers in the iframe because WebKit suppresses them without `allow-scripts`. The trusted worker places a restrictive `script-src 'none'` policy before every untrusted source byte, using a canonical doctype that preserves rendering mode. This ordering is essential and covered by malformed-comment, doctype, nested-frame, and script regression tests. Folder mode retains its stricter sandbox and HTTP preview policy. Pagecraft preserves original scripts in saved HTML; it is not a script-removal or sanitization tool.

The web app's service worker caches app assets for offline launch after a successful first load. It does not cache documents, preview responses, or folder API data. Offline availability does not retain native file handles or keep a stopped folder server running. Users can recover persisted drafts as copies or reopen HTML after reload. Updates and caches must remain scoped to the app's deployment path. [Service Worker lifecycle and caching](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

The extension bundles these assets for offline use without relying on the web app's caching service worker. Its Manifest V3 background launcher and dedicated editing worker have separate purposes; packaging does not add another editor engine. Browser data remains scoped to its origin, so extension and hosted-app backups are separate.

## Tests and builds

```sh
npm run check
npm run test:e2e
npm run test:browser
npm run build
npm run build:web
npm run serve:web
```

To package the optional extension:

```sh
npm run build:extension
npm run test:extension
```

`check` runs TypeScript, browser JavaScript syntax, unit, and API checks. The local-server browser suite uses Chrome by default. `CI=true` selects Playwright Chromium; `PAGECRAFT_ASIDE_PATH` adds the suite in an installed Aside executable:

```sh
PAGECRAFT_ASIDE_PATH='/Applications/Aside.app/Contents/MacOS/Aside' npm run test:e2e
```

`npm run test:browser` builds the static app and runs `playwright.browser.config.ts`. Chromium, Firefox, and WebKit automation establish behavior in those test engines. They do not certify actual Safari, every Chromium derivative, iOS, Windows, or mobile touch UX. Native file-picker dialogs and shortcuts consumed by browser UI need separate manual checks.

Native-save tests use real OPFS handles with a test picker, not operating-system dialogs. Firefox and WebKit skip unsupported native-file scenarios. See the repository’s CI results for the current test matrix.

Regression coverage should preserve source and style behavior, permission/cancellation outcomes, external-change conflicts, backup and download semantics, preview isolation, and offline reload. Existing folder tests cover source preservation, backups, path validation, selection, dragging, IME input, failure recovery, and narrow-window layouts. Performance checks use DOM bounds and mutation/request counts instead of fragile absolute timing limits.

Server build output goes to `dist/`, static output to `web-dist/`, and the extension package to `extension-dist/`. Generated builds, workspace files and backups, dependencies, and test results are excluded from Git. npm publishing is disabled by `private: true`.

[README](../README.md) · [Usage](USAGE.md)

## Interface languages

The shell defaults to English. `public/i18n.js` selects the locally stored `en`, `ko`, `zh-CN`, or `ja` preference once at startup, with English as the default for absent or unsupported values. `public/locales-ko.js`, `public/locales-zh-CN.js`, and `public/locales-ja.js` hold complete message dictionaries. Recovery timestamps use the selected locale. Static shell text is translated once before editor initialization, and dynamic messages use literal or tagged-template `t` calls. Placeholder values are substituted as text, never HTML. No mutation observer or per-frame translation runs, and the document iframe is never translated. Server and CLI errors are English; the browser translates known error messages at its API boundary.

Changing language uses the existing unsaved-edit confirmation before reloading. English templates live in `fixtures/` and `fixtures/reports/`; translated samples and reports use `ko/`, `zh-CN/`, and `ja/` subdirectories. All four report languages are included in the offline shell and optional extension. The locale selects only newly opened built-in content; imported HTML remains unchanged. Local folder mode serves the same locale dictionaries and report files. CLI output remains English.
