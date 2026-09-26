# Pagecraft

Read [AGENTS.md](AGENTS.md) for the shared human/agent report-editing workflow and project conventions.

Use the provider-independent document CLI described in [docs/AI_EDITING.md](docs/AI_EDITING.md). Inspect the saved HTML, build a hash-bound JSON patch, validate with `--dry-run`, and apply only the authorized changes. Preserve the human's latest edits and report conflicts without overwriting them.
