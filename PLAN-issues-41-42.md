# Plan: Issue #41 (ScrollStep) + Issue #42 (Iframe/Shadow-DOM)

**Goal:** enable scraping of dynamically-loaded pages — infinite scroll / "load more" buttons (#41), and content inside iframes / shadow DOM (#42) — for the Browser engine (Playwright).

## How to use this document

This plan is meant to survive across separate Claude Code sessions/conversations that have no memory of how it was derived. Each phase below is self-contained: it states its goal, prerequisites, concrete file-level tasks, and a definition of done.

- Execute one phase at a time via the `feature-workflow` skill (branch from `dev`, small Conventional Commits, tests, PR against `dev`, never self-merge).
- Suggested branch name is given per phase.
- Check off tasks (`- [ ]` → `- [x]`) directly in this file as they're completed, and commit the updated plan file alongside the phase's work, so progress is visible to whoever picks this up next.
- Do not start a phase whose "Depends on" phase hasn't been merged into `dev` yet.
- Where a phase requires a decision that materially changes scope, it's marked **OPEN DECISION** — resolve this with the user (e.g. via `AskUserQuestion`) before writing code for that part, don't assume.

## Source issues

- Issue #41 — `feature: Scroll-/Load-More-Step für Infinite Scroll (Browser-Engine)`
- Issue #42 — `feature: Iframe-/Shadow-DOM-Unterstützung für Selektoren`

(Fetch full text via `gh issue view 41` / `gh issue view 42` if needed — not reproduced here in full, see summaries in each phase below.)

## Relevant architecture facts (as of this plan's writing — re-verify file:line references, code drifts)

- IR step types live in `companion/ScrapingFactory.Compiler/IR/ScrapingStep.cs`: `NavigateStep`, `ExtractStep`, `WaitForStep`, `FillStep`, `ClickStep`, `ScrollStep` (added in Phase 1), `ExtractGroupStep`, `ApiCallStep`. All inherit an empty abstract `ScrapingStep` marker class.
- `ScrapingPlanBuilder` (`IR/ScrapingPlanBuilder.cs`) is the **only** place that turns the wire format `ScrapingConfig` into IR `ScrapingPlan` steps. Before Phase 1, it never built `WaitForStep`/`FillStep`/`ClickStep` — there was no field on `ScrapingConfig` for them. Phase 1 closed this gap generically via `ScrapingConfig.BrowserActions` (see Phase 1 below) rather than adding a `ScrollStep`-only special case.
- `ScrapingPlanValidator` (`IR/ScrapingPlanValidator.cs`) rejects `WaitForStep`/`FillStep`/`ClickStep`/`ScrollStep` when `plan.Engine != ScrapingEngine.Browser`. Any new browser-only step needs the same guard.
- `PythonPlaywrightCodeGenerator` (`companion/ScrapingFactory.Compiler/Backends/Python/PythonPlaywrightCodeGenerator.cs`) renders each step type via a `switch` expression over `plan.Steps`, each case rendering one embedded Scriban template fragment (e.g. `playwright_click_step.py.j2`, `playwright_wait_step.py.j2`, `playwright_scroll_step.py.j2` — 8-space indented to match the `with sync_playwright() as p:` body). The joined fragments (`actions`) are inserted verbatim into `playwright_scraper.py.j2` between `page = browser.new_page()` and the extraction code. This `actions` block is reused unchanged by `playwright_scraper_grouped.py.j2` (container mode), so any new action step automatically works in both flat and container mode with no extra wiring.
- Extraction in the Browser engine uses the older `query_selector`/`query_selector_all` idiom (`playwright_scraper.py.j2`, `playwright_scraper_grouped.py.j2`'s `extract_group()`), **not** the newer Playwright `Locator` API. This matters for Phase 2 (frame_locator needs the Locator API).
- Playwright's own selector engine pierces open shadow roots automatically for plain CSS selectors passed to `query_selector`/`query_selector_all`/`locator` — this likely needs no codegen change for shadow DOM, only verification.
- `PythonScriptVerifier` (`companion/ScrapingFactory.Compiler/Backends/Python/PythonScriptVerifier.cs`) runs the rendered script as a subprocess and checks exit code + non-empty output file, under `_timeout + extraTimeout` (Phase 1 added `extraTimeout` as an additive optional parameter on `IScriptVerifier.VerifyAsync`/`PythonScriptVerifier.VerifyAsync`, so a caller that knows the plan — `Program.cs`'s `/generate` handler — can ask for extra headroom beyond the verifier's own 45s baseline for a plan whose configured behavior can genuinely take longer, e.g. a `ScrollStep`'s `MaxIterations × WaitAfterMs`).
- `companion/ScrapingFactory.Tests/LocalTestServer.cs` serves inline HTML strings for existing Playwright end-to-end tests (see `PythonPlaywrightScriptVerifierTests.cs`) — this is the established pattern for **automated** tests, distinct from the **manual/interactive** test pages this plan adds under `test-pages/`.
- `test-pages/` already exists in the repo root with `test-pages/speisekarte/index.html` and (as of Phase 1) `test-pages/infinite-scroll/index.html` — one self-contained `index.html` per subfolder, realistic-looking styled content, `lang="de"`, servable via e.g. `python3 -m http.server` from inside the subfolder.
- No extension UI exists today for engine selection or for configuring `FillStep`/`ClickStep`/`WaitForStep`/`ScrollStep` — `buildScrapingConfig` in `extension/popup/popup.js` never emits an `engine` or `browserActions` field, so `ScrapingConfig.Engine` always defaults to `Static` from the extension's point of view. This is a pre-existing, deliberate gap (see CLAUDE.md, "Planned for Future Releases").
- Existing polymorphic wire-format precedent: `ApiParameter.Source` (`IR/ApiConfig.cs`) is discriminated via `[JsonPolymorphic]`/`[JsonDerivedType]` with an explicit `"kind"` field. Phase 1's `BrowserAction` (`IR/BrowserAction.cs`) follows the same pattern (`"kind": "waitFor" | "fill" | "click" | "scroll"`). Keep this in mind for any other new polymorphic wire field.

## Decisions already locked in (do not re-litigate)

1. **UI is phased separately from backend.** Phases 1-4 are backend/IR/codegen only, reachable via the companion HTTP API (like `curl`/manual `/generate` calls), not via the extension UI. Phases 5-7 add extension UI on top, once the backend exists.
2. **`ScrollStep` abort criterion:** combine a hard cap (`MaxIterations`) with an earlier stop signal — see "Design notes from Phase 1" below for what that signal actually needs to be (this evolved during implementation, learn from it before touching this code again).
3. **Test pages are required, not optional**, and live under `test-pages/<name>/index.html`, one per issue, checked into the repo permanently (not throwaway).

## Design notes from Phase 1 (read before modifying ScrollStep or writing Phase 2's iframe scroll/action support)

Two real bugs were found only through **manual** testing against a real page (`test-pages/infinite-scroll/index.html`) — the automated `LocalTestServer`-based tests initially missed both because the synthetic HTML happened to sidestep them. Both are fixed in the code as it stands now, but the underlying lessons matter for Phase 2 too (iframe scrolling/clicking will hit the same class of issue):

1. **A "load more" button's own disappearance is a more reliable stop signal than page height.** Initially the stop condition was purely "has `document.body.scrollHeight` stopped growing" — but if newly-loaded content still fits within the current viewport/container, height never grows at all even though real content did load, so the loop gave up after round 1. Fix: when `LoadMoreButtonSelector` is set, the loop's *only* stop condition is "the button no longer matches anything" (checked before each click) — height is not consulted at all in that branch. Height-stability remains the only available signal when there's no button (pure scroll).
2. **The height-stability check must measure whatever was actually scrolled, not always `document.body.scrollHeight`.** When `ContainerSelector` is set (a bounded, independently-scrollable box — its own scrollbar, not the page's), the box growing internally does not change the surrounding page's body height at all — checking `document.body.scrollHeight` in that case falsely detects "no growth" after round 1 regardless of how much the container itself grew. Fix: the height check reads `el.scrollHeight` on the `ContainerSelector` element when one is set, and `document.body.scrollHeight` otherwise.

Consequence for Phase 2: any frame-aware equivalent of these checks (e.g. scrolling/clicking something inside an iframe) needs the same care about *which* document/element's height or presence is actually meaningful to check — don't default to `document.body` without thinking about scope, and prefer a presence/absence signal over a height comparison wherever one is available (it's strictly more reliable).

Also worth knowing: `test-pages/infinite-scroll/index.html`'s scrollable box (`#feed`) is deliberately short (`max-height: 160px`) so the very first batch already overflows it — a container that doesn't overflow on the first render never fires a native `scroll` event no matter how many times `scrollTop` is programmatically set to `scrollHeight`, because the browser only fires `scroll` when the position actually changes. Keep this in mind if this test page's content/styling is ever adjusted.

---

## Phase 1 — `ScrollStep` backend (Issue #41) — ✅ DONE

**Branch:** `feature/scroll-step-backend`
**Depends on:** nothing (can start immediately)

### Scope

Implement infinite-scroll / "load more" support for the Browser engine, reachable via the companion HTTP API. Also closes the pre-existing gap that browser-action steps (`WaitForStep`/`FillStep`/`ClickStep`) have no wire-format representation, by introducing a single generic mechanism that `ScrollStep` needs anyway.

### Tasks

- [x] **Test page:** `test-pages/infinite-scroll/index.html` — self-contained HTML/JS, German (`lang="de"`), styled like `speisekarte`. Two sections in one page: "Neueste Beiträge" (`#feed`, a bounded scrollable box, 47 posts total, batches of 5 — tests `ContainerSelector`) and "Kleinanzeigen" (`#classifieds` + `#load-more-classifieds` button, 18 ads total, batches of 6, button removes itself when done — tests `LoadMoreButtonSelector`). Manually verified end-to-end against a running companion instance: both sections retrieve the full, correct item count (47 and 18 respectively), not just the first batch.
- [x] **IR — new step type** `ScrollStep` in `IR/ScrapingStep.cs`: `ContainerSelector?`, `LoadMoreButtonSelector?`, `MaxIterations = 10`, `WaitAfterMs = 1000`.
- [x] **IR — wire format** `IR/BrowserAction.cs`: polymorphic `BrowserAction` (`WaitForAction`/`FillAction`/`ClickAction`/`ScrollAction`), discriminated via `"kind"`. `ScrapingConfig.BrowserActions` (`List<BrowserAction>?`) added in `IR/ScrapingConfig.cs`.
- [x] **`ScrapingPlanBuilder`**: translates `config.BrowserActions` (in order) into IR steps via a private `ToStep` mapper, inserted after `NavigateStep` and before extraction (Fields/Groups/Api alike).
- [x] **`ScrapingPlanValidator`**: `ScrollStep` added to the existing Browser-only-step guard; field validation for `MaxIterations > 0`, `WaitAfterMs >= 0`, non-blank `ContainerSelector`/`LoadMoreButtonSelector` when set.
- [x] **Codegen**: `language-modules/python/templates/playwright_scroll_step.py.j2` (registered as an embedded resource in `ScrapingFactory.Compiler.csproj`), new `switch` case in `PythonPlaywrightCodeGenerator`. See "Design notes from Phase 1" above for the two behavioral bugs that were found and fixed here.
- [x] **Verifier timeout**: `IScriptVerifier.VerifyAsync`/`PythonScriptVerifier.VerifyAsync` gained an additive `extraTimeout` parameter (`effectiveTimeout = _timeout + extraTimeout`). `Program.cs`'s `/generate` handler computes it as `Σ(MaxIterations × WaitAfterMs)` across all `ScrollStep`s in the plan and passes it through — scripts without a `ScrollStep` keep the tight default.
- [x] **Tests** (199 total in the suite, all green):
  - `PythonPlaywrightCodeGeneratorTests.cs`: `ScrollStep` fragment rendering (scroll-only and scroll+container+button).
  - `ScrapingPlanValidatorTests.cs`: Browser-only guard, field validation.
  - `ScrapingPlanBuilderTests.cs`: `BrowserActions` → steps translation and ordering, including alongside `Groups`.
  - `PythonPlaywrightScriptVerifierTests.cs`: three real end-to-end (`LocalTestServer` + actual Chromium subprocess) tests — pure scroll, `ContainerSelector` (the regression test for bug #2 above), `LoadMoreButtonSelector` (bug #1 above).
  - `CompanionEndpointTests.cs`: `BrowserActions` wire format round-trip through `/generate`, and the Browser-engine-required 400 case.

### Definition of done

- [x] `/generate` accepts a `ScrapingConfig` with `engine: "Browser"` and a `BrowserActions` list containing a `scroll` action, and returns a verified, working script.
- [x] Manually confirmed against `test-pages/infinite-scroll/index.html` (served locally via `python3 -m http.server`, companion running via `dotnet run`) that the generated script retrieves all items for both the `ContainerSelector` and `LoadMoreButtonSelector` cases, not just the first batch.
- [x] All new + existing tests green (199/199).

---

## Phase 2 — Iframe/Shadow-DOM backend (Issue #42)

**Branch:** `feature/iframe-shadow-dom-backend`
**Depends on:** nothing structurally, but do this after Phase 1 so the `BrowserActions`/wire-format pattern already exists to reuse if needed.

### Scope

Shadow DOM likely needs no codegen change (Playwright pierces it automatically for plain CSS selectors) — mostly a verification task. Iframes need real work: cross-frame detection in the extension's content script, and frame-aware extraction in codegen.

**Before writing any code here, read "Design notes from Phase 1" above** — the same class of "which document/element am I actually checking" bug is very likely to recur for frame-scoped actions/extraction.

### Spike (done — answers recorded below)

- [x] **Spike A — cross-origin iframes**: confirmed empirically, not just from docs. Built a throwaway extension (`matches: ["<all_urls>"]`, `all_frames: true`, a content script that stamps `document.documentElement.setAttribute('data-sf-injected', location.href)`), loaded it into a real headless Chromium via Playwright's `launch_persistent_context` (`--load-extension`/`--disable-extensions-except`), and pointed it at a top page on `http://127.0.0.1:9001` embedding an iframe served from `http://127.0.0.1:9002` (different port = different origin = genuinely cross-origin). The content script ran and mutated the DOM in **both** the top frame and the cross-origin iframe. **Conclusion: cross-origin iframes are fully inspectable** — content-script injection is governed purely by the frame's own URL matching `matches`, not by any relationship to the top frame's origin. No special `host_permissions` needed beyond what's already declared (`<all_urls>` already covers it). No fallback/error-messaging design is needed for this — it just works.
- [x] **Spike B — Locator API migration scope**: confirmed via runtime introspection (`hasattr` on the actual installed Playwright Python classes) rather than assumption. `FrameLocator` has `.locator()` and `.frame_locator()` (for chaining into nested iframes) but genuinely no `query_selector`/`query_selector_all` — any frame-scoped access must use the `Locator` API, no way around that. The important discovery: `ElementHandle` (what `query_selector_all` returns today) and `Locator` (what `FrameLocator.locator(...).all()` returns) **share the same method names** for extraction — both have `.text_content()` and `.get_attribute(name)`. That means the extraction/attribute-reading code itself doesn't need to know or care which flavor of object it got; only the *selector-resolution* step (how to get from a CSS selector string to a list of element-like objects) needs to branch on whether `FramePath` is set. **Decision: option (b)** — keep `query_selector`/`query_selector_all` completely unchanged for the no-`FramePath` case (the vast majority of usage, and all of Phase 1's already-shipped, well-tested functionality), and add a small parallel resolver used only when `FramePath` is set, e.g. a template-level helper that chains `page.frame_locator(sel)...` and calls `.locator(selector).all()`, returning objects the existing downstream code (attribute/text extraction, CSV writing) can consume exactly like it already does for `ElementHandle`. Reasoning: option (a) (migrate everything to `Locator`) would touch every currently-shipped code path (flat, container, and Phase 1's `ScrollStep`/action steps) for a feature that's opt-in — unjustified blast radius and regression risk for functionality the diff doesn't need to touch.

### Scope decision (resolved with the user, 2026-08-30)

`FramePath` in **this** phase is scoped to flat-mode `ExtractStep` only — the core case Issue #42 is actually about (extracting data that lives inside an iframe). Container-mode nodes (`DataFieldNode`/`GroupNode`) and the Phase 1 browser-action steps (`WaitForStep`/`FillStep`/`ClickStep`/`ScrollStep`) were deliberately *not* folded into this phase to keep it reviewable — but the user asked that they not be pushed to "the end" either. They're their own phases, **Phase 3** and **Phase 4** below, positioned immediately after this one (before the UI phases) since they're backend work that naturally belongs together with this phase rather than after the UI phases. Do Phase 3/4 back-to-back with Phase 2 if that's still the active train of thought when Phase 2 lands — no need to context-switch to UI work in between if backend momentum is there.

### Tasks

- [x] **Test page:** `test-pages/iframe-shadow-dom/index.html` — self-contained, German, styled consistently with `speisekarte`/`infinite-scroll`. One `TechShop24` product page with: a top-level price marker (sanity baseline), a "Preisvergleichs-Widget" iframe (`?level=1` — same file, query-string-driven, see below), a "Bewertungs-Widget" iframe nested *inside* that one (`?level=2`), and a "Versand-Badge" attached via an **open** shadow root. Each marker has a distinguishable value (129,00 €, 124,50 €, "4,7 / 5 (312 Bewertungen)", "0,00 € (Prime)").
  - **Important finding, don't redo this mistake:** the obvious way to keep nested iframes in one self-contained file would be `<iframe srcdoc="...">` — verified empirically (same throwaway-extension methodology as Spike A) that Chrome does **not** inject content scripts into `about:srcdoc` iframes, even with `all_frames: true` and `matches: ["<all_urls>"]`. The test page instead uses one file serving itself recursively via `?level=1`/`?level=2` query-string routing (real HTTP requests, real distinct documents, real injection).
- [x] **Content script** (`extension/content/content-script.js`, `extension/manifest.json`):
  - `all_frames: true` added to the `content-script.js` manifest entry (the `api-capture.js`/MAIN-world entry was deliberately left alone — network recording staying top-frame-only is fine, API-mode is unrelated to this issue).
  - Frame-path resolution is a small recursive `postMessage` protocol (`resolveFramePath()`/`handleFramePathMessage()`/`findIframeSelectorForWindow()`), not a single-hop lookup — see "Design notes from Phase 2" below for why `window.frameElement` doesn't work here and how the protocol is structured.
  - `buildSelector`'s boundary logic needed **no change at all** — the original task description assumed it would, but `document` is already frame-local for a content script running inside an iframe (each frame gets its own execution context), so `document.body` was already the right boundary automatically.
  - Found and fixed a real, previously-latent bug while testing shadow DOM: `onClick`/`onMouseOver` used `e.target` directly, which the browser retargets to the shadow **host** for any listener outside the shadow tree (standard event retargeting, applies to open shadow roots too) — so a shadow-DOM click always built a selector for the host, never the actual clicked element. Fixed via `event.composedPath()[0]` instead of `e.target` (see "Design notes" below).
- [x] **Background service worker**: turned out to need **no changes at all** — the task description assumed frame-targeted relay would be needed, but the actual design broadcasts `START_SELECTION` to every frame (already how `chrome.tabs.sendMessage` without a `frameId` behaves once `all_frames: true` is set) and lets whichever frame the click actually happened in report back its own `framePath` — no server-side frame targeting needed. What *did* need changing: guarding the "whole-page" message types (`ENABLE_DOM_VIEW`/`DISABLE_DOM_VIEW`/`PREVIEW_START`/`PREVIEW_STOP`/`GET_LOGS`/`CHECK_ROBOTS_TXT`) in `content-script.js` itself to only act in the top frame (`window === window.top`) — otherwise every frame would independently respond, corrupting `GET_LOGS`/`CHECK_ROBOTS_TXT`'s one-shot `sendResponse()` and duplicating `DOM_TREE`/`PREVIEW_RESULT` messages.
- [x] **IR**: `FramePath` (`List<string>?`) added to `ExtractStep` and its wire-format mirror `ScrapingField`, threaded through `ScrapingPlanBuilder`.
- [x] **Codegen**: `playwright_scraper.py.j2` gained `FRAME_PATHS` (a per-field dict, same conditional-inclusion pattern as `ATTRIBUTES`) and `_resolve_elements(page, selector, frame_path)`, called instead of `page.query_selector_all` directly — the downstream extraction loop is byte-for-byte unchanged, exactly as Spike B predicted.
- [x] **`ScrapingPlanValidator`**: `FramePath` set on an `ExtractStep` requires `Engine == Browser`, plus non-empty/non-blank-segment validation.
- [x] **Tests**: `PythonPlaywrightCodeGeneratorTests.cs` (fragment rendering), `ScrapingPlanValidatorTests.cs` (guard + field validation), `PythonPlaywrightScriptVerifierTests.cs` (real Chromium end-to-end: single iframe, doubly-nested iframe, mixed framed/unframed fields, shadow DOM) — **all passed on the first run**, unlike Phase 1's `ScrollStep` bugs, which is itself informative: Spikes A/B's upfront empirical verification (rather than assumption) is what made the difference. `content-script.test.js` (jsdom): `findIframeSelectorForWindow` (real jsdom `<iframe>` + `.contentWindow`) and `resolveFramePath`'s top-frame base case — jsdom's `window.top` is non-configurable (verified directly — `Object.defineProperty` throws `TypeError: Cannot redefine property: top`), so the actual cross-frame `postMessage` round trip and the non-top-frame message-listener guards are **not** unit-testable in jsdom; both were instead verified against a real loaded extension in real Chromium (see below).
- [x] **Manual, real-extension verification** (beyond what the task list originally asked for, and worth repeating for Phase 3/4): loaded the actual unpacked extension into a real Chromium via Playwright's `launch_persistent_context`, opened `popup.html` as a real extension page to send `START_SELECTION`/observe forwarded messages (same relay path the real popup uses), and clicked all four markers on `test-pages/iframe-shadow-dom/index.html`. Captured `ELEMENT_SELECTED` messages had exactly the expected `selector`/`framePath` for all four cases (`null` for top-level and shadow DOM, `["#price-widget"]` for the iframe, `["#price-widget", "#reviews-widget"]` for the nested iframe). Then fed those exact captured values into a real `/generate` call against a running companion instance and ran the resulting script: all four values (`129,00 €` / `124,50 €` / `4,7 / 5 (312 Bewertungen)` / `0,00 € (Prime)`) came back correctly in `output.csv` — a genuine end-to-end proof, extension click through to extracted data, not just each half tested in isolation.

### Design notes from Phase 2 (read before touching frame-path code again — Phase 3/4 reuse this)

1. **`window.frameElement` doesn't work for this.** It only resolves for same-origin frames — cross-origin access is blocked by the standard same-origin policy, regardless of the content script's elevated injection privileges (Spike A's cross-origin *injection* success doesn't extend to cross-origin *DOM reads* — those are two different restrictions). So a frame can't self-report "here's the `<iframe>` element that embeds me." Instead, the **parent** is asked (`postMessage`, which works across origins by design): "which of your `<iframe>` elements has a `contentWindow` matching me?" (`findIframeSelectorForWindow`, matched via `event.source`). This recurses naturally: a parent, when answering a child, first resolves *its own* frame path the same way (asking *its* parent), so one `postMessage` round trip per nesting level, correlated via a `requestId`, resolves the whole chain top-to-bottom.
2. **Event retargeting breaks naive `e.target` use for shadow-DOM elements.** A click inside an *open* shadow root still gets retargeted to the shadow host for a listener registered outside the shadow tree (this isn't a closed-root-only thing) — `event.composedPath()[0]` is the fix, giving the true un-retargeted originating element. This was only found because the shadow-DOM part of the test page was actually clicked through manually — the `LocalTestServer`-based backend tests can't catch this at all, since it's purely a content-script/DOM-event concern, not something the generated Python script or the companion ever sees.
3. **Two of the four original task bullets ("update `buildSelector`'s boundary logic", "extend the service worker relay with `frameId`") turned out to be unnecessary** once actually implemented — both were reasonable guesses written before the actual design existed, but the real design (frame-local `document`, broadcast-and-let-the-right-frame-respond) didn't need either. Worth remembering when reading a plan written by a *previous* session: task descriptions are a best guess at design time, not a guaranteed shape — verify against the actual code before assuming a bullet still applies.

### Definition of done

- [x] Spike A and B answers recorded in this file.
- [x] Manually confirmed against `test-pages/iframe-shadow-dom/index.html` that: shadow-DOM content is extracted without any `FramePath`; single- and nested-iframe content is extracted correctly using `FramePath` produced by the updated content script.
- [x] All new + existing tests green (211 backend + 380 extension).

---

## Phase 3 — `FramePath` for Container-Mode (Issue #42, extended scope)

**Branch:** `feature/iframe-container-mode`
**Depends on:** Phase 2 merged (needs `FramePath`'s IR shape and the `Locator`-based resolver helper to already exist and be proven working for the flat case before reusing the pattern recursively).

### Scope

Extends `FramePath` support to `DataFieldNode`/`GroupNode` so container-mode (nested group) extraction can also pull data out of an iframe — e.g. a menu/listing structure that itself lives inside an iframe, or where one nested group happens to be sourced from a different iframe than its siblings.

The content-script side (`resolveFramePath`/`findIframeSelectorForWindow`/the `event.composedPath()` fix) already exists from Phase 2 and needs no changes for this phase — container-mode click-based selection goes through the same `onClick` handler. This phase is IR/codegen/validator only.

### Tasks

- [ ] **IR**: add `FramePath` (`List<string>?`, default `null`) to `DataFieldNode` and `GroupNode` (`IR/ContainerNode.cs`).
- [ ] **Codegen**: `playwright_scraper_grouped.py.j2`'s `extract_group()` currently takes a single `scope` (either `page` or a previously-matched `ElementHandle`) and calls `scope.query_selector_all(node["selector"])`/`scope.query_selector(node["selector"])` uniformly. Extend it to resolve a per-node scope via the same `FramePath`-aware resolver introduced in Phase 2 when `node.get("frame_path")` is set, instead of using the inherited `scope` — needs a per-node decision, not just a whole-tree one, since only some nodes in a tree might be framed. Reuse `PythonGroupTreeLiteral` to bake `frame_path` into each node's dict literal alongside `selector`/`name`/etc.
- [ ] **`ScrapingPlanValidator`**: extend `ValidateContainerNodes` with the same Browser-only-when-`FramePath`-is-set guard as `ExtractStep`.
- [ ] **Tests**: `PythonGroupCodeGeneratorTests`/`PythonPlaywrightScriptVerifierTests` cases for a group tree with a framed node (and a mix of framed + non-framed siblings, since that's the actual point of doing this per-node instead of per-tree). Manually verify against an extended/reused iframe test page.

### Definition of done

- Container-mode extraction works correctly when one or more nodes in the tree have a `FramePath` set, including mixed framed/non-framed siblings in the same tree.
- All new + existing tests green.

---

## Phase 4 — `FramePath` for Browser-Action Steps (Issue #42, extended scope)

**Branch:** `feature/iframe-action-steps`
**Depends on:** Phase 2 merged (same resolver-reuse rationale as Phase 3; independent of Phase 3 itself, could be done in either order or in parallel).

### Scope

Extends `FramePath` support to `WaitForStep`/`FillStep`/`ClickStep`/`ScrollStep` (Phase 1) — e.g. clicking a cookie-consent button that lives inside an iframe before extraction can proceed, or filling a login form embedded via iframe (a common real-world pattern, e.g. some SSO widgets).

### Tasks

- [ ] **IR**: add `FramePath` (`List<string>?`, default `null`) to `WaitForStep`, `FillStep`, `ClickStep`, `ScrollStep` (`IR/ScrapingStep.cs`), and to the matching wire-format `BrowserAction` variants (`IR/BrowserAction.cs`).
- [ ] **Codegen**: unlike Phase 2/3's "get a list of elements" resolver, these steps need an "does exactly one element exist right now" resolution — `Locator.count()` (a synchronous, non-waiting check) rather than `query_selector`'s "returns `None` immediately if absent" semantics, since actions on a `FrameLocator`-scoped `Locator` (e.g. `.click()`) auto-wait/retry by default unlike `ElementHandle.click()`. Design this resolution helper carefully and **verify it manually against a real page before trusting it** — Phase 1's two bugs (button-presence vs. height, wrong-scope height check) both came from an untested assumption about a Playwright API's exact behavior; don't repeat that here with `Locator.count()`/auto-waiting semantics.
- [ ] **`ScrapingPlanValidator`**: extend field validation for each of the four step types with the same Browser-only-when-`FramePath`-is-set guard.
- [ ] **Tests**: `PythonPlaywrightScriptVerifierTests` cases for each of the four step types with `FramePath` set (e.g. a login form embedded via iframe, mirroring the existing `LoginFlow_FillsCredentialsFromEnvironmentAndClicksSubmit` test but with the form inside an iframe). Manually verify against a real page, not just `LocalTestServer`.

### Definition of done

- All four Phase 1 action steps can target a selector inside an iframe via `FramePath`, wired end-to-end from `BrowserActions` through to the generated script.
- All new + existing tests green.

---

## Phase 5 — Extension UI: Browser-engine baseline

**Branch:** `feature/browser-engine-ui`
**Depends on:** nothing structurally (this closes a pre-existing gap independent of #41/#42), but do it after Phase 1 so `BrowserActions` (which this UI needs to populate) already exists on the wire format.

### Scope

Add the missing engine selection and browser-action configuration UI to the extension — today `popup.js` never sends an `engine` field and there's no UI for `FillStep`/`ClickStep`/`WaitForStep` at all. This phase does **not** add Scroll- or iframe-specific UI yet (see Phases 6-7).

### Tasks

- [ ] Add an engine selector (Static/Browser) to `extension/popup/popup.html`/`popup.js`, wired into `buildScrapingConfig`.
- [ ] Add UI for configuring an ordered list of browser actions (`WaitForStep`/`FillStep`/`ClickStep`) when `Engine = Browser` is selected — reuse the existing credential/env-var UI pattern already used for API-mode headers (`FillStep`'s env-var value source) as precedent.
- [ ] Wire this UI's output into the `BrowserActions` field of the request body sent to `/generate`.

### Definition of done

- A user can, purely through the extension UI, configure a login flow (fill + click + wait) against a real page and download a working script — no direct companion API call needed.

---

## Phase 6 — Extension UI: `ScrollStep` configuration

**Branch:** `feature/scroll-step-ui`
**Depends on:** Phase 1 (backend) + Phase 5 (browser-action UI baseline)

### Tasks

- [ ] Add a "Scroll / Load more" action type to the browser-action list UI from Phase 5, with fields for container selector (optional, click-to-select like other selectors), load-more button selector (optional, click-to-select), max iterations, wait time.
- [ ] Manually verify end-to-end against `test-pages/infinite-scroll/index.html`.

### Definition of done

- A user can configure infinite-scroll/load-more scraping entirely through the extension UI and download a working script.

---

## Phase 7 — Extension UI: Iframe/Shadow-DOM support

**Branch:** `feature/iframe-ui`
**Depends on:** Phase 2 (backend, minimum) + Phase 5 (browser-action UI baseline). Phases 3/4 aren't a hard dependency but make this phase materially more useful (framed container/action-step configuration) — check whether they've landed and adjust scope accordingly.

### Tasks

- [ ] Visual feedback during click-based selection when the hovered/clicked element is inside an iframe (analogous to the existing DOM tree highlighting) — at minimum, indicate the frame path being recorded.
- [ ] (Cross-origin iframes need no special-casing per Phase 2's Spike A — they're fully inspectable, so no fallback/error UI is needed for that case specifically.)
- [ ] Manually verify end-to-end against `test-pages/iframe-shadow-dom/index.html`.

### Definition of done

- A user can select data inside an iframe (including nested iframes) purely through the extension UI and download a working script.

---

## Suggested execution order

1. ~~Phase 1 (independent)~~ ✅ done
2. ~~Phase 2 — flat `ExtractStep` FramePath (independent, but benefits from Phase 1's wire-format pattern existing first)~~ ✅ done
3. Phase 3 — container-mode `FramePath` (needs Phase 2 merged)
4. Phase 4 — action-step `FramePath` (needs Phase 2 merged; independent of Phase 3, either order/parallel is fine)
5. Phase 5 — browser-engine UI baseline (needs Phase 1 merged for `BrowserActions` to exist; otherwise independent of 2/3/4)
6. Phase 6 — ScrollStep UI (needs 1 + 5 merged)
7. Phase 7 — Iframe UI (needs 2 + 5 merged at minimum; more useful with 3/4 also merged)

Phase 5 can be worked in parallel with Phases 2/3/4 by a different session/branch if desired, since it doesn't depend on any of them.
