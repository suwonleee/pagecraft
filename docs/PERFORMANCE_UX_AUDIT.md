# Performance and UX Audit

> Historical validation of the earlier Korean interface. The public version now defaults to English with a Korean language switch. These observations and screenshots are retained as dated evidence, not claims about the current release. The original Korean sample is now at `fixtures/ko/welcome.html`.
**Pagecraft has a lightweight foundation and performs well on the small static documents measured here. It is not yet justified to describe every editing workflow, device, or document as lightweight or the UX as complete.** The next investment should remove avoidable document-wide work and correct interaction/state ambiguity. A language rewrite or another frontend framework is not indicated by the evidence.

This audit evaluates product commit `1e03f31` on September 12, 2026. The application remains unchanged. The deliverables are reproducible measurements, a heuristic UX assessment, and an ordered implementation plan. A local lab review cannot establish user satisfaction, accessibility conformance, or low-end-device performance.

## Decision by area

| Area | Assessment | Evidence and boundary |
|---|---|---|
| Download and startup footprint | Small application artifacts; distribution still needs work | 271,226 raw bytes / 80,212 calculated gzip bytes; current local HTTP delivery is uncompressed |
| Ordinary editing | Promising in the tested conditions | Sample and 2,001-node imports complete quickly; edit/undo remain localized |
| Large documents and selection | Optimize before making broad claims | 10,001-node scenario includes a 240ms parent-window long task under CPU slowdown; 1,001 selections create 1,001 outlines |
| Repeated opening | Bounded in the measured sequence | Thirty imports retain ten files and plateau in the measured page heap; structural undo and decoded images are different workloads |
| Product UX | Usable foundation with concrete gaps | Save-destination semantics, keyboard conventions, property accuracy, recovery, and narrow-screen workspace deserve targeted work |

## Measurement scope

The primary matrix contains **18 sequential runs**: three fixtures, two CPU settings, and three repetitions. Chrome 153 ran headlessly on an Apple M4 Pro, arm64 macOS, with 48GiB RAM. Each run used a fresh browser context, a temporary loopback static server, and a 1440×1000 viewport. CPU settings were normal speed and Chrome's 4× slowdown; this does not recreate an actual low-end phone, its memory, GPU, storage, or network.

The fixture set is the bundled fictional specification (33 editable nodes, 4,275 bytes), 2,000 flat paragraphs plus a container (2,001 nodes, 73,940 bytes), and 10,000 paragraphs plus a container (10,001 nodes, 377,940 bytes). These simple text documents exclude large embedded images, complex selectors, deeply nested generated markup, and script-built content. File selection is automated with a synthetic browser File; no OS picker or human decision time is measured.

Import timing starts at the file-input change and ends after metadata/UI readiness plus two animation frames. Edit and undo timings use programmatic UI events followed by two frames. They are task-completion proxies, **not field INP, physical display latency, or an end-to-end user task**. Blank-pointer timing measures the synchronous pointerdown handler path. Pan results describe one wheel dispatch per animation frame, not high-frequency trackpad bursts.

The primary run had no recorded page errors, and every downloaded fixture contained its requested text change. This audit does not replace existing source-preservation and cross-engine correctness suites. [Full measurements](research/performance-results.json), [compact summary](research/performance-summary.json), [reproduction script](research/performance-probe.mjs).

### Startup, opening, and basic editing

Values below are medians of three runs, in milliseconds. Startup is navigation-to-empty-editor readiness on localhost, excluding Chrome process launch and dependency installation. The slight variation in startup across fixture rows is repeated-run variation: the fixture has not been opened yet.

| Condition | Empty editor ready | Open sample, 33 nodes | Open 2,001 nodes | Open 10,001 nodes |
|---|---:|---:|---:|---:|
| Normal CPU | 72–78 | 56.5 | 69.8 | 133.3 |
| 4× CPU slowdown | 191–203 | 82.9 | 128.5 | 384.0 |

| Operation | Sample, normal | 2,001 nodes, normal | 10,001 nodes, normal | 10,001 nodes, 4× |
|---|---:|---:|---:|---:|
| Text change plus two frames | 32.0 | 32.4 | 32.8 | 25.3 |
| Undo plus two frames | 33.4 | 31.5 | 32.2 | 32.2 |
| Blank-canvas pointerdown, synchronous | 0.3 | 1.5 | 6.8 | 28.3 |
| Download request to browser download event | 6.0 | 16.2 | 57.2 | 75.8 |

Frame scheduling can make a throttled run's two-frame measurement numerically lower; that is not evidence that slowing the CPU improves editing. The useful finding is that ordinary one-element editing did not grow sharply with total node count in this flat corpus. The blank-click cost does grow, matching the full-document geometry scan found in source. Download time excludes the user's file-manager workflow and does not certify disk-save completion.

The largest recorded parent-window long task was **240ms** for the 10,001-node document at 4× slowdown. Parent-window observers omit some iframe/worker activity, so zero observed parent long tasks is not a guarantee of no rendering stalls. Long tasks above 50ms can delay input; Google's INP guidance also distinguishes field responsiveness from limited scripted interactions. The 200ms field INP threshold is a useful reference, not a pass/fail label for these import timings.[^1][^2]

### Transfer and idle work

| Built asset | Raw bytes | Calculated gzip bytes |
|---|---:|---:|
| Editor JavaScript | 65,949 | 22,463 |
| Worker and bundled parser | 166,632 | 47,131 |
| HTML, CSS, icon, manifest, service worker | 38,645 | 10,618 |
| Total | **271,226** | **80,212** |

The isolated first visit requested 11 resources with approximately **374,160 bytes of asset payload**, excluding HTTP headers. The service worker fetches the offline shell, including copies of some already requested files. The local server returns uncompressed responses with `Cache-Control: no-cache`; calculated gzip size is not what this server transfers. A deployed host's compression and cache behavior must be measured separately.

The editing worker is instantiated only after opening HTML: all primary runs had zero before opening and one after editing. However, its script is already downloaded during offline-shell preparation. The distinction is **lazy execution, eager offline download**. That tradeoff currently enables offline first-file editing. Changing it requires an explicit offline behavior decision, not merely a smaller reported initial byte count.

During each 1.5-second idle observation, median measured page main-thread task time was approximately **0.8–2.7ms**, depending on condition. This is encouraging evidence of little idle page work, not a whole-process CPU or battery measurement. Six primary runs recorded one late request each. A [targeted follow-up](research/performance-idle-followup.json) recorded no idle requests and did not identify those earlier paths. No polling loop was found in source, but the original late requests remain unclassified; no whole-browser network-silence claim is made.

The local `node_modules` directory occupies approximately 89.6MiB of allocated filesystem space, including development/build/test tools and excluding separately installed browser binaries. That is a developer checkout cost. People opening a deployed browser build receive its assets and do not install that toolchain. The current private distribution still makes this distinction harder for a first-time user to navigate.

### Selection and repeated use

The visible layer list remained **22 rows and the outer editor 379 DOM elements** across all three primary fixtures. The preview itself remained proportional to the input: 42, 2,008, and 10,008 elements. Sidebar virtualization is working; it does not virtualize or limit the document's own rendering cost.

An additional 4× CPU probe performed three box selections on 100 dense tiles and three on 1,000 tiles. Including their container, these produced 101 and 1,001 selections and exactly that many individual overlay nodes. Maximum observed frame gaps were approximately **36–40ms**. This is not a catastrophic freeze in the measured corpus, but it exposes a separate scaling path that sidebar virtualization does not address. High-frequency input, offscreen-heavy selections, and complex styled elements remain unmeasured.

Thirty consecutive imports of 2,001-node documents retained ten session files. After explicit garbage collection, the measured page-target JavaScript heap was approximately 3.4MiB after the first import and 3.6MiB at imports 10, 20, and 30; retained DOM-node metrics plateaued after the file cap. **No continuing growth was observed in this sequence.** It does not prove the absence of leaks in other workflows or long sessions.

Memory figures are CDP page-target JavaScript measurements. They do not include the complete browser, worker heap, native DOM allocation, decoded image/video buffers, GPU resources, or operating-system caches. Forced GC is a diagnostic aid and changes transient retention. Repeated large duplicate/delete history, near-limit backups, and image-heavy documents need separate budgets. [Selection and retention evidence](research/interaction-results.json), [reproduction script](research/interaction-probe.mjs).

## Architecture assessment

The architecture already addresses important costs: one shared source-patch engine, one on-demand worker, per-element delta history, a virtualized element list, map-based identity lookup, and frame-batched element gestures. File switching waits for a new preview to validate before abandoning the old document. Ordinary saves preserve preview identity. These are useful properties to preserve while removing unnecessary work.

The highest-value candidates are smaller than a new rendering engine:

| Candidate | Current code path | Proposed change | Evidence status |
|---|---|---|---|
| Unnecessary container text | [app.js](../public/app.js#L435), [structure.js](../public/structure.js#L77) store flattened `textContent` even when the container cannot be text-edited | Store text only for editable leaves; reuse existing leaf metadata | Code-confirmed redundancy; nested-document impact not measured |
| Blank-click geometry scan | [beginMarquee](../public/app.js#L1014) reads all rectangles before the 4px threshold | Collect candidates after a real drag starts | Code-confirmed; measured cost increases to 28.3ms at 10,001 nodes/4× |
| Large-selection UI | [setSelection](../public/app.js#L278) refreshes computed properties; [renderBox](../public/app.js#L351) creates per-element outlines | Keep exact logical selection; defer full inspector work during gestures and limit offscreen outlines | 1,001 overlay nodes observed; more complex workloads unmeasured |
| Unused export metadata | [worker response](../src/browser-worker.ts#L41) always creates nodes, diagnostics, and preview even for copy download | Add an export response containing only needed source/hash; later reuse a parse for description and preview | Code-confirmed redundant work; contribution to elapsed export time not isolated |
| Camera event bursts | [camera handlers](../public/canvas.js#L96) render per input event | Coalesce rendering per animation frame, retaining the final state and zoom anchor | Code-confirmed path; ordinary paced pan was smooth, bursts remain unmeasured |

The worker currently parses twice for description and three times for an edited document plus its new preview/description. Avoiding unused output is simpler than replacing the parser or introducing C/Wasm. Such a rewrite would not remove the frontend's geometry reads, inspector work, DOM overlays, layout, or save-state confusion.

Further work should be conditional on its own measurements. Structural undo has a 100-entry count limit but no explicit retained-subtree/byte budget; it intentionally keeps detached content for undo. Import bytes are limited, but initial node/depth complexity is not independently bounded before metadata/rendering. The iframe-height calculation resets and remeasures the document after several operations. These are bounded engineering candidates, not measured memory leaks or universal failures.

## UX assessment

The review assumes a person correcting an existing specification without routinely editing HTML code. A visual interface is clean when its current task, current selection, available actions, and save destination are clear. Few dependencies or a small bundle cannot establish those properties.

### Existing strengths

The bundled example removes the requirement to supply a personal file before trying the editor. File drop and a normal picker provide alternate paths. Opening an original and importing a copy are distinct operations; file permissions, conflict handling, cancellation, and previous-original backups are meaningful protections. The layer list supports keyboard navigation, panels have focus behavior, and edit history is separate from pan and zoom.

These strengths should be retained. A wholesale UI rewrite would spend effort recreating them and would introduce new correctness risk. The next changes should make existing behavior easier to perceive and operate.

### Findings and acceptance criteria

The [runtime observations](research/ux-results.json) confirm two defects. Focusing Sample or Help and pressing Space does not activate the button; Enter does. Selecting the sample heading shows computed font weight `650`, while the inspector displays `기본값` (default). A successful Chrome copy download also leaves the same `1개 요소 · 저장 전` state after the toast disappears. That is a feedback gap around intentional original protection, not a failed download.

These priorities address observable behavior and declared limitations; they do not constitute a complete WCAG audit or a human usability study. Native OS saving and undo across save were not exercised here. Source confirms that direct saves currently reset undo/redo, and the latest-original backup control does not identify its file/date. Preserving undo across saving requires source-ID rebasing and separate design; simply removing stack resets would be unsafe.

| Concern | User impact | Smallest useful improvement | Acceptance criterion |
|---|---|---|---|
| Keyboard convention | Global canvas shortcuts can interfere with focused native controls | Limit camera shortcuts to the relevant editing context and preserve button/summary activation | Space/Enter activate focused controls; Space-drag still pans the canvas; typing remains unaffected |
| Actual property values | Values outside a select's predefined options can appear as the default | Display the actual current value or an explicit mixed-value state without changing source | Selecting a 650-weight heading shows 650; selection alone never adds a style patch |
| Download state | A requested copy remains marked unsaved; the temporary toast does not provide durable context | Track which revision was requested for download and show its destination, retaining uncertainty about completion | User can distinguish original-file save, copy request, and newer changes; cancellation never becomes a verified save |
| Empty and narrow workspace | Empty panels and unavailable tools consume attention and editing area | Use a focused welcome state and contextual structure controls; retain discoverable panel toggles | First file action is obvious; primary save/open controls remain reachable at the tested viewports |
| Recovery and pointer alternatives | Refresh loses drafts; precise drag-only movement is difficult for some users | Bounded copy recovery plus click/tap position controls and larger handle hit regions | Reload recovery is explicit and never overwrites changed originals; movement has a non-drag single-pointer path |

### Workspace allocation

| Viewport | Visible initial controls / disabled | Loaded canvas | Initial fit |
|---|---:|---:|---:|
| 1440×1000 | 31 / 12 | 912×767.5 | 59% |
| 1280×800 | 30 / 11 | 752×567.5 | 48% |
| 390×844 | 25 / 11 | 390×492 | 25% |
| 667×375 | 25 / 11 | 667×79.5 | 42% |

The surrounding interface consumes substantial space in short windows: only 21.2% of the 667×375 viewport height remains for the canvas. On the 1280px-wide laptop view, side panels take 528px; fitting the 1440px document reduces it to 48%. A 15px paragraph then has an inferred visual scale of about 7.2px. These measurements support contextual tools, a compact short-height layout, and one-action zoom to the selected content. They do not mean every panel should always be hidden.

![The loaded editor leaves only 79.5px of canvas in a short window](research/ux-short-window.png)

The screenshot includes the temporary import toast; the measured canvas height remains 79.5px without relying on that overlay. [Desktop first run](research/ux-first-run.png) and [selected-heading properties](research/ux-properties.png) document the other observations. Control counts include visible form fields as well as buttons and measure interface density, not human cognitive load.

No horizontal overflow or page errors appeared in the four viewport checks. The [narrow inspector check](research/ux-narrow-focus.json) also passed scrolling, Escape dismissal, focus return, and restoration of canvas interactivity. Resizing a desktop viewport to 390×430 is not a physical mobile-keyboard test. The visible resize handle measured approximately 10×10px; existing width/height fields already provide an alternative way to resize.

W3C guidance supports predictable keyboard access, meaningful status announcements, and usable targets. The minimum target-size criterion includes spacing and equivalent-control exceptions. A small visible handle is therefore not, by itself, proof of a conformance failure. Likewise, a two-dimensional design canvas has different reflow constraints from its surrounding controls. Keyboard nudging is useful but does not by itself establish the single-pointer alternative described by the dragging-movements criterion.[^3][^4][^5]

The next UX evaluation should observe whether users can identify the current save destination, complete a correction, and reopen the correct result. It should also observe confusion, recovery attempts, and help requests. A clean screenshot or passing automation is insufficient evidence of ease of use. The [existing validation plan](COMPETITIVE_ANALYSIS.md#two-week-validation-plan) supplies a bounded cohort and repeat-use criteria; this audit adds the performance baseline and concrete interaction checks.

## Ordered implementation plan

The following estimates are engineering planning ranges, not commitments. They include targeted regression checks; one workday means eight engineering hours. Changes should be delivered in small patches so measured improvements can be attributed to specific work.

| Order | Work package | Estimated effort | Completion evidence |
|---|---|---|---|
| 1 | Correct keyboard scope, actual property display, and persistent copy-download status | 4–8 hours | Focused native controls work; true style values remain visible; export/original state is unambiguous without claiming download completion |
| 2 | Refine welcome/short-window hierarchy, readable selection zoom, and pointer alternatives | 6–10 hours | At least 160px canvas height at 667×375 as a proposed product target; essential controls reachable; one-action readable selection; four viewport checks |
| 3 | Remove container-text duplication; postpone marquee scans; coalesce camera updates | 4–8 hours | No all-node geometry scan below drag threshold; at most one camera render per frame plus final flush; unchanged undo, Space, IME, and source output |
| 4 | Avoid unused worker export output; reuse parse state where safe | 8–12 hours | Exact-source export with fewer parses/response bytes; unchanged preview CSP and save conflict checks; comparative timing results |
| 5 | Define recovery and retention budgets, including structural history and input complexity | 16–24 hours | Bounded recovery as a copy; quota/eviction/large-subtree tests; dense/deep input fails clearly while preserving the current draft |

Work package 5 should not be implemented as unrestricted autosave of entire documents on every input. Define debounce, byte limits, identity, eviction, explicit deletion, and quota behavior first. Recovery should never silently reacquire file-write permission. Similarly, an overlay cap should limit rendering while preserving exact selection membership and operations. Start the existing two-week target-user trial after the initial interaction/workspace improvements; do not wait for every infrastructure feature before observing users.

### Proposed performance budgets

These are initial engineering targets for a fixed benchmark environment, not claims of achieved field performance or universal limits.

| Budget | Proposed target | Validation boundary |
|---|---|---|
| Basic interaction | Scripted select/edit/undo remains below 100ms at the measured 4× profile; collect field INP later | Use meaningful UI updates and distributions, not one timer sample |
| Large-document entry | 10,001-node fixture below 500ms median; reduce parent long tasks toward 50ms | Current median already meets entry target; main-thread interruption remains the issue |
| Empty-click work | No full-document geometry reads until marquee intent | Structural assertion is more stable than a hardware-specific millisecond bound |
| Repeated use | Stabilization after declared document/history budgets; no proportional growth after eviction | Measure main heap, worker/process memory, and decoded images separately |
| Distribution | Preserve the current approximate 80KiB compressed artifact scale; require evidence for added dependencies | Network delivery, service-worker precache, installation footprint, and runtime memory stay separate metrics |

The first patch should correct interaction/state defects and eliminate cheap redundant work. A later comparison should repeat the same baseline conditions, add nested and image-heavy documents, and exercise structural undo. Only then should larger architectural changes be considered.

## Reproducing the audit

Run from the installed repository with Chrome available. These scripts create isolated browser contexts and temporary loopback servers and use only synthetic documents. They overwrite their corresponding result artifacts; run them sequentially, with other audit browser workloads closed.

```sh
npm run build:web
node --import tsx docs/research/performance-probe.mjs
node --import tsx docs/research/interaction-probe.mjs
```

`performance-results.json` records individual runs, asset hashes, navigation details, request paths, and page metrics. `performance-summary.json` is regenerated after a successful primary probe, or independently with `node docs/research/summarize-performance.mjs`. `interaction-results.json` records selection and repeated-opening measurements. Existing product tests remain separate correctness evidence; no full cross-engine suite was rerun solely for this documentation/audit change.

## References

[^1]: Google/web.dev. [Interaction to Next Paint](https://web.dev/articles/inp), updated September 2, 2025; accessed September 12, 2026. Field responsiveness thresholds and lab-measurement limits.
[^2]: Google/web.dev. [Optimize long tasks](https://web.dev/articles/optimize-long-tasks), accessed September 12, 2026. Main-thread task duration and input responsiveness.
[^3]: W3C WAI. [Understanding Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) and [Understanding Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), accessed September 12, 2026. Keyboard access and exposed status changes.
[^4]: W3C WAI. [Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [Understanding Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), accessed September 12, 2026. Target exceptions and single-pointer alternatives.
[^5]: W3C WAI. [Understanding Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), accessed September 12, 2026. Two-dimensional content and surrounding-interface constraints.
