# Scraping Factory — Developer Documentation

This file holds what applies to **every** change: the rules, the cross-cutting conventions and the settled architecture decisions. It is loaded into every session, so it is kept small (a test caps it at 40 KB) — if you are about to add a paragraph about one feature, it belongs in the places below instead.

| Where | What it is for |
| --- | --- |
| `docs/ARCHITECTURE.md` | the *where*: system diagrams, a feature-to-file index, the wire-format model, the table of cross-boundary mirrors |
| `docs/design-notes/` | the *why* per feature: behavior, edge cases and rationale ([extension](docs/design-notes/extension.md), [companion](docs/design-notes/companion.md), [compiler](docs/design-notes/compiler.md), [templates](docs/design-notes/templates.md), [feature scope](docs/design-notes/feature-scope.md)). Code comments that say "see CLAUDE.md's X section" mean these files. |
| `docs/user/` | documentation for people using the extension (English, with a German translation) |
| `test-vectors/README.md` | the shared contract vectors and wire fixtures |

## Project Overview

A browser extension that lets users without programming knowledge visually configure web scrapers. The result is a standalone, readable **Python script** (v1). The architecture is designed to support additional target languages later on.

The MVP (v1.0.0) was reached a while ago — the current release is v1.20.0. The project is therefore no longer in MVP buildout but in normal, ongoing feature development beyond it, including well beyond the feature set originally planned for v1. Foundational decisions made during the prototyping phase (IR schema, extension↔companion communication) are considered settled and are evolved during ongoing development rather than re-litigated — see "Architecture Decisions" below.

**Principle:** Scraping Factory is meant to remain a free plugin (no cost, no dependency on paid third-party services). This specifically rules out commercial stealth-browser/anti-bot SDKs with a session or license model (see "Conventions that apply to every change" below).

Full architecture concept: `architekturkonzept.md` (in the repo root, not checked in / kept separately).

For the structural map of the codebase — system diagrams, a feature-to-file index,
and the cross-boundary class/wire-format relationship model between the extension
and the companion — see `docs/ARCHITECTURE.md`. That document is the *where*; this
file remains the *why* (behavioral detail, edge cases, the reasoning behind design
decisions).

## Language

Code comments, commit messages, pull requests, issue descriptions, and all documentation (this file, `README.md`, `docs/**`, `.claude/skills/**`) are written in **English**, regardless of what language a task request came in — conversations with the assistant (and the underlying issues/requests) are frequently in German, and that's fine; German task descriptions do not need to be pre-translated before work starts. When a PR/issue names a specific UI element, name it by its English UI string (the `en.json` value, e.g. "Export configuration", not "Konfiguration exportieren") even if the conversation that produced it was in German — English is the one label guaranteed to be stable across the extension's UI languages (see below), unlike any one specific translation.

The extension's own end-user-facing UI (button labels, screen text) is the one place actual runtime *language choice* exists: `extension/i18n/{de,en,es}.json` hold three parallel dictionaries (loaded by `extension/i18n/i18n.js`), picked via an in-popup language selector and persisted like any other setting (`chrome.storage.local`) — adding or changing a user-facing string means updating all three files, not just one, to keep them in sync. Error messages returned by the companion (`/generate`'s `400`/`422` response bodies, thrown exceptions) and the generated scripts' own runtime console output (hardening/proxy/login warnings, etc.) are plain English like the rest of the codebase — neither is part of the extension's i18n system, and unlike the popup UI, neither has a per-language variant.

## User documentation

`docs/user/` (Issue #354, Part A) is the documentation for people *using* the extension, as opposed to this file and `docs/ARCHITECTURE.md`, which are for developers: a getting-started page, one page per feature area with a worked example (modes, browser engine, pagination, transforms and presets, hardening/monitoring, saved configurations, output formats and blueprints, network settings, accounts), and a troubleshooting/FAQ page. English is the source language; a German version follows later, and the extension's own help stays de/en/es. Pages use stable headings, since the extension is meant to link to them (Part B of the issue: shortening the long `*Hint` strings in the popup and shipping the docs bundled with the extension — not done yet).

**Screenshots are generated, not hand-made.** `e2e/screenshots/run.js` drives the real unpacked extension (via `e2e/harness.js`) against the `test-pages/` fixtures with a fixed viewport (420×900, side-panel-like), language (`en`) and theme (`light`, `--theme dark` available), and writes `docs/user/images/<name>.png`; `--only <text>` runs just the scenarios whose id contains the text, `--list` prints them. A scenario (`e2e/screenshots/scenarios/<page>.js`) names a fixture and the clicks that reach a screen; `lib.js`'s `openScenario` wipes `chrome.storage` first so scenarios never depend on each other. It runs its own companion on port 5056 and never touches one on the default port; a failing scenario saves a picture of the popup's state to the OS temp directory. `e2e/screenshots/check-docs.js` verifies every relative link, `#anchor` and image in `docs/user/` resolves and that no image is unused. The images are committed (GitHub renders them from the repository) but regenerated on demand, like the rest of `e2e/`, so they are not part of any CI step.

**Maintenance rule** (in `.claude/skills/feature-workflow/SKILL.md`, step 7): a pull request that changes something user-visible updates its `docs/user/` page and screenshots in the same PR, like it updates `docs/ARCHITECTURE.md` and the matching `docs/design-notes/` file.

## Directory Structure

```
extension/                  Browser extension (Manifest V3)
  background/               Service worker — message relay only
  content/                  Content script — DOM highlighting, selector extraction
  popup/                    Popup UI

companion/                  .NET 10 solution
  ScrapingFactory.Companion/ Entry point — local HTTP server
  ScrapingFactory.Compiler/  IR types + language modules
    IR/ScrapingConfig.cs     Intermediate representation
    Backends/Python/         Python code generator

language-modules/
  python/templates/          Scriban templates for generated Python scripts

install/                    Release bundle tooling (Issue #346): build-bundle.sh, install/uninstall scripts for Linux/macOS (.sh) and Windows (.ps1), bundle INSTALL.md
test-pages/                  Fixture pages for manually exercising extension features (no server.py = plain static HTML)
e2e/                         Playwright harness for driving the real extension in a real browser (Issue #180, manual/on-demand — see e2e/README.md)
  screenshots/               Generator for the user-documentation screenshots (Issue #354) — see "User documentation" above
docs/
  ARCHITECTURE.md            Developer-facing structural map
  design-notes/              Per-feature behavior and rationale (extension, companion, compiler, templates, feature scope)
  user/                      User documentation (English, Issue #354) with generated screenshots in images/
```


## Conventions that apply to every change

**Product boundaries**
- Scraping Factory stays a free plugin: no commercial stealth-browser/anti-bot SDK with a session or license model, no paid third-party service.
- No CAPTCHA solving or bypassing, and the hardening checks only detect and report blocking. If a CAPTCHA stops a flow, the script fails honestly.
- Python is the only target language for now (the IR and `LanguageModuleRegistry` are built for more). The default engine is static (`requests` + BeautifulSoup); the optional Browser engine is plain Playwright + stock Chromium.

**Wire format and IR**
- The extension sends `ScrapingFactory.Compiler.IR.ScrapingConfig` (camelCase JSON, string enums) to `POST /generate`; `ScrapingPlanBuilder` turns it into the canonical `ScrapingPlan`, and only that reaches the code generators and the verifier.
- New options are additive and optional (`bool?`/`null` = today's exact behavior); the extension omits the key when the option is off. An incomplete draft counts as "off" (`build*` returns `null`) and never blocks generation.
- Combinations the companion cannot honor are rejected outright (`400` from `/generate`, or `ScrapingPlanValidator`), never silently ignored.
- Polymorphic lists use an explicit camelCase `kind` tag when the variants have no structural tell (transforms, hardening checks, pagination, API parameter sources); the container/API/body/blueprint node lists use structural converters (`ContainerNodeJsonConverter`, `ApiNodeJsonConverter`, `ApiBodyNodeJsonConverter`, …) because branch and leaf differ visibly (`children`, `properties`, …).
- `buildScrapingConfig`/`buildConfigExport` take one options object (`SFDraft.ConfigBuildOptions` in `extension/types/popup-drafts.d.ts`); adding a setting is adding a key there, a default in the destructuring and a line in `configOptionsFromState` (`scraping-config-builder.js`), which maps popup state + global settings for the three production callers. A key that is off/absent leaves the request body unchanged.
- Anything implemented twice across the extension/companion boundary (file-name sanitizing, transform previews, robots.txt matching, range formats, URL-template matching, the `:contains()` split, environment-variable names, the request body, `companion-ir.d.ts`) is pinned by shared data. **Change one side, then change its vector file or wire fixture and the other side in the same PR** (below; mirror table in `docs/ARCHITECTURE.md` §2.7b).

**Secrets**
- A credential, address or token is never written into a generated script or a saved config: the user supplies the *name* of an environment variable (`^[A-Za-z_][A-Za-z0-9_]*$`, validated up front in the popup and again by the companion). For the trial run the popup may send a one-time test value as `verificationValues`; it is kept in memory only, never persisted, logged or exported.

**Generated scripts**
- Scripts come from Scriban templates in `language-modules/python/templates/` (the `.j2` extension is historical, the syntax is Scriban). Shared runtime code lives once in `fragments/` and is spliced in with `#@include <name>`; Scriban has no other cross-template include.
- Comments rendered into the generated script are part of the product (they are what an end user reads). A change to rendered output updates the snapshots on purpose (below); with an option off, the script stays byte-identical to before the option existed.
- Exit codes of a generated script: `0` ok, `1` unhandled error, `2` a hardening check with severity Error failed, `3` the external config file is invalid, `4`/`5` preflight: page unchanged / unreachable, `6` the auth bootstrap failed, `7` a page or API request failed, `8` a required Python package is missing, `9` robots.txt disallowed a request (action Abort), `10` the existing output file cannot be appended to, `78` a required environment variable is not set. `PythonScriptVerifier` treats `2` and `78` as compatible with success.
- Selectors are never validated for CSS compatibility up front; a selector that returns nothing fails in the trial run (`422`).

**Companion**
- Configuration precedence: `appsettings.json` < the per-user `companion.settings.json` < environment variables < command line.
- Saved configurations, outputs, blueprints and presets sit behind interfaces (`ISavedConfigStore`, …) with SQLite (default) and MySQL implementations; `/health` and `/generate` never touch storage. Authentication is off by default. Whether a build may use self-signed TLS, plain remote HTTP, or an extension talking to such an address is decided at compile time (Debug vs. Release / the `release` channel), never by a setting.
- The trial run executes the real script, so the machine running the companion needs `python3` with `requests` and `beautifulsoup4` (plus `playwright` + Chromium for the Browser engine, `openpyxl` for Excel output).

**Extension**
- Load `extension/dist/` (after `npm run build`), not `extension/`. Modules are CommonJS bundled by esbuild; there are no page-level globals. The only environment sniffing allowed is `process.env.NODE_ENV === 'test'`, which the build replaces with a constant.
- Popup structure: Architecture Decision #13 (a feature is a `<feature>.js` + `<feature>-ui.js` pair taking a `bridge` for state, never appended to `popup.js`; tests are split the same way).
- User-facing strings exist in `extension/i18n/{de,en,es}.json` and are always changed together. Name a UI element in docs and PRs by its `en.json` value.
- A hint under a control is one line (`hint-length.test.js` caps it at 160/190/200 characters in en/de/es). Longer explanations go behind a "?" help popover (`help.<area>.<field>` in the three dictionaries) or into `docs/user/`, with a "Learn more" link registered in `popup/docs-links.js`.
- A failed Generate is shown in plain language through `popup/error-messages.js` (pattern → title and hint); the raw text stays behind "Details".
- `// @ts-check` JSDoc types (`types/companion-ir.d.ts` = `SFWire`, `types/popup-drafts.d.ts` = `SFDraft`) are functional: keep them, run `npm run typecheck`.

**Tests and documentation**
- `dotnet test companion/ScrapingFactory.sln`, `cd extension && npx jest`, `npm run typecheck`. A feature that runs inside the generated script gets a real end-to-end test that executes the script (the black-box trial run cannot tell many things apart). Anything user-visible also gets a real-browser check in `e2e/examples/` (see `e2e/README.md`).
- Documentation follows the change: user-visible behavior updates `docs/user/` (and its German page, screenshots generated by `e2e/screenshots`); the structural map goes into `docs/ARCHITECTURE.md`; behavior, edge cases and the reasoning for a feature go into the matching `docs/design-notes/` file. Only a rule that applies to *every* change is added to this file.

## Comments

Comments answer what the code cannot: a non-obvious *why*, a constraint, a trap, or a pointer to the one document that explains the design.

- **Models and DTOs** (`IR/*.cs`, the `.d.ts` files, draft shapes): at most one line per property, and only where the name and type do not already say it. Validation rules, which modes allow it and why a default is what it is belong in `docs/design-notes/`. A short class-level summary with a pointer is fine.
- **Functions**: a doc comment only for a non-obvious contract (units, what `null` means, ordering, side effects). Do not restate the name. JSDoc `@param`/`@returns` in `// @ts-check` files are types — keep them.
- **Issue numbers**: keep one where it saves a search (a workaround for a specific bug, a deliberate deviation). Do not use them to date code; history is `git log` and the pull requests.
- **Rationale lives once**, in `docs/design-notes/` (feature behavior) or in Architecture Decisions here (cross-cutting) — not repeated at each call site. When a comment you are trimming holds a design explanation that is not in the docs yet, move it there first.
- **Templates**: comments that never reach the output (Scriban `{{~ ~}}` blocks, `#` lines before rendering) are ordinary code comments. Comments rendered into the generated script are product text: keep them accurate and useful for the end user, and change them only on purpose, with the snapshots updated.
- **Tests**: a comment explains *why a scenario exists* (the regression it pins), not what the next lines do.
- No "added by …, previously …" narration, no commented-out code, no TODO without an issue number.

## Build

```bash
# Build the .NET solution
dotnet build companion/ScrapingFactory.sln

# Build the extension (Issue #389) — esbuild bundles popup, content script,
# MAIN-world recorder and service worker into extension/dist/
cd extension && npm install && npm run build      # npm run build:watch rebuilds on every change

# Load the extension (Chrome/Edge/Opera)
# Extension management → "Load unpacked" → extension/dist/   (NOT extension/)

# Real-browser end-to-end check (Issue #180) — drives the actual unpacked
# extension in a real Chromium against test-pages/, not just Jest's jsdom.
# Manual/on-demand, not part of this or any CI step — see e2e/README.md.
# (The harness rebuilds extension/dist/ itself before every launch.)
cd e2e && npm install && node examples/speisekarte-smoke.js
```

**Security alerts (Dependabot / CodeQL).** `extension/`'s npm dependencies are dev-only (Jest, TypeScript) — nothing from `node_modules` ships in the extension. Transitive alerts are fixed by `npm audit fix` where a patched version exists; the one without a patch (`sprintf-js`, pulled in via Jest → `babel-plugin-istanbul` → `js-yaml@3` → `argparse@1`) is removed from the tree by an `overrides` entry in `extension/package.json` (`argparse` → `^2.0.1`, which has no `sprintf-js` dependency) — safe because js-yaml 3's library code never requires `argparse` (only its CLI in `bin/` does). **NuGet (companion):** `dotnet build` prints NU1902/NU1903 audit warnings for vulnerable packages, also transitive ones (Issue #438: `System.Security.Cryptography.Pkcs` 10.0.0 came in via MailKit → MimeKit and is pinned to the patched 10.0.13 with a direct `PackageReference` in `ScrapingFactory.Companion.csproj` — remove the pin once MimeKit requires a patched version; `dotnet nuget why <csproj> <package>` shows who pulls a package in). CI fails the restore on a high or critical advisory (`-warnaserror:NU1903,NU1904`); moderate ones stay warnings. Check with `dotnet list companion/ScrapingFactory.sln package --vulnerable --include-transitive`. Re-check with `npm audit` after dependency changes; the override can go once Jest's tree no longer reaches `js-yaml@3`. The CI workflow declares `permissions: contents: read` (CodeQL `actions/missing-workflow-permissions`), and the `test-pages/` fixtures build their DOM with `textContent` instead of `innerHTML` (CodeQL `js/xss-through-dom`) — keep that when adding fixtures.

`extension/manifest.json` declares both Chrome/Edge's `side_panel`/`sidePanel` API and the older `sidebar_action`/`sidebarAction` manifest key that Opera (and Firefox) use instead — Opera has no `chrome.sidePanel` API at all, and without `sidebar_action` the toolbar icon did nothing there (see git history, `fix(opera): add sidebar_action ...`). `chrome.sidePanel?.setPanelBehavior(...)` in `service-worker.js` is guarded with optional chaining and is a no-op under Opera; Opera's sidebar opens automatically off the manifest key instead, no JS call needed. Firefox was evaluated as a further target (see closed PR #120) but abandoned — its content-script injection and `"world": "MAIN"` network recorder (API mode) didn't work as expected there, unlike Opera, which is a genuine Chromium fork and needed only the manifest key above.

**Known issue (Chrome/Chromium on Linux):** under tiling Wayland compositors (observed on Hyprland, not fixed by updating the compositor), native `<select>` dropdowns in the side panel can render mispositioned, off-screen — this looks like an upstream Chromium/Ozone-Wayland popup-positioning quirk, not a bug in Scraping Factory. It wasn't reproducible in Opera on the same setup (possibly different Ozone/XWayland defaults; not confirmed), which makes Opera a working alternative for affected users that needs no extra setup beyond loading the same unpacked extension.

## Generated-script snapshot tests (Issue #386)

Every generated script is pinned by a golden file: `companion/ScrapingFactory.Tests/Snapshots/<case>.py`, one per named configuration in `SnapshotCases*.cs` (Static/Browser/API × flat/container/API tree/Blocks/Combined × every feature that changes the script, plus combinations that touch the same template regions). `ScriptSnapshotTests` renders each case through the real `POST /generate` with `skipVerification: true` — the whole pipeline (validation, plan building, Combined/Blocks orchestration, templates) is exercised, but nothing is run: no Python, no network — and compares the result **byte for byte** (CRLF is normalized; `.gitattributes` keeps the files LF). They run in the normal `dotnet test`.

**A template, fragment or code-generator change that alters a script fails these tests on purpose.** If the change is intended, accept it and review the diff of the changed snapshot files like any other code change:

```bash
UPDATE_SNAPSHOTS=1 dotnet test companion/ScrapingFactory.sln --filter Snapshot
git diff companion/ScrapingFactory.Tests/Snapshots/
```

A refactoring that must not change behavior (e.g. sharing template code, Issue #395) is proven by **no** snapshot changing. Update mode also deletes snapshot files whose case no longer exists. On a mismatch the failure message shows the first differing line, writes the full actual script to `$TMP/sf-snapshot-actual/<case>.py` and prints a `diff` command. Cases are wire-format JSON (what the extension sends); add one by registering it in the matching `Register*` method. `SnapshotCoverageTests` keeps the matrix honest: a case may not use a property the IR doesn't know, every settable IR property must appear in some case (or be listed in `NotRendered` with a reason), and snapshots may not contain machine-specific paths or names. Generated output must stay deterministic — no timestamps, random values or absolute paths.

## Contract vectors and wire fixtures (Issue #388)

Where behavior is deliberately implemented twice — the extension's JavaScript and the companion/generated scripts — the two copies are pinned by shared data in `test-vectors/*.json` (file-name sanitizing, transform previews, robots.txt matching, range formats, URL-template matching, the `:contains()` split, environment-variable names), read by a Jest test and an xUnit test (the Python side imports the real helper from a generated script, `PythonContractHarness`). `test-vectors/wire/*.json` are the request bodies the extension's real builders produce for a matrix of popup states: `extension/popup/wire-fixtures.test.js` verifies them byte for byte (`UPDATE_WIRE_FIXTURES=1 npx jest popup/wire-fixtures` accepts a change), `WireFixtureTests.cs` deserializes each strictly into `ScrapingConfig` and sends it through `/generate`. `IrTypeDeclarationTests.cs` compares `extension/types/companion-ir.d.ts` with the C# IR types by reflection. **When you change one side of a mirror, change its vector file (or the fixture) and the other side in the same PR**; the mirror table with the reasoning is in `docs/ARCHITECTURE.md` §2.7b, the file format in `test-vectors/README.md`. A mirror comment in code is now a one-line pointer to its vector file.

## Architecture Decisions

Made during the prototyping phase and actively in use (no longer open questions — changes to them are normal ongoing development, not foundational decisions anymore):

1. **IR schema** — the wire format remains `ScrapingFactory.Compiler.IR.ScrapingConfig` (a fields list, selector as a CSS string, optional attribute, `OutputFormat`; camelCase/string enums, see `CompanionEndpointTests`). Internally, `ScrapingPlanBuilder` translates this into the canonical `ScrapingPlan` (a step sequence of `NavigateStep`/`ExtractStep`), which the code generator and verifier consume — the foundation for future step types (login, waiting, clicks) without breaking the wire format
2. **Extension ↔ companion communication** — a local HTTP server (`http://localhost:5000` by default, configurable — see `docs/design-notes/companion.md` and `extension.md`), no native messaging

A known, ongoing limitation (not an open decision, but a property of the chosen approach):

3. **Selector compatibility** — CSS selectors that don't map 1:1 onto BeautifulSoup/soupsieve (shadow DOM, dynamic classes). This surfaces during script verification in `/generate` (a selector that returns no data → `422`), and is not validated separately. Text-based matching is solved since Issue #227 by the `:contains("text")` suffix (see the Python Templates section).
4. **`ScrapingEngine.Api` as a third engine value** — conceptually, "engine" (how the page is rendered) doesn't quite fit a plain JSON call, but it's the cheapest way to hook into the existing `LanguageModuleRegistry` mechanism. A deliberate compromise, not a hard requirement — a dedicated axis later would be cleaner, but would require significantly more rework for little additional benefit at the current scale (see Issue #53).
5. **API mode: no dependencies between parameters** — the full cartesian product of all parameter value lists is always tried, exactly like the original manual approach. A `404` response per combination is therefore treated as expected and skipped, not as an error. **Partially resolved by Issue #217**: a `DiscoverySource`/`BrowserDiscoverySource` parameter may now reference an earlier-declared parameter's own value (e.g. "week X only exists for category Y" is expressible once category is declared first) — but only as a strict linear chain (declaration order = dependency order, not an arbitrary dependency graph), and only *into* a Discovery-style source's own template string; `RangeSource`/`StaticListSource` can still never be the *dependent* side (neither has a template field a placeholder could even appear in), so most of the original limitation still stands for those. A `404` for a still-genuinely-unrelated combination is unaffected either way.
6. **`ApiGroup`'s repeating-ness is inferred, never an explicit flag** (Issue #54) — unlike `GroupNode.Repeating`, which exists because a CSS selector's match count is a transient runtime fact that could vary page to page (chosen explicitly by the user, never inferred from match count), whether resolving a JSON path yields an array or an object/scalar is a structural, stable property of the API's own schema — so `ApiGroup` simply has no `Repeating` property; at runtime, N matches means N instances, anything else means at most one instance.
7. **`ApiNode` uses a structural discriminator, not a tag** (Issue #54) — `ApiGroup` vs. `ApiField` has the same structural asymmetry as `GroupNode` vs. `DataFieldNode` (a branch has `Children`, a leaf doesn't), which is exactly the reason `ApiParameterSource`'s three variants instead needed an explicit `"kind"` tag (no natural structural tell between them) — that reason simply doesn't apply here, so `IR/ApiNodeJsonConverter` sniffs for a `"children"` property, exactly like `ContainerNodeJsonConverter` already does.
8. **API mode's `OutputFormat` follows response shape, not "being API mode" itself** — flat data (one repetition level, `ItemsPath`/`Fields`) still forces `Csv`; tree data (`Groups`, Issue #54) forces `Xml`, since a tree doesn't fit CSV's column model any more than container mode's own tree does. The rule was really always "flat data → CSV, tree data → XML" — API mode just didn't have a tree-shaped response option until Issue #54. `Json` (Issue #86) fits *either* shape, so it isn't part of this rule — it's a caller-chosen override that yields nothing about mode/shape detection, and both forced defaults above (as well as container mode's own `Xml` default) still apply exactly as before whenever `Json` isn't explicitly requested.
9. **A request-body "variable" is just another `ApiParameter`, referenced by name** (Issue #55) — rather than inventing a second, body-specific value-source concept, `ApiBodyVariable.ParameterName` points into the exact same `ApiConfig.Parameters`/`ApiParameterSource` list a `UrlTemplate` placeholder already resolves against. The only genuinely new concept `ApiConfig.Body` introduces is *where else* a parameter can be referenced from — not a new way to *supply* a value.
10. **The request body is a typed tree (`ApiBodyNode`), not a flat string template like `UrlTemplate`** (Issue #55) — a text-splicing approach would force every substituted value to be a JSON string, which is wrong for GraphQL's `variables` object: GraphQL variables are genuinely typed JSON (numbers, booleans, arrays, objects), so a numeric/boolean parameter needs to reach the body as a real JSON value, not a quoted string (see `ApiBodyVariable.CoerceTo`). A typed tree also composes naturally with a tree-shaped editor UI (Phase B4), reusing the same pattern Issue #54's response tree already established — the "overlap, not identity" between #54 and #55 the original issues themselves flagged.
11. **GraphQL gets no dedicated UI/wire concept anywhere** (Issue #55) — a GraphQL request is, structurally, just an ordinary POST body whose top-level JSON happens to have a `query` key (an ordinary fixed-literal leaf) and a `variables` key (an ordinary nested object subtree, marked up with the same generic fixed/variable-value UI as any other nested POST body). Baking in GraphQL-specific handling would duplicate machinery the generic body tree already provides for free; the only place GraphQL is even mentioned is descriptive documentation/UI hints, never a distinct code path.
12. **`BrowserDiscoverySource` reuses the existing `BrowserAction` wire type instead of a bespoke, interaction-kind-specific shape** (Issue #216) — the issue's own "Proposed approach" first sketched this as Scroll-only fields mirroring `ScrollAction`'s own shape (`ContainerSelector`/`LoadMoreButtonSelector`/`MaxIterations`/`WaitAfterMs`), since the motivating case (penny.de's lazy-loaded category requests) happens to be scroll-triggered. But real sites may need more than scrolling to reveal the requests being watched for — typing into a search box, clicking through pagination, waiting for a client-side redirect — and a Scroll-only source would force a new, bespoke `ApiParameterSource` variant for every other interaction kind later, exactly the one-off-duplication problem Issue #221's future "preparation phase" IR concept exists to avoid (see that issue's own text: "building each of the above as its own one-off mechanism would mean solving 'how does an earlier value flow into a later step' five separate times"). `BrowserDiscoverySource.Actions` instead reuses `List<BrowserAction>` verbatim — the exact same WaitFor/Fill/Click/Scroll vocabulary `ScrapingConfig.BrowserActions` already established for login flows — so one source variant already covers every interaction kind that vocabulary covers, with no new wire concept needed for "type into a search box" or "click to the next page" specifically. This also means `BrowserDiscoverySource` ends up structurally close to Issue #221's own "a preparation phase is an ordered set of steps that run before the plan's main extraction phase and produce a named value" shape — a single parameter's own `{DiscoveryUrl, Actions, <one harvested value list>}` is already exactly that, just scoped to one parameter instead of being a plan-level concept. Issue #221 itself blesses this: "`#216`... can, where practical, ship as its own narrower mechanism ahead of this foundation existing, then be reframed onto it once it does." Shipping `BrowserDiscoverySource` with the generic action list now, rather than Scroll-only fields, is what makes that eventual reframing a reshuffle instead of a rewrite.
13. **New popup features are never just appended to `popup.js`** — this is the lesson the popup module-boundary extraction exists to encode (see "Popup module boundaries" in `docs/design-notes/extension.md`), not just a description of its current state. `popup.js` is the extension's main file precisely because it's easy to reach for; left unchecked, that's exactly how it grew past 4000 lines in the first place. A new feature's state-mutation/wire-format logic belongs in its own `<feature>.js` (or an existing one it clearly extends, e.g. another hardening check joining `settings-panel-ui.js`, another companion endpoint joining `companion-client.js`/`saved-configs-ui.js`), and its DOM rendering/event wiring in the matching `<feature>-ui.js` — both taking a `bridge` parameter for any `_state` access rather than assuming they live in `popup.js`'s own scope. `popup.js` itself only ever gains the few lines needed to import and call into the new module from `render()`/`wireEvents()`. The same split applies to that feature's tests: pure-function coverage goes in `<feature>.test.js` requiring the module directly; DOM/message-flow integration coverage goes in its own `<feature>.test.js` requiring `./popup` (not into the shared `popup.test.js`, for the same reason `popup.js` itself doesn't keep absorbing new code).


## Planned for Future Releases

- **Additional target languages** besides Python (Issue #176 — the architecture is already designed for this, see "Project Overview")

## Consistency Rule

The companion app doesn't just verify at the same rendering stage as the generated script anymore — before delivery, it runs the exact generated script once as a trial (`Backends/Python/PythonScriptVerifier`: write the script to a temporary directory, run it via a `python3`/`python` subprocess, check the exit code and `output.csv`). This rules out any discrepancy between verification and the generated script (encoding, selector compatibility, network errors, runtime errors), and is why a separate Playwright- or AngleSharp-based verification path was rejected: it could only ever have approximated real script behavior.

Before this real execution, `/generate` also runs `IR/ScrapingPlanValidator` as a fast, purely structural pre-check of the `ScrapingPlan` (broken URL, duplicate/empty field names) — this doesn't replace real verification, it just saves the subprocess startup cost for configurations that are always wrong regardless of script behavior. CSS selector syntax/compatibility is deliberately still not checked separately (see point 3 above) — it remains solely the concern of the actual script execution.
