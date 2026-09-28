# Public usability review

Reviewed on 2026-09-28 (KST), against public commit `ab86272` and
<https://suwonleee.github.io/pagecraft/>. This is a reproducible engineering
review, not a study with external participants. Product behavior was not changed.

## Findings, in recommended order

| Priority | Finding | User impact | Recommended change |
| --- | --- | --- | --- |
| P1 | The guide says file drops always import a copy, but supported native drops open the original. | A reader may expect the original to remain unchanged when saving. Write permission is still required. | Describe native opening and copy fallback separately. |
| P2 | Downloading a newly created report leaves “Original not saved” and the discard warning. | A user who successfully downloaded a report can interpret this as a failed save, even though that report never had an original. | Preserve draft protection; distinguish new documents, downloaded revisions, and original-file saves in status and confirmation text. Do not claim the browser verified that a download reached disk. |
| P2 | The usage guide says there is no hosted URL and starts with build commands. | Non-developers may install Node.js unnecessarily or abandon setup. | Link the deployed app first and make local building optional. |
| P2 | The guides describe file handles as session-only and deny a persistent recent-file list. | Returning users receive contradictory instructions about reopening files and stored browser data. | Distinguish in-memory documents, persisted recent-file handles, permissions, and draft copies. |

## Evidence and reproduction

1. **Drop destination:** `docs/USAGE.md:8,60` and `docs/ARCHITECTURE.md:50`
   describe copy-only drops. `public/app.js:1493-1496,1519` uses a native
   handle when available. `e2e/browser-mode.spec.ts:800` covers this behavior.
   This finding is based on source and existing regression coverage; the native
   operating-system drop/permission journey was not manually repeated.
2. **Download wording:** on the hosted app, select Korean, create a weekly
   report, edit its title, and download. The download completed successfully,
   but the status read `사본 다운로드 요청됨 · 원본 저장 전`. Importing the
   downloaded file next opened the discard dialog. After confirmation, the
   edited title was preserved. See `public/app.js:182,215,820-832,901-905`.
3. **Hosted URL:** `docs/USAGE.md:7-11` conflicts with `README.md:13,77` and
   the functioning public app. The repository homepage already points to Pages.
4. **Recent files:** `docs/USAGE.md:74` and `docs/ARCHITECTURE.md:52` conflict
   with `public/recent-files.js:79-87` and `docs/USAGE.md:138-143`. Persisting
   a handle does not guarantee permission remains granted.

## Verified journeys

- Public app: Korean weekly report creation, title editing, successful HTML
  download, reimport, and preservation of the edited title.
- Public app at 390 × 844: no document-level horizontal overflow; opening
  the properties panel and editing the title worked. This is a desktop browser
  at a narrow viewport, not a physical-phone test.
- Fresh dependency installation: `npm ci --ignore-scripts` succeeded.
- `npm run check`: type and browser syntax checks succeeded; 62 tests passed.
- `npm run build:web` succeeded. The selected English onboarding and locale
  tests cover download/reopen, language switching, narrow screens, and offline
  localized templates: 11 passed in Chrome, 11 in Firefox, and 11 in WebKit
  (33 total). WebKit automation does not establish physical Safari/iOS support.

## Repository connection

The original checkout already has `origin` set to
`https://github.com/suwonleee/pagecraft.git`, with `main` tracking `origin/main`.
Fetching exposed rewritten remote history: local `main` is 18 commits ahead
and 4 behind. This does not establish that 18 features are missing remotely.

The existing checkout and history were preserved. A separate worktree at
`/Users/suwonleee/pagecraft-public-review` uses branch `review/public-usability`,
tracks `origin/main`, and starts at the public commit `ab86272`. Continue work
on the public version there. No reset, merge, commit, or push was performed.

Native file pickers, operating-system permissions, physical mobile devices,
and the complete extension/server suites were outside this review's local run.
