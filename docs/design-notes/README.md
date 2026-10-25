# Design notes

Behavior, edge cases and rationale of individual features — the *why* that does not belong in a code comment and is too detailed for `CLAUDE.md`. They are reference material for whoever changes a feature, not instructions.

| File | Covers |
| --- | --- |
| [extension.md](extension.md) | the popup, content script and service worker: UI flows, modules, state, i18n, docs, accounts |
| [companion.md](companion.md) | the local HTTP server: endpoints, stores, authentication, installers, configuration |
| [compiler.md](compiler.md) | the IR, validation, plan building and the Python code generators |
| [templates.md](templates.md) | the Scriban templates and fragments, i.e. what the generated scripts do at run time |
| [feature-scope.md](feature-scope.md) | what each shipped feature covers and what it deliberately leaves out |

Where else to look: `docs/ARCHITECTURE.md` says *where* something lives (file index, diagrams, mirrors); `CLAUDE.md` holds the rules and architecture decisions that apply to every change; `docs/user/` is the user documentation.

## Adding or changing a note

- Put the note in the file of the area it belongs to, next to the feature's existing entry; update that entry instead of adding a second one.
- Say what the feature does at its edges and *why* it is built that way. Do not list files (that is `docs/ARCHITECTURE.md`) and do not repeat what a test or the code states.
- Keep an issue number where it helps a reader find the discussion; drop it when it only dates the text.
- The original wording of an entry was moved here unchanged from `CLAUDE.md` in Issue #379 and is condensed over time, in the same pull requests that touch the feature.
