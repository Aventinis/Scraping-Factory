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

## Phase 3 — `FramePath` for Container-Mode (Issue #42, extended scope) — ✅ DONE

**Branch:** `feature/iframe-container-mode`
**Depends on:** Phase 2 merged (needs `FramePath`'s IR shape and the `Locator`-based resolver helper to already exist and be proven working for the flat case before reusing the pattern recursively).

### Scope

Extends `FramePath` support to `DataFieldNode`/`GroupNode` so container-mode (nested group) extraction can also pull data out of an iframe — e.g. a menu/listing structure that itself lives inside an iframe, or where one nested group happens to be sourced from a different iframe than its siblings.

The content-script side (`resolveFramePath`/`findIframeSelectorForWindow`/the `event.composedPath()` fix) already exists from Phase 2 and needs no changes for this phase — container-mode click-based selection goes through the same `onClick` handler. This phase is IR/codegen/validator only.

### Tasks

- [x] **IR**: `FramePath` (`List<string>?`, default `null`) added to `DataFieldNode` and `GroupNode` (`IR/ContainerNode.cs`) — same "absolute path from the top document, not inherited from an ancestor's FramePath" semantic as `ExtractStep.FramePath`, documented explicitly on both since container-mode is the first place that semantic actually gets tested (a flat `ExtractStep` has no ancestor to be ambiguous about).
- [x] **Codegen**: `playwright_scraper_grouped.py.j2`'s `extract_group()` now takes `page` as an explicit third parameter (threaded through every recursive call) alongside `scope`/`node`, since `frame_path` resolution always starts fresh from `page` regardless of nesting depth — `scope` alone was never enough once a node's own `frame_path` needed resolving independently of its ancestors. Two small resolver functions, `_resolve_group_matches`/`_resolve_field_match`, are the only things that branch on `node.get("frame_path")`; everything downstream (the recursive walk, XML element building) is unchanged. **Design note, worth knowing if this code is touched again:** `Locator` (what a `FrameLocator` chain returns) has no `query_selector`/`query_selector_all` of its own — a resolved *group* match is converted to an `ElementHandle` via `.element_handle()` immediately after resolution, specifically so every recursive call into a framed group's children can keep using `scope.query_selector(...)` completely unchanged, exactly as if the group had never been framed at all. `PythonGroupTreeLiteral` bakes `frame_path` into each node's dict literal the same "omit the key entirely when null" way `attribute` already does, via a new shared `PythonLiteral.StrList` helper.
- [x] **`ScrapingPlanValidator`**: `ValidateContainerNodes` now takes the plan's `Engine` and checks `FramePath` on both `GroupNode` and `DataFieldNode` via a new shared `ValidateFramePath` helper (also now used by `ExtractStep`'s check from Phase 2, replacing what used to be three copies of the same three checks).
- [x] **Tests**: `PythonPlaywrightCodeGeneratorTests.cs` (resolver helpers present, `frame_path` in/omitted from the tree literal correctly per-node), `ScrapingPlanValidatorTests.cs` (Browser-only guard + field validation on both node types), `PythonPlaywrightScriptVerifierTests.cs` (two real end-to-end Chromium tests: a framed *group* whose children extract normally from within it; a mix of one plain sibling field and one field framed into a completely separate shared iframe). **All passed on the first run** — same "spikes/prior-phase design notes paid off" pattern as Phase 2. Also manually verified against the real (already-existing) `test-pages/iframe-shadow-dom/index.html` via two live `/generate` calls against a running companion (not `LocalTestServer`): a non-repeating group scoped into `#price-widget` correctly extracted `124,50 €`; a mixed-siblings group (one plain top-level field, one field framed two levels deep into `#price-widget` → `#reviews-widget`) correctly extracted both `129,00 €` and `4,7 / 5 (312 Bewertungen)` in the same `<Produkt>` element.

### Definition of done

- [x] Container-mode extraction works correctly when one or more nodes in the tree have a `FramePath` set, including mixed framed/non-framed siblings in the same tree.
- [x] All new + existing tests green (223 backend; extension suite untouched by this phase, still 380).

---

## Phase 4 — `FramePath` for Browser-Action Steps (Issue #42, extended scope) — ✅ DONE

**Branch:** `feature/iframe-action-steps`
**Depends on:** Phase 2 merged (same resolver-reuse rationale as Phase 3; independent of Phase 3 itself, could be done in either order or in parallel).

### Scope

Extends `FramePath` support to `WaitForStep`/`FillStep`/`ClickStep`/`ScrollStep` (Phase 1) — e.g. clicking a cookie-consent button that lives inside an iframe before extraction can proceed, or filling a login form embedded via iframe (a common real-world pattern, e.g. some SSO widgets).

### Tasks

- [x] **IR**: `FramePath` (`List<string>?`, default `null`) added to `WaitForStep`, `FillStep`, `ClickStep`, `ScrollStep` (`IR/ScrapingStep.cs`), and to the matching wire-format `BrowserAction` variants (`IR/BrowserAction.cs`). `ScrollStep.FramePath` applies to both `ContainerSelector` and `LoadMoreButtonSelector` — one step, one frame.
- [x] **Codegen** — turned out simpler than the task description anticipated: `Locator.wait_for(timeout=...)`/`.fill(...)`/`.click()` all default to the same "visible" state `page.wait_for_selector`/`page.fill`/`page.click` already use (checked via `inspect.signature` on the real installed Playwright classes, not assumed), so a *single* shared helper works for all three — `_resolve_locator(page, selector, frame_path)` returns `page.locator(selector)` when `frame_path` is falsy (reusing the `_resolve_frame_locator` helper from Phase 2/3, which already returns `page` unchanged for an empty path) and a frame-scoped `Locator` otherwise; each fragment template became a single line, e.g. `_resolve_locator(page, "{{ step.selector }}", ...).click()`. `ScrollStep` was the one case matching the task's original prediction: its button-existence check now uses `Locator.count() == 0` instead of `query_selector(...) is None` for the framed branch (the *unframed* branch was deliberately left untouched, byte-for-byte, to not risk regressing Phase 1's already-shipped, hard-won stop-condition logic — see "Design notes from Phase 1" earlier in this file).
- [x] **`ScrapingPlanValidator`**: all four step types now call the shared `ValidateFramePath` (from Phase 3) instead of a new copy. Note: for these four step types (unlike `ExtractStep`/container nodes), the "`FramePath` requires Engine Browser" branch inside `ValidateFramePath` is actually unreachable in practice — the existing `browserOnlySteps` guard earlier in `Validate()` already rejects a Static-engine plan containing *any* `WaitForStep`/`FillStep`/`ClickStep`/`ScrollStep`, framed or not, before the per-step loop is ever reached. Reusing the helper anyway is still correct and avoids a fourth near-identical copy of the same checks — the unreachable branch is cheap insurance, not dead weight.
- [x] **Tests**: `PythonPlaywrightCodeGeneratorTests.cs` (all four fragment types render `_resolve_locator(...)` correctly with/without `frame_path`), `ScrapingPlanValidatorTests.cs` (guard + field validation on all four types), `PythonPlaywrightScriptVerifierTests.cs` (two real end-to-end Chromium tests: the full login flow — fill, fill, click, wait, extract — with the entire form embedded in an iframe, directly mirroring the existing unframed login test; and `ScrollStep`'s load-more-button variant with the button inside an iframe). **All passed on the first run** — same "the upfront spikes/introspection paid off" pattern as Phase 2/3.
- [x] **Manual verification against a real page** (not `LocalTestServer`): unlike Phase 2/3, this one specifically exercised the **wire format** (`POST /generate` with a JSON `browserActions` array containing `"framePath"` per action) rather than constructing a `ScrapingPlan` directly in C#, since that's the one path the `LocalTestServer`-based tests don't cover (they bypass `ScrapingPlanBuilder` entirely). Built a throwaway local login-in-iframe page, ran it against a real companion instance with real environment variables — the generated script correctly filled the credentials, clicked submit, waited for `.welcome`, and extracted `"Welcome, alice"`, all inside the iframe, end-to-end through the real wire format.

### Definition of done

- [x] All four Phase 1 action steps can target a selector inside an iframe via `FramePath`, wired end-to-end from `BrowserActions` through to the generated script.
- [x] All new + existing tests green (236 backend; extension suite untouched by this phase).

---

## Phase 5 — Extension UI: Browser-engine baseline — ✅ DONE

**Branch:** `feature/browser-engine-ui`
**Depends on:** nothing structurally (this closes a pre-existing gap independent of #41/#42), but do it after Phase 1 so `BrowserActions` (which this UI needs to populate) already exists on the wire format.

### Scope

Add the missing engine selection and browser-action configuration UI to the extension — today `popup.js` never sends an `engine` field and there's no UI for `FillStep`/`ClickStep`/`WaitForStep` at all. This phase does **not** add Scroll- or iframe-specific UI yet (see Phases 6-7).

### Tasks

- [x] Engine selector (Static/Browser) added to `extension/popup/popup.html`/`popup.js` as a mode-independent `.mode-toggle`-styled control living outside the Fields/Groups/Api mode sections (new `_state.engine`, never touched by `switchMode`/`MODE_SWITCH_CLEARS` — see A) in the Phase 5 research notes this plan doc's history captured), wired into `buildScrapingConfig`.
- [x] UI for an ordered list of browser actions (`WaitForStep`/`FillStep`/`ClickStep` — `ScrollStep` is explicitly Phase 6) shown only when `Engine = Browser`, via three "+ Warten/Ausfüllen/Klicken" buttons (kind fixed at creation, unlike the API-config parameter cards' "change the kind afterward" pattern — simpler since actions are created from scratch, not pre-existing). Each card's selector is set via the existing click-based `START_SELECTION`/`ELEMENT_SELECTED` flow (a new `selectionKind: 'browserAction'` + `pendingBrowserActionIndex`, writing straight into the action with no naming modal — same shape as container-mode's node-insertion branch). `FillStep`'s environment-variable-name input reuses the API-config-headers env-var text-input pattern (not the literal/env toggle itself, since a `FillStep`'s value is always an env var).
- [x] Wired into the `/generate` request body: `buildScrapingConfig`/`buildConfigExport` both gained trailing `engine`/`browserActions` parameters, defaulting to `'Static'`/`[]` so **every existing call site and every existing test keeps producing byte-for-byte the same output as before this phase** — `engine` is only included in the wire payload at all when `'Browser'`, and `browserActions` only on top of that when non-empty (switching back to Static hides the section but doesn't clear configured actions, so nothing meaningless for Static ever reaches the wire — verified by a dedicated test).
- [x] All i18n strings (new `idle.engine*` keys, new `browserActions.*` section) added to `de.json`/`en.json`/`es.json` — no hardcoded UI text (confirmed during research that i18n, not hardcoded German, is the current authoritative pattern for all new UI, contrary to CLAUDE.md's now-stale "stays in German" wording).

### Manual, real-extension verification

Same methodology as Phase 2's Spike A (load the actual unpacked extension into real headless Chromium via Playwright, drive the real side-panel page). Configured a complete login flow **entirely through the real UI** — engine toggle, two Fill actions (with env-var names), one Click, one WaitFor, each selector picked by actually clicking the target element on a real test page, plus a flat extraction field for the resulting `.welcome` element — then clicked the real "Skript generieren" button and captured the real `/generate` response (200 OK, meaning the companion's own internal verification already passed). Ran the generated script independently afterward: correctly filled credentials from environment variables, clicked submit, waited, and extracted `"Welcome, alice"`.

Two things went wrong along the way — **both were artifacts of the Playwright driver script, not application bugs, and no application code changed as a result**:
1. Using pre-fetched Playwright element handles (`query_selector_all(...)[i]`) for a "pick element" button click failed intermittently when an *unrelated* preceding action (typing an env-var name, then blurring it via the next click) triggered a re-render that replaced the DOM node the stale handle pointed to mid-click. Fixed by using `page.locator(...).nth(i).click()` (re-resolved at click time) instead — confirmed this is specifically an element-handle-staleness issue, not a real one: a real mouse click is position-based, not JS-reference-based, and lands on the re-rendered button (same shape, same position) without issue.
2. The companion read the *popup's own* `chrome-extension://` URL instead of the test page's URL on the first attempt, because the popup tab (not the test page tab) was still `chrome.tabs`-"active" at the moment `checkCompanion()` ran. Fixed in the driver script by calling `bring_to_front()` on the test-page tab before letting the popup finish initializing — a real user never hits this, since their actual browser tab is naturally the active one while the side panel is open alongside it.

Both are documented here specifically so a future session writing more Playwright-driven popup tests doesn't have to rediscover them.

### Definition of done

- [x] A user can, purely through the extension UI, configure a login flow (fill + click + wait) against a real page and download a working script — no direct companion API call needed.
- [x] All new + existing tests green (401 extension tests; backend untouched by this phase, still 236).

---

## Phase 6 — Extension UI: `ScrollStep` configuration — ✅ DONE

**Branch:** `feature/scroll-step-ui`
**Depends on:** Phase 1 (backend) + Phase 5 (browser-action UI baseline)

### Tasks

- [x] "Scroll" action type added to the Phase 5 browser-action list UI (a fourth `+ Scrollen` button alongside Warten/Ausfüllen/Klicken), with container selector (optional, click-to-select), load-more-button selector (optional, click-to-select), max iterations and wait-time number inputs. Unlike Fill/Click/WaitFor (exactly one pickable selector per card), a Scroll card has *two* independently-pickable selectors — generalized the existing click-based pick mechanism with a new `pendingBrowserActionField` (`'selector' | 'containerSelector' | 'loadMoreButtonSelector'`, carried alongside the existing `pendingBrowserActionIndex`) instead of hardcoding which property `ELEMENT_SELECTED` writes into. `serializeBrowserActions` coerces an unpicked selector to `null`, never `''` — `ScrapingPlanValidator` rejects a "set but blank" `ContainerSelector`/`LoadMoreButtonSelector`, so sending `''` would silently 400 a perfectly valid single-selector Scroll configuration.
- [x] Manually verified end-to-end against the real `test-pages/infinite-scroll/index.html`, through the real extension UI (not just `LocalTestServer`/direct `/generate` calls): configured two Scroll actions in one script (one `ContainerSelector="#feed"`, one `LoadMoreButtonSelector="#load-more-classifieds"`) plus two extraction fields, generated (200 OK), and ran the script independently — extracted the full, correct counts for both (47/47 posts, 18/18 ads), confirming both ScrollStep variants work through the complete UI → wire format → codegen → real-script pipeline.

### Definition of done

- [x] A user can configure infinite-scroll/load-more scraping entirely through the extension UI and download a working script.
- [x] All new + existing tests green (407 extension tests; backend untouched by this phase, still 236).

---

## Phase 7 — Extension UI: Iframe/Shadow-DOM support — ✅ DONE

**Branch:** `feature/iframe-ui`
**Depends on:** Phase 2 (backend, minimum) + Phase 5 (browser-action UI baseline). Phases 3/4 aren't a hard dependency but make this phase materially more useful (framed container/action-step configuration) — check whether they've landed and adjust scope accordingly.

### Scope note (discovered while implementing, not assumed upfront)

The task list below was written assuming the wire-format plumbing already existed and only the *visual feedback* was missing. That assumption was wrong: `content-script.js`'s `ELEMENT_SELECTED` message has carried a resolved `framePath` since Phase 2, but `popup.js` never read `message.framePath` anywhere — flat fields, container-mode nodes, and browser actions had no `framePath` property at all, and none of `buildScrapingConfig`/`serializeGroupTree`/`serializeBrowserActions` ever emitted one. So Issue #42 was **not actually usable end-to-end through the extension** before this phase, regardless of how the "click inside an iframe" selection itself behaved — this phase had to add that plumbing first, then the visual feedback on top of it.

### Tasks

- [x] **Visual feedback during selection** (two layers, since the two pieces of information become available at very different times):
  - **Live, during hover** — `content-script.js`'s `createOverlay()` now colors the hover highlight amber (vs. the original blue) and adds a `🖼 {depth}` badge whenever the current frame isn't the top document (`frameDepth()`, a synchronous `window.parent` walk — no postMessage round trip needed, unlike the actual selector-chain resolution). Icon+number only, deliberately not routed through the popup's i18n system, since this renders into the *inspected page*, not the extension's own UI.
  - **After a click, in the side panel** — once `resolveFramePath()`'s async postMessage round trip actually resolves a `framePath`, it's threaded through the popup's state (`pendingFramePath`, mirroring `pendingSelector`) and stored onto the resulting field/group-node/browser-action. A small translated `.frame-badge` pill (new `frame.badge`/`frame.badgeTitle` i18n keys, `frameBadgeHtml()`) is shown next to the item in `renderFields`/`renderGroupTree`/`renderBrowserActions` whenever it carries a non-null `framePath`, with the full resolved chain (`" > "`-joined) in the tooltip.
  - Plumbing added to make the above possible: `addField`/`buildGroupNode`/`buildFieldNode` gained an optional `framePath` parameter; `serializeGroupTree`/`serializeBrowserActions`/`buildScrapingConfig`'s flat-fields mapping all include `framePath` in the wire payload only when set (never `null`), matching the existing "omit when meaningless" convention `engine`/`attribute` already use. `background/service-worker.js`'s `ELEMENT_SELECTED` handler now also persists `pendingFramePath` into session storage alongside `pendingSelector`, for the same "popup was closed at click time" recovery path.
  - A `ScrollStep` action has two independently-pickable selectors but the backend models exactly one `FramePath` for the whole step (see Phase 4) — the popup reflects this literally: picking either selector overwrites the action's single `framePath` with whatever the most recent pick resolved to, rather than trying to merge/reconcile two picks that could disagree. Not further validated in the UI (e.g. no warning if the two selectors were picked from different frames) — a known, accepted limitation matching the backend's own.
- [x] Cross-origin iframes needed no special-casing, confirmed again here — per Phase 2's Spike A they're fully inspectable, so no fallback/error UI exists for that case specifically.
- [x] **Tests**: `content-script.test.js` (`frameDepth()` returns 0 for the top-level document — the `depth > 0` branch is jsdom-untestable for the same `window.top`-non-configurable reason Phase 2 already hit, verified manually instead, see below). `popup.test.js`: `addField`/`buildGroupNode`/`buildFieldNode` carrying a `framePath`; `serializeGroupTree`/`serializeBrowserActions`/`buildScrapingConfig` including/omitting `framePath` correctly; `frameBadgeHtml` unit tests; `renderFields`/`renderGroupTree` badge presence/absence; a full container-mode and a full browser-action integration test each confirming the badge appears (with the right selector chain in its title) after a simulated framed `ELEMENT_SELECTED`, and does not appear for a top-level one. `service-worker.test.js`: `pendingFramePath` stored alongside `pendingSelector`.
- [x] **Manual, real-extension verification** against `test-pages/iframe-shadow-dom/index.html` (same methodology as Phases 2/5/6: `launch_persistent_context` loading the real unpacked extension into real Chromium — headless needed `headless=False` + `args=["--headless=new", ...]` together, since `headless=True` alone adds the old `--headless` flag which silently disables extension loading; the display-less environment this session ran in otherwise had no `Xvfb`/`xvfb-run` available, so this exact incantation was required rather than a headed browser). Configured a complete flat-mode config **entirely through the real UI**: Browser engine enabled, then four fields picked by actually clicking on the real page — top-level baseline (no badge), a field inside the first-level iframe (badge, tooltip `#price-widget`), a field inside the *doubly-nested* iframe reached via `page.frame_locator(...).frame_locator(...)` (badge, tooltip `#price-widget > #reviews-widget`), and the open-shadow-DOM badge value (no `framePath` badge, exactly as expected since shadow DOM needs none). Verified the live hover overlay too: hovering the top-level marker showed the original blue box with no depth badge; hovering the level-1 iframe's marker showed the amber box with a `🖼 1` badge, read directly out of that frame's own DOM. Generation returned 200 OK; ran the downloaded script independently and confirmed `output.csv` contained all four correct values in one row: `129,00 €` / `124,50 €` / `4,7 / 5 (312 Bewertungen)` / `0,00 € (Prime)` — a genuine end-to-end proof (extension click → wire format → `FRAME_PATHS` in the generated script → real Playwright execution → correct extraction), not just the UI half tested in isolation.

### Definition of done

- [x] A user can select data inside an iframe (including nested iframes) purely through the extension UI and download a working script.
- [x] All new + existing tests green (422 extension tests; backend untouched by this phase).

---

## Suggested execution order

1. ~~Phase 1 (independent)~~ ✅ done
2. ~~Phase 2 — flat `ExtractStep` FramePath (independent, but benefits from Phase 1's wire-format pattern existing first)~~ ✅ done
3. ~~Phase 3 — container-mode `FramePath` (needs Phase 2 merged)~~ ✅ done
4. ~~Phase 4 — action-step `FramePath` (needs Phase 2 merged; independent of Phase 3, either order/parallel is fine)~~ ✅ done
5. ~~Phase 5 — browser-engine UI baseline (needs Phase 1 merged for `BrowserActions` to exist; otherwise independent of 2/3/4)~~ ✅ done
6. ~~Phase 6 — ScrollStep UI (needs 1 + 5 merged)~~ ✅ done
7. ~~Phase 7 — Iframe UI (needs 2 + 5 merged at minimum; more useful with 3/4 also merged)~~ ✅ done

Phase 5 can be worked in parallel with Phases 2/3/4 by a different session/branch if desired, since it doesn't depend on any of them.
