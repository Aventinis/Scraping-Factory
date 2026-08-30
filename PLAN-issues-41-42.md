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

1. **UI is phased separately from backend.** Phases 1 and 2 are backend/IR/codegen only, reachable via the companion HTTP API (like `curl`/manual `/generate` calls), not via the extension UI. Phases 3-5 add extension UI on top, once the backend exists.
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

### Spike (do first, before committing to the full design below)

- [ ] **Spike A — cross-origin iframes**: confirm whether a Manifest V3 content script with `matches: ["<all_urls>"]` and `all_frames: true` actually gets injected into cross-origin iframes (not just same-origin). Test manually with a throwaway page embedding a cross-origin iframe. Record the answer in this file before proceeding — if cross-origin iframes are *not* inspectable, the plan needs a documented, honest failure mode (clear error) instead of silent partial support.
- [ ] **Spike B — Locator API migration scope**: `FrameLocator` (Playwright's iframe API) has no `query_selector_all`, only `Locator`-based methods (`.all()`, `.count()`, etc.), while today's extraction code uses `query_selector`/`query_selector_all` throughout. Decide: (a) migrate extraction to the `Locator` API universally (cleaner, bigger diff, touches both `playwright_scraper.py.j2` and `playwright_scraper_grouped.py.j2`), or (b) keep `query_selector` for the no-frame case and add a parallel `Locator`-based path only when `FramePath` is set (smaller diff, two code paths to maintain). Record the decision + reasoning in this file before proceeding.

**OPEN DECISION** (resolve with user before starting IR/codegen work): should `FramePath` be added only to `ExtractStep` (flat mode), or also to container-mode nodes (`DataFieldNode`/`GroupNode`) and the browser-action steps from Phase 1 (`WaitForStep`/`FillStep`/`ClickStep`/`ScrollStep`, e.g. for clicking a cookie-consent button that lives inside an iframe)? This changes effort meaningfully — confirm scope, don't assume "everything" by default.

### Tasks

- [ ] **Test page:** `test-pages/iframe-shadow-dom/index.html` — self-contained, German, styled like `speisekarte`, combining in one page:
  - A single (same-origin, since this is a local static file) iframe containing identifiable test data.
  - A nested iframe (iframe inside the first iframe).
  - An element attached behind an **open** shadow root, with identifiable test data.
  - Each section's data should be trivially distinguishable (e.g. different fixed text per level) so a wrong-scope extraction is obviously wrong when manually checked.

- [ ] **Content script** (`extension/content/content-script.js`, `extension/manifest.json`):
  - Set `all_frames: true` on the `content-script.js` entry in `manifest.json`.
  - Detect, on click-based selection, whether the target element's `window` differs from the top-level window (i.e., running inside an iframe), and build a frame path: an ordered list of CSS selectors identifying each iframe from the top document down to the frame containing the target (e.g. `["iframe#outer", "iframe.inner"]`).
  - Update `buildSelector`'s boundary logic so it still produces a selector relative to the *containing frame's* document, not the top document, when running inside an iframe instance.

- [ ] **Background service worker** (`extension/background/service-worker.js`): the popup→content-script relay currently targets the active tab without a `frameId`. Extend the relay to target the specific frame the selection came from (`chrome.tabs.sendMessage(tabId, message, { frameId })`), using `sender.frameId` from the originating message.

- [ ] **IR**: add `FramePath` (`List<string>?`, default `null` = top-level document, unchanged behavior) to `ExtractStep` and to whichever other step/node types were confirmed in scope by the OPEN DECISION above.

- [ ] **Codegen**: per the Spike B decision, emit a `page.frame_locator(sel1).frame_locator(sel2)...` chain (using Playwright's `Locator` API) for any extraction/action whose `FramePath` is set, in `playwright_scraper.py.j2` / `playwright_scraper_grouped.py.j2`'s `extract_group()` / the relevant `playwright_*_step.py.j2` fragments.

- [ ] **`ScrapingPlanValidator`**: reject a plan where `FramePath` is set on any step but `Engine != Browser`, with a clear message (mirror the existing Browser-only-step guard) — the static engine has no iframe/shadow-DOM support and should fail fast with a clear reason rather than a silent `422` from a selector that "just returns no data."

- [ ] **Tests**: extend `PythonPlaywrightScriptVerifierTests.cs` with `LocalTestServer`-based cases for (a) shadow-DOM extraction with a plain selector (proving no codegen change was needed there), (b) single-iframe extraction via `FramePath`, (c) nested-iframe extraction via a two-element `FramePath`. Extend `ScrapingPlanValidatorTests.cs` for the Browser-only guard on `FramePath`. **Also manually verify against the real test page**, not just `LocalTestServer` — Phase 1 showed the synthetic server-based tests alone are not sufficient to catch scope/timing bugs.

### Definition of done

- Spike A and B answers recorded in this file.
- Manually confirmed against `test-pages/iframe-shadow-dom/index.html` that: shadow-DOM content is extracted without any `FramePath`; single- and nested-iframe content is extracted correctly using `FramePath` produced by the updated content script.
- All new + existing tests green.

---

## Phase 3 — Extension UI: Browser-engine baseline

**Branch:** `feature/browser-engine-ui`
**Depends on:** nothing structurally (this closes a pre-existing gap independent of #41/#42), but do it after Phase 1 so `BrowserActions` (which this UI needs to populate) already exists on the wire format.

### Scope

Add the missing engine selection and browser-action configuration UI to the extension — today `popup.js` never sends an `engine` field and there's no UI for `FillStep`/`ClickStep`/`WaitForStep` at all. This phase does **not** add Scroll- or iframe-specific UI yet (see Phases 4-5).

### Tasks

- [ ] Add an engine selector (Static/Browser) to `extension/popup/popup.html`/`popup.js`, wired into `buildScrapingConfig`.
- [ ] Add UI for configuring an ordered list of browser actions (`WaitForStep`/`FillStep`/`ClickStep`) when `Engine = Browser` is selected — reuse the existing credential/env-var UI pattern already used for API-mode headers (`FillStep`'s env-var value source) as precedent.
- [ ] Wire this UI's output into the `BrowserActions` field of the request body sent to `/generate`.

### Definition of done

- A user can, purely through the extension UI, configure a login flow (fill + click + wait) against a real page and download a working script — no direct companion API call needed.

---

## Phase 4 — Extension UI: `ScrollStep` configuration

**Branch:** `feature/scroll-step-ui`
**Depends on:** Phase 1 (backend) + Phase 3 (browser-action UI baseline)

### Tasks

- [ ] Add a "Scroll / Load more" action type to the browser-action list UI from Phase 3, with fields for container selector (optional, click-to-select like other selectors), load-more button selector (optional, click-to-select), max iterations, wait time.
- [ ] Manually verify end-to-end against `test-pages/infinite-scroll/index.html`.

### Definition of done

- A user can configure infinite-scroll/load-more scraping entirely through the extension UI and download a working script.

---

## Phase 5 — Extension UI: Iframe/Shadow-DOM support

**Branch:** `feature/iframe-ui`
**Depends on:** Phase 2 (backend) + Phase 3 (browser-action UI baseline)

### Tasks

- [ ] Visual feedback during click-based selection when the hovered/clicked element is inside an iframe (analogous to the existing DOM tree highlighting) — at minimum, indicate the frame path being recorded.
- [ ] Surface a clear error/warning in the UI for the cross-origin-iframe failure mode identified in Phase 2's Spike A, if applicable.
- [ ] Manually verify end-to-end against `test-pages/iframe-shadow-dom/index.html`.

### Definition of done

- A user can select data inside an iframe (including nested iframes) purely through the extension UI and download a working script.

---

## Suggested execution order

1. ~~Phase 1 (independent)~~ ✅ done
2. Phase 2 (independent, but benefits from Phase 1's wire-format pattern existing first)
3. Phase 3 (independent, but needs Phase 1 merged for `BrowserActions` to exist)
4. Phase 4 (needs 1 + 3 merged)
5. Phase 5 (needs 2 + 3 merged)

Phases 2 and 3 can be worked in parallel by different sessions/branches if desired, since neither depends on the other.
