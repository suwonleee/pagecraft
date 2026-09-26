# Reproduce the README screenshots

The screenshots in `docs/images/` are real Pagecraft browser UI captures, made by Playwright while opening bundled fictional examples, editing their text and styles, and downloading and reopening HTML. The test does not inject editor state, edit screenshot pixels, or replace document DOM to simulate a completed action.

```sh
npm ci
npm run build:web
PAGECRAFT_SCREENSHOTS=1 npx playwright test \
  -c playwright.browser.config.ts e2e/english-ui.spec.ts --project chrome
```

This uses installed Google Chrome, an isolated browser profile, a local static server on an ephemeral port, English UI, and a 1440 × 1100 viewport. No personal files or credentials are used. In CI, the equivalent project is `chromium`.

| File | Actual action captured |
|---|---|
| `start.png` | Open a fresh English editor |
| `report-templates.png` | Open **Start with a report** |
| `edit-report.png` | Open the weekly report, edit its title and font size in the properties panel |
| `edit-landing.png` | Open **Try the sample**, replace the landing-page headline |

The English journey also checks that report print CSS and stable IDs survive saving, downloads reopen correctly, Korean preferences persist, cancelling a language switch preserves unsaved work, and blocked browser storage does not break the English editor. These checks cover browser behavior; they do not certify native OS file associations or physical mobile-device interaction.

Earlier Korean screenshots under `docs/research/` remain historical validation evidence and are not the public README's product screenshots.
