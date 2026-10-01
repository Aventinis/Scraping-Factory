---
name: browser-test
description: Drive the real, unpacked Scraping Factory extension in a real Chromium browser against the test-pages/ fixtures and a real companion app process, using the Playwright harness in e2e/ (Issue #180). Use this whenever a change needs actual in-browser verification that Jest's jsdom-based unit tests can't cover — a UI change, a content-script/selector change, a popup↔companion flow — instead of only reasoning about the code or asking the user to click through it by hand. Not for pure logic/companion-only changes that Jest/dotnet test already cover, and not a CI gate — this stays manual/on-demand.
---

# Browser test harness

Closes the gap CLAUDE.md's own "start the dev server and use the feature in a browser before reporting the task as complete" instruction otherwise can't be followed for this project without a human at the keyboard. Full design/rationale lives in `e2e/README.md` — read it once if anything here is unclear, don't re-derive the reasoning.

## One-time setup check

```bash
cd e2e && npm install   # no-op if node_modules already present; downloads Playwright's Chromium on first run
```

## Running a check

1. Look at `e2e/fixtures.js` for the closest existing fixture (`iframe-shadow-dom`, `infinite-scroll`, `login-flow`, `speisekarte`, `api-nested-and-post`, `embedded-json-menu`) to whatever the change touches. If none fits, either adapt one or add a new fixture under `test-pages/` first (see the existing ones for the pattern) rather than forcing an unrelated page.
2. Copy `e2e/examples/speisekarte-smoke.js` as a starting point, or write a fresh script requiring `../harness` (see `e2e/README.md`'s own usage example for the standard `startCompanion`/`startFixture`/`launchBrowser`/`openPopup`/`focusFixture`/`waitForIdleScreen` sequence).
3. **Always call `focusFixture(fixturePage)` before any action that depends on `popup.js` reading the correct current tab** (initial load, "Check robots.txt", a fresh element-selection round) — see `harness.js`'s own doc comment for why this is needed at all (a plain `popup.html` tab, unlike a real side panel, would otherwise become the "active" tab itself).
4. Drive `popupPage`/`fixturePage` with normal Playwright calls (`.click()`, `.fill()`, `.locator(...).textContent()`) to reach and verify the state the change is supposed to produce. Use `page.screenshot({ path: ... })` for anything easier to eyeball than to assert on, or to attach visual proof to a report back to the user.
5. Run the script with plain `node your-script.js` from the repo root (or `e2e/`) — there's no test runner wrapping this, it's a plain script that throws/exits non-zero on failure.
6. Always tear down what you started (`browser.close()`, `fixture.stop()`, `companion.stop()`) in a `finally` block, mirroring `e2e/examples/speisekarte-smoke.js` — `companion.stop()` is already a safe no-op if a human's own companion was already running and this harness never touched it.

## When NOT to reach for this

- A change fully covered by `extension/`'s Jest suite or the companion's own `dotnet test` — those are faster and already the right tool; don't add a browser check just because one is possible.
- Don't wire this into any CI workflow — it's deliberately kept manual/on-demand (see `e2e/README.md`'s own "Design decisions" section for why).
