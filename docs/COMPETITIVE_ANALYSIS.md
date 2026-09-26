# Pagecraft Competitive Analysis

> Historical validation of the earlier Korean interface. The public version now defaults to English with a Korean language switch. These observations and screenshots are retained as dated evidence, not claims about the current release. The original Korean sample is now at `fixtures/ko/welcome.html`.
Pagecraft has a credible opportunity as a finishing tool for existing HTML specifications, mockups, and generated reports. It does not yet have evidence of a large market, repeat adoption, or willingness to pay. The recommended investment is a bounded usability and document-fidelity trial, supported by a simpler first-use experience. Building a general replacement for Figma, PowerPoint, or established website builders would expand the scope before the core job has been validated.

The proposed promise is: **open the HTML you already have, make a small visual correction, and return an ordinary HTML file with unrelated source preserved.** Source preservation is valuable, but competing implementations already exist. The competitive advantage must come from a demonstrably easier and more dependable complete workflow, including opening, understanding limitations, saving, and reopening.

## Scope and evidence

The snapshot is current to **September 12, 2026**. Nine public GitHub projects cover three relevant groups: direct editors of existing HTML, established visual builders that can ingest HTML, and adjacent browser/code editing tools. Pinegrow is included separately as a commercial substitute. Figma, PowerPoint, screenshot annotation, code editing, and asking an AI for another revision are competing behaviors; they are not treated as equivalent HTML-file editors.

Repository metadata, pinned source, official documentation, public discussions, and a small synthetic serialization probe support the comparisons. Documentation establishes advertised behavior; source establishes an implementation path; neither alone establishes a successful real-user task. The probe has deliberately narrow coverage. No representative user study, cross-product performance benchmark, payment experiment, or market-size dataset is available.

The [repository snapshot](research/repository-snapshot.json) records reviewed commit identifiers and dates. Stars and forks indicate attention and contribution potential, not active users. Package and installer downloads can include automated or repeat downloads. These metrics are not comparable to hosted-product usage and cannot establish revenue or retention.[^1]

## Competitive landscape

### Closest workflow competitors

| Project | Observed distribution | Relationship to existing HTML | Implication for Pagecraft |
|---|---|---|---|
| [Deckflow HTML Editor](https://github.com/deckflow/html-editor) | Published npm CLI and embedding SDK | Targeted patches to original source; local project assets | Closest architectural competitor; already offers a practical project-file workflow |
| [mncoleman HTML Editor](https://github.com/mncoleman/html-editor) | Public browser application | Original source plus a changed-region splice; full serialization fallback | Closest install-free experience; stronger public accessibility today |
| [Framewright](https://github.com/WangHexinyi/framewright) | VS Code Marketplace and VSIX | Validated narrow source edits through the IDE | Strong alternative for developers already working in VS Code |

These three projects invalidate a uniqueness claim based on local files, visual editing, source patches, or a small frontend. They do not establish mass demand: their observed star counts are small, and comparable active-user evidence is unavailable. Their capabilities still matter when choosing what to build.[^2][^3][^4]

### Established builders and commercial substitution

| Project | Existing HTML input | Authoritative editing artifact | Main tradeoff for the proposed job |
|---|---|---|---|
| [GrapesJS](https://github.com/GrapesJS/grapesjs) | HTML/CSS parser and integration APIs | Editor project JSON | Powerful embeddable engine; integration and project persistence differ from returning the same file |
| [VvvebJs](https://github.com/givanz/VvvebJs) | Same-origin HTML page and code editor | Browser DOM | Real HTML output and visual controls, but whole-document serialization |
| [Webstudio](https://github.com/webstudio-is/webstudio) | HTML with CSS or Tailwind paste | Native components, styles, and project data | Strong conversion into a website-building system; input HTML is no longer the sole source of truth |
| [Silex](https://github.com/silexlabs/Silex) | Experimental HTML paste/import | GrapesJS project data and page JSON | Desktop/offline operation already exists; publication is separate from the authoring project |
| [Pinegrow](https://pinegrow.com/) | Existing local HTML projects | Standard project files | Broad professional visual editing and code-editor integration; must be included in switching comparisons |

The practical dividing line is the artifact the person wants afterward. Someone building a responsive published website may benefit from components, assets, and a project model. Someone correcting two paragraphs in an existing specification may value avoiding that conversion. This is a segment distinction, not a claim that project-based editors are inferior.[^5][^6][^7][^8][^9]

### Browser extensions and visual code editors

| Project | Relevant behavior | Persistence and adoption boundary |
|---|---|---|
| [VisBug](https://github.com/GoogleChromeLabs/ProjectVisBug) | Visual adjustments, multiselect, and inspection in the active browser page | Copies selected HTML fragments; original-file source patching was not established. Chrome Store displays 200,000 users |
| [Onlook](https://github.com/onlook-dev/onlook) | Visual changes to Next.js/Tailwind projects, including actual code writes | Project source and ZIP export; arbitrary standalone HTML import is not established |

VisBug is especially relevant to the extension proposal. Its Chrome listing provides a concrete installed-base signal for browser-based visual adjustment. Its inspected copy operation serializes a selected element into clipboard HTML, so describing it as having no HTML export would be incorrect. Its active-page editing is different from an established original-file save pipeline. The store's November 2024 release date also differs from the reviewed August 2026 repository commit; maintenance and distribution dates should not be conflated.[^26]

Onlook is relevant when the job is designing a running code project. Its implementation writes changes to project files and supports project export; it is more than a transient DOM editor. The reviewed README distinguishes the open-source editor from a newer hosted early-access product, and local development requires multiple services. Its attention signal does not imply that it serves a one-file offline HTML task.[^27]

### Maintenance and licensing snapshot

| Repository | Stars / forks | Reviewed default-branch commit date, UTC | License observed |
|---|---:|---|---|
| Deckflow | 0 / 1 | 2026-08-15 | MIT |
| mncoleman | 10 / 2 | 2026-06-15 | MIT |
| Framewright | 3 / 0 | 2026-08-01 | MIT |
| GrapesJS | 26,217 / 4,644 | 2026-08-25 | Core: BSD-3-Clause |
| VvvebJs | 8,664 / 1,835 | 2026-07-01 | Apache-2.0 |
| Webstudio | 8,934 / 1,599 | 2026-09-11 | Core: AGPL-3.0-or-later; optional animation package has separate proprietary terms |
| Silex | 2,962 / 675 | 2026-09-11 | Root/package: AGPL-3.0; source headers include an “or later” option |
| VisBug | 5,769 / 330 | 2026-08-03 | Apache-2.0 |
| Onlook | 26,718 / 2,095 | 2026-07-22 | Apache-2.0 |

None was archived in the snapshot. GrapesJS's repository API reports an unidentified license, while its core package and license file identify BSD-3-Clause; the table uses the actual core files. Studio SDK is a separate offering. License labels describe the reviewed artifacts, not interchangeable terms for every plugin or commercial package.[^1][^10]

Recent commits, releases, documentation, and communities are useful maintenance signals. They do not prove response-time commitments or that a particular bug will be fixed. Conversely, zero stars do not mean an unshipped project: Deckflow has an npm release. A snapshot should be refreshed before a future dependency or integration decision.

## Direct competitor assessment

### Deckflow

Deckflow is the first alternative to evaluate for a developer-assisted local HTML workflow. Its CLI opens an existing file, and its server supports project-relative assets. Its browser SDK can be embedded in another application. The reviewed package is `@deckflow/html-editor@0.1.8`; the registry reports 40 files and 341,948 unpacked bytes, excluding dependency footprint. That number must not be compared directly with a compressed Pagecraft extension archive.[^2][^11]

Its source patcher uses original source positions and replaces selected ranges instead of serializing the entire page. A multi-edit queue fails when a target cannot be resolved. The save path reads current source, creates a backup, and uses a temporary write. Documentation and code also cover autosave, snapping, selected-text formatting, duplication/deletion, and regular-table operations. Complex merged or irregular tables have explicit restrictions.[^12][^13]

**Assessment:** Pagecraft should not spend its positioning budget on having invented this architecture. Deckflow already supplies several missing capabilities, particularly connected assets and table editing. Pagecraft's possible advantage is a browser-first experience for people who do not want a CLI, combined with tested handling of cancellation, conflicts, and uncertain download outcomes. A direct user comparison is needed before claiming that advantage is real.

### mncoleman

The public application provides a usable entry point without a repository checkout. Its opening screen distinguishes a linked local file, an imported copy, and a blank document. Blocks, a document tree, attributes, style controls, and source editing broaden its scope beyond small text changes. This is a material acquisition advantage over a private Pagecraft repository with no hosted URL.[^3]

Source inspection shows a nuanced save strategy: unchanged content returns the original source; changed content is aligned against normalized DOM and spliced into the original. If alignment fails, it falls back to serialization. Therefore it should not be described as always rewriting HTML. Its download operation marks the document clean immediately after requesting the browser download; Pagecraft deliberately retains the dirty state because the original was not updated and completion is not confirmed.[^14]

The application also has bounded history and network-loaded dependencies, including fonts, icons, and lazy source-editing modules. No blanket claim of fully offline operation is justified from a no-build repository alone. That does not establish that its ordinary visual editing is slow or unreliable.[^15]

**Assessment:** This is the closest comparison for opening a link, importing a file, and doing a quick correction. Pagecraft needs an equally clear entry and stronger evidence for its preservation contract. It should borrow the clarity of file-opening choices without hiding the difference between an authorized original and a downloaded copy.

### Framewright

Framewright is an actual VS Code extension with a Marketplace listing and a downloadable VSIX. Its documented controls include visual drag/resize, snapping, responsive frames, text/style editing, and source navigation. Optional AI capabilities are separate from local import. Its host validates source targets and applies narrow edits using the IDE; ordinary VS Code saving remains in control.[^4][^16]

The inspected extension import path rejects active content and external resources. It offers normalization and an as-is mode with different targeting assurances. A separate development helper has different script behavior, so reading that helper alone would misdescribe the shipped path.[^17]

**Assessment:** An IDE adapter can help developers, but it is not automatically the best primary route for planners and other nondevelopers. Pagecraft's browser entry should remain primary until real usage shows that most tasks begin inside an IDE. Extending into every host simultaneously would create installation and support work without demonstrating additional demand.

## Established alternatives

GrapesJS has a mature collection of editor managers, plugins, wrappers, and integration surfaces. Its storage documentation recommends project JSON for reliable editor reloads; HTML/CSS import and export are supported but are not a substitute for all project state. Its asset manager has upload integration points rather than automatic access to an arbitrary local project folder. These facts make it a serious build-versus-adopt option for a future CMS builder, while leaving a distinct role for an original-file editor.[^5][^18]

VvvebJs directly challenges “vanilla JavaScript and HTML output” as differentiation. Its example editor loads actual pages, offers visual and code controls, and can download HTML or use server save examples. The inspected `getHtml()` reads `documentElement.outerHTML`, so preservation of the original formatting is not its save strategy. Its ZIP plugin packages selected linked assets, but the inspected code does not establish exhaustive dependency capture. None of these architectural observations is a measured visual-fidelity failure.[^6][^19]

Webstudio's HTML import is more capable than a simple embed. Official documentation describes conversion of pasted style blocks into reusable style tokens, reports selectors whose targets are missing, and imports referenced images into asset storage. Tailwind paste is a separate supported path. Its hosted workflow and project/export model suit building and publishing sites. The opportunity for Pagecraft is to make a smaller file correction cheaper, not to claim Webstudio cannot edit imported HTML.[^7][^20]

Silex provides desktop installers for Windows, macOS, and Linux, with offline/no-account editing and local publication advertised. The desktop product is labeled early alpha. Its current HTML import command is experimental, and authoring persists project/page JSON. This makes local/offline distribution an existing competitive capability, while preserving a meaningful distinction between opening an HTML artifact and importing it into a builder project.[^8][^21]

Pinegrow is a strong commercial substitute: existing HTML projects, visual manipulation, responsive tools, CSS editing, and standard-file workflows are already part of its offer. Its code-editor guide describes watching saves to existing HTML and attached stylesheets, with boundaries around newly created or moved files. Pagecraft must beat a user's actual correction process, including such tools and another AI prompt, rather than only compare itself with heavyweight design canvases.[^9][^22]

## Source preservation evidence

Minimal source patches are a worthwhile engineering property because comments, quote style, unrelated attributes, and generated-file conventions can matter to the next editor. They are not a complete correctness metric. A tiny diff can still change the wrong element, and a normalized document can still render correctly.

The accompanying [synthetic probe](research/roundtrip-probe.mjs) and [recorded results](research/roundtrip-results.json) compare Pagecraft's text-patch engine with the mncoleman application's serialization path. They cover a no-op, a simple edit, separated edits around untouched markup, and a table with an implicit container. Results must be interpreted at fixture level; this is not a ranking of overall products, human usability, or performance.

| Synthetic case | Pagecraft: exact expected source | mncoleman: exact expected source | Both: expected normalized DOM |
|---|---|---|---|
| No edit | Yes | Yes | Yes |
| One leaf-text edit | Yes | Yes | Yes |
| Two separated text edits | Yes | No; intervening quote formatting changed | Yes |
| Cell edit with implicit `tbody` | Yes | No; document serialization normalized markup | Yes |

All requested text changes survived in both tools. Pagecraft matched the original source plus only the requested text replacements in four cases; mncoleman did so in two. The table does **not** establish a visual breakage rate: both produced the expected normalized DOM in all four cases, and no screenshot comparison was performed. Four relevant JavaScript files from the live deployment matched the reviewed mncoleman commit by SHA-256. The probe used Chrome 153 and internal editing models; it bypassed human interaction and disk saving. Reproduce it explicitly with `node --import tsx docs/research/roundtrip-probe.mjs` after installing development dependencies and Chrome; this visits the external demo with synthetic files only and replaces the recorded result.

For a meaningful advantage, extend the corpus to generated reports, slide-like documents, nested text, comments/entities, duplicate IDs, ID-based styling, tables, linked assets, malformed-but-renderable markup, and non-English input. Record source changes and reopened appearance separately. Run the same supported operations on competitors, including Deckflow, instead of choosing fixtures only after observing a competitor failure.

## Demand and adoption

### Evidence of the job

A March 2026 GrapesJS discussion asks about importing templates from AI-generated code, Envato, and custom HTML. The author describes difficulties involving complex structure, scripts, global CSS, and assets. This closely matches the proposed job and shows that import compatibility can be a real problem. It is one developer account, not a prevalence estimate or proof that Pagecraft solves those templates.[^23]

A separate 2024–2025 discussion offers payment for help improving HTML import behavior and reports differences between a core integration and Studio SDK. That establishes a costly problem for one integrator, not a completed payment or recurring consumer demand. VvvebJs discussions and a later asset-path contribution also show that save integration and relative resources create practical work; an old issue with a linked fix is not evidence of a current unresolved defect.[^24][^25]

These signals justify testing the problem. They do not justify an adoption probability, TAM figure, subscription forecast, or claim that “people will definitely use it.” Public GitHub discussions overrepresent developers and people experiencing difficulties. Silent users who are satisfied with existing methods are missing from that sample.

VisBug's displayed 200,000 Chrome Store users strengthen the evidence for the broader visual-browser-editing category. That measure is not monthly active use, repeat editing, or payment. It supports investigating an accessible visual workflow; it does not transfer that installed base to Pagecraft or validate the narrower file-handoff segment.[^26]

### Initial audience

The proposed initial audience is people who already exchange self-contained static HTML specifications, mockups, or reports at least twice a month. Typical corrections are a sentence, spacing, color, a duplicated card, or removal of an unnecessary section. The desired output is still HTML, ready to share with a colleague or coding agent.

| Candidate segment | Fit with current implementation | Reason |
|---|---|---|
| Planners and QA editing generated static specifications | Strong hypothesis | Small visual corrections and an existing handoff artifact |
| People preparing standalone HTML reports or presentation-like pages | Moderate hypothesis | Suitable file format; rich text and layout constraints may limit tasks |
| Developers adjusting a multi-file static prototype | Conditional | Folder mode helps assets; IDE tools and Deckflow are close substitutes |
| Agencies building responsive production sites | Weak initial fit | Components, assets, publishing, and shared workflows dominate |
| People editing running React/Vue apps or expecting PPTX/Figma import | Outside current contract | Requires fundamentally different input and editing behavior |

The segment should be selected from real files, not just favorable job titles. Count how many screened participants only have unsupported applications or asset-heavy documents. Excluding those people silently would make the niche look more useful than it is.

### Present adoption barriers

Pagecraft is currently private and has no hosted HTTPS entry or extension-store listing. Building locally or loading an unpacked extension is a private-trial route, not a frictionless public launch. The interface is Korean; English repository documentation does not provide an English product experience.

Browser editing currently retains documents and pending changes in memory for the session. Its previous-original backups are not draft recovery. A page refresh can therefore lose unsaved work. Browser mode receives the selected HTML only; sibling assets are unavailable, and previews do not run document scripts. Those boundaries must be visible before someone invests time in a misleading preview.

The existing implementation already distinguishes native saves from copy downloads, preserves edits after cancellation, checks conflicts, and limits resource retention. Those are useful foundations. Their presence in code does not yet prove that a first-time user understands them or can finish without assistance. [Current behavior and limits](USAGE.md)

## Product and distribution priorities

### Changes included with this analysis

The first-run browser screen now offers a bundled example and a conventional copy picker. Single-file HTML drop uses the existing import path, including the preview area. The sample removes the need to supply a personal document before seeing how editing works. Drop remains a copy workflow; it does not imply permission to overwrite the dropped file.

A persistent, collapsible preview notice explains detected script and resource restrictions. Counts come from the existing HTML parse traversal rather than a second parser or a drag-time scan. It distinguishes references that browser mode cannot access from local references that folder mode can serve. It does not fetch dependencies or relax preview execution rules to make the page appear complete.

Diagnostics count selected HTML attributes only: executable script tags, stylesheet links, and common image/media sources. They do not analyze CSS `url()`/`@import`, `srcset`, SVG references, event handlers, or runtime-generated content. No notice is not a compatibility certificate. The browser welcome copy also states the current draft lifetime, so a cached app shell is not mistaken for saved document work.

These changes address observed first-use friction and plausible failure confusion. They are implemented improvements, not a demonstrated increase in conversion; that requires user outcomes.

### Ordered follow-up work

| Priority | Work | Acceptance evidence | Why it precedes more features |
|---|---|---|---|
| P0 | Validate first edit and save/reopen | Unassisted task outcomes and preserved outputs | Establishes whether the core task succeeds |
| P1 | Bounded local draft recovery | Reload/crash, quota, eviction, and external-change tests; explicit recovery as a copy | Repeat use depends on retaining work |
| P1 | English UI and a reviewed browser entry for a global trial | Non-Korean participant can start and finish without developer tools | Distribution and language currently limit reach |
| P2 | Local-folder asset access or packaging | Real rejected files render correctly without escaping the authorized folder | Expand coverage only where the trial finds demand |
| P2 | Most repeated editing gap | Task frequency plus verified improvement in completion time | Could be rich text, snapping, table operations, or source diff; do not assume all are needed |

Public hosting, store publication, visibility changes, outreach, and licensing decisions are separate launch actions. No such launch or invitation is part of this analysis. A browser app remains the default entry; PWA installation is optional convenience, the extension is an optional launcher, and the local server serves project folders. Duplicating the editor for individual Chromium-based browsers would increase maintenance without removing their file-permission or reserved-shortcut constraints.

### Engineering investment

Keep the shared editing engine and separate file-access adapters. A TypeScript-to-C rewrite would not by itself reduce DOM layout, painting, history retention, or browser process costs. The current work adds an example and metadata, not another rendering engine, polling loop, analytics package, or dependency. Measure cold load, time to interactive editing, memory after sustained operations, and large-document latency under matched conditions before claiming superiority.

Adopting GrapesJS could make sense if the product becomes a component/CMS builder. Integrating Deckflow could make sense if an embedding SDK is the main deliverable. Neither change is presently justified solely to obtain visual editing that Pagecraft already has. Compare migration effort, supported file fidelity, maintenance burden, and user outcomes before changing the core.

The likely defensible asset is a growing corpus of real supported documents and fewer surprising failures, reinforced by a clear entry and trustworthy saving. A launcher extension or source-patch algorithm alone is easy to replicate. Monetization remains unvalidated; avoid building billing around assumed recurring use before observing repeat tasks.

## Two-week validation plan

The following gates are **proposed product decisions**, not industry benchmarks or statistically powered estimates. Twelve participants can reveal major usability failures and weak repeat interest; they cannot establish market share. Record outcome, elapsed time, browser, and support interventions without collecting private document contents or introducing an analytics SDK.

1. **Days 1–2: prepare the contract and tasks.** Use a reviewed build, a supported sample, and deliberately unsupported files. Freeze the task: open, change a headline, duplicate/align a card, save or download, and reopen the result. Record install/setup time separately from time inside the app.
2. **Days 3–5: observe 12 qualified participants.** Include at least four who do not usually edit HTML code. Ask for a nonsensitive document they actually need to modify. Include global participants after an English UI is available. Outreach requires a separate authorized action.
3. **Days 6–8: compare with the existing method.** Give two comparable small corrections, one using Pagecraft and one using the participant's usual method. Alternate order. End timing only when the edited artifact is reopened correctly, not when Save is clicked.
4. **Days 9–14: observe voluntary repeat work.** Count a completed real-file edit on a different day. Demo launches, satisfaction ratings, or daily reminders do not establish independent return behavior. Record why people reused the tool or switched back.

| Gate | Proposed threshold | Decision if missed |
|---|---|---|
| First useful outcome | At least 9/12 complete edit-and-reopen in 3 minutes after reaching the app, without help; report setup time too | Repair onboarding and save comprehension before expansion |
| Artifact reliability | Every study output reopens with its requested changes; no silent overwrite or lost-edit event | Repair correctness before expanding the trial |
| Useful coverage | At least 9/12 qualified real documents fit the declared contract without manual asset repair; also report screened-out fraction | Narrow positioning or prioritize asset access |
| Switching value | At least 8/12 prefer Pagecraft for that correction, with a lower median end-to-end time than their usual method | Reconsider whether a separate application is worthwhile |
| Repeat use | At least 5/12 complete another real-file edit on a different day within two weeks | Treat it as an occasional utility; do not infer subscription demand |

If these gates pass, expand the document corpus and trial population before making broad reliability claims. If users like the editor but rarely encounter the job, maintain a small utility or embed it where HTML is generated. If asset limitations exclude most real work, improve file access before adding more canvas controls. The evidence should choose the next investment.

## Sources

All online sources were accessed September 12, 2026. Pinned repository links identify the reviewed code; live documentation and counters may change. Source dates below are publication/commit dates where available. The repository snapshot contains exact hashes for all nine public projects. The availability-conflicted `CasinoLove/web-editor` listing was excluded from the ranked comparison because direct repository/API access returned 404; cached search descriptions did not establish current public availability.

[^1]: GitHub repository REST records, September 12, 2026: [Deckflow](https://api.github.com/repos/deckflow/html-editor), [mncoleman](https://api.github.com/repos/mncoleman/html-editor), [Framewright](https://api.github.com/repos/WangHexinyi/framewright), [GrapesJS](https://api.github.com/repos/GrapesJS/grapesjs), [VvvebJs](https://api.github.com/repos/givanz/VvvebJs), [Webstudio](https://api.github.com/repos/webstudio-is/webstudio), [Silex](https://api.github.com/repos/silexlabs/Silex). Counts, default branches, and archive status; commit provenance in [local snapshot](research/repository-snapshot.json).
[^2]: Deckflow contributors. [HTML Editor README and package](https://github.com/deckflow/html-editor/tree/cc1e9a7c61a1e02e50be2a9a4fe86237cafa7a8d), August 15, 2026. CLI, SDK, existing-file support, and documented editing scope.
[^3]: mncoleman. [HTML Editor README](https://github.com/mncoleman/html-editor/blob/9d43d6e94af8aef6743e3fe44783f22ef2d661ee/README.md), June 15, 2026, and [live editor](https://html.mncoleman.com/), accessed September 12. Entry flow and public availability.
[^4]: Framewright contributors. [Package manifest](https://github.com/WangHexinyi/framewright/blob/ac0f4c483718dfff01383cf3cf35d4b81e677915/package.json), August 1, 2026, and [Visual Studio Marketplace listing](https://marketplace.visualstudio.com/items?itemName=framewright.framewright), undated. Distribution, host, and documented controls.
[^5]: GrapesJS. [Storage Manager](https://grapesjs.com/docs/modules/Storage.html), undated. Project persistence contract and HTML/CSS boundaries.
[^6]: VvvebJs contributors. [Builder source](https://github.com/givanz/VvvebJs/blob/1acbab7ebfe3e7b004f1f18c039d26550fc04bd8/libs/builder/builder.js#L2182), July 1, 2026. `getHtml()` serialization; same file's `loadUrl()` implements iframe page loading.
[^7]: Webstudio. [HTML with CSS](https://docs.webstudio.is/university/foundations/copy-paste/html-with-css), undated. Editable component/style conversion, skipped selectors, referenced images.
[^8]: Silex contributors. [Project storage implementation](https://github.com/silexlabs/Silex/blob/db7c797de7f3681b2843c825a80161bd21265de8/server-rust/src/storage.rs#L14) and [HTML import command](https://github.com/silexlabs/Silex/blob/db7c797de7f3681b2843c825a80161bd21265de8/editor/grapesjs/openImport.ts#L38), September 11, 2026 snapshot. Authoring format and experimental import.
[^9]: Pinegrow. [Web Editor product page](https://pinegrow.com/), accessed September 12, 2026; identifies version 9.3 released June 17, 2026. Existing HTML and professional visual editing offer.
[^10]: Project license files at reviewed commits: [GrapesJS core BSD license](https://github.com/GrapesJS/grapesjs/blob/2bdeda85b82b8b9ceae42fd6558cbbcae5ec2d21/packages/core/LICENSE), [VvvebJs](https://github.com/givanz/VvvebJs/blob/1acbab7ebfe3e7b004f1f18c039d26550fc04bd8/LICENSE), [Webstudio license section](https://github.com/webstudio-is/webstudio/blob/649ee3669d54a406ff39d31d09b178bf485815a9/README.md#license), [Silex](https://github.com/silexlabs/Silex/blob/db7c797de7f3681b2843c825a80161bd21265de8/LICENSE). Direct-editor MIT declarations are in their linked repository snapshots.
[^11]: npm registry. [@deckflow/html-editor latest package record](https://registry.npmjs.org/@deckflow%2Fhtml-editor/latest), September 12, 2026 observation. Version, file count, and unpacked size; no user count inferred.
[^12]: Deckflow contributors. [Source patch implementation](https://github.com/deckflow/html-editor/blob/cc1e9a7c61a1e02e50be2a9a4fe86237cafa7a8d/htmlPatch.js#L503-L554), August 15, 2026 snapshot. Range replacement and multi-patch failure handling.
[^13]: Deckflow contributors. [Save implementation](https://github.com/deckflow/html-editor/blob/cc1e9a7c61a1e02e50be2a9a4fe86237cafa7a8d/server.js#L423-L459), [snapping code](https://github.com/deckflow/html-editor/blob/cc1e9a7c61a1e02e50be2a9a4fe86237cafa7a8d/public/snapEngine.js), and [table restrictions](https://github.com/deckflow/html-editor/blob/cc1e9a7c61a1e02e50be2a9a4fe86237cafa7a8d/README.md#table-editing), August 15, 2026 snapshot.
[^14]: mncoleman. [File operations](https://github.com/mncoleman/html-editor/blob/9d43d6e94af8aef6743e3fe44783f22ef2d661ee/js/file.js#L100-L184), June 15, 2026 snapshot. Serialization/splice logic; export status handling appears later in the same file.
[^15]: mncoleman. [History state](https://github.com/mncoleman/html-editor/blob/9d43d6e94af8aef6743e3fe44783f22ef2d661ee/js/state.js#L33-L63), [external script references](https://github.com/mncoleman/html-editor/blob/9d43d6e94af8aef6743e3fe44783f22ef2d661ee/index.html#L127-L152), and [font import](https://github.com/mncoleman/html-editor/blob/9d43d6e94af8aef6743e3fe44783f22ef2d661ee/css/editor.css#L1-L3), June 15, 2026 snapshot.
[^16]: Framewright contributors. [Writeback service](https://github.com/WangHexinyi/framewright/blob/ac0f4c483718dfff01383cf3cf35d4b81e677915/src/extension/writebackService.cts#L743-L902), August 1, 2026 snapshot. Target validation and native editor edits.
[^17]: Framewright contributors. [Active extension import](https://github.com/WangHexinyi/framewright/blob/ac0f4c483718dfff01383cf3cf35d4b81e677915/src/extension.cts#L552-L637) and [candidate validator](https://github.com/WangHexinyi/framewright/blob/ac0f4c483718dfff01383cf3cf35d4b81e677915/src/extension/htmlCandidateValidator.cts#L37-L68), August 1, 2026 snapshot.
[^18]: GrapesJS. [Core README](https://github.com/GrapesJS/grapesjs/blob/2bdeda85b82b8b9ceae42fd6558cbbcae5ec2d21/packages/core/README.md), August 25, 2026 snapshot, and [Asset Manager guide](https://grapesjs.com/docs/modules/Assets.html), undated. Integration ecosystem and configured uploads.
[^19]: VvvebJs contributors. [README](https://github.com/givanz/VvvebJs/blob/1acbab7ebfe3e7b004f1f18c039d26550fc04bd8/README.md) and [ZIP export plugin](https://github.com/givanz/VvvebJs/blob/1acbab7ebfe3e7b004f1f18c039d26550fc04bd8/libs/builder/plugin-jszip.js#L19), July 1, 2026 snapshot. Setup, controls, server examples, and selected asset packaging.
[^20]: Webstudio. [HTML with Tailwind](https://docs.webstudio.is/university/foundations/copy-paste/html-with-tailwind), [first-site guide](https://docs.webstudio.is/basics/building-your-first-site), and [download workflow](https://docs.webstudio.is/university/self-hosting/download), undated. Alternative import, account/project workflow, static export.
[^21]: Silex. [Desktop downloads](https://www.silex.me/download/), undated, and [README](https://github.com/silexlabs/Silex/blob/db7c797de7f3681b2843c825a80161bd21265de8/README.md), September 11, 2026 snapshot. Installer platforms, offline mode, alpha status.
[^22]: Pinegrow. [Using other code editors and IDEs](https://pinegrow.com/docs/master-pinegrow/using-external-code-editors/other-code-editors-and-ides/), undated. Existing-file save synchronization and its boundaries.
[^23]: GrapesJS community. [Discussion #6732](https://github.com/GrapesJS/grapesjs/discussions/6732), opened March 28, 2026. Individual report about imported AI/template HTML; replies are community views, not maintained compatibility guarantees.
[^24]: GrapesJS community. [Discussion #6333](https://github.com/GrapesJS/grapesjs/discussions/6333), opened November 26, 2024, replies through April 29, 2025. Individual import problem and help offer; no payment or current defect inferred.
[^25]: VvvebJs community. [Discussion #341](https://github.com/givanz/VvvebJs/discussions/341), March–April 2024, and [pull request #424](https://github.com/givanz/VvvebJs/pull/424), opened October 16, 2025. Save integration and relative resource references; the save-limit report includes a fix.
[^26]: VisBug contributors. [README](https://github.com/GoogleChromeLabs/ProjectVisBug/blob/fef96fad0c54547637dd2bbdc326450027a906e7/readme.md), [selected-element HTML copy](https://github.com/GoogleChromeLabs/ProjectVisBug/blob/fef96fad0c54547637dd2bbdc326450027a906e7/app/features/selectable.js#L167-L193), and [tab injection](https://github.com/GoogleChromeLabs/ProjectVisBug/blob/fef96fad0c54547637dd2bbdc326450027a906e7/extension/visbug.js), August 3, 2026 snapshot. [Chrome Web Store listing](https://chromewebstore.google.com/detail/visbug/cdockenadnadldjbbgcallicgledbeoc), observed September 12, 2026: 200,000 displayed users, version 0.4.10 updated November 20, 2024. Installed-base signal, not active use. [Repository API](https://api.github.com/repos/GoogleChromeLabs/ProjectVisBug) supplies metadata.
[^27]: Onlook contributors. [README](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/README.md), [code writes](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/code/index.ts#L26-L95), and [project export](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/sandbox/index.ts#L190-L213), July 22, 2026 snapshot. [Local development guide](https://docs.onlook.com/developers/running-locally), undated. [Repository API](https://api.github.com/repos/onlook-dev/onlook) supplies metadata.
