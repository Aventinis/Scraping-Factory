# Browser-automation test harness (Issue #180)

A small Playwright-based harness for driving the *real*, unpacked Scraping Factory extension in a *real* browser against the `test-pages/` fixtures and a real companion app process. This closes a real gap: `extension/`'s Jest suite runs in `jsdom`, which has no `chrome.*` extension APIs, no side panel, and no content-script injection — every "does this actually work in the browser" question has, until now, only ever been answerable by a human loading the extension by hand.

This is **not** a replacement for the Jest unit test suite — it's specifically for the "real browser, real unpacked extension, real click-through" gap unit tests structurally can't cover, per CLAUDE.md's own "start the dev server and use the feature in a browser before reporting the task as complete" instruction for UI changes.

## Setup (one-time)

```bash
cd e2e
npm install   # also downloads Playwright's own Chromium build (~190 MB)
```

Requires `python3` and `dotnet` on `PATH` — both already hard requirements for this project (see the root `CLAUDE.md`).

## Usage

```bash
node e2e/examples/speisekarte-smoke.js
```

Or write your own script against `e2e/harness.js`:

```js
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('./harness');

const companion = await startCompanion();       // starts one if none is already healthy on :5000
const fixture = await startFixture('speisekarte'); // see fixtures.js for every known fixture name
const browser = await launchBrowser();           // real unpacked extension, real Chromium

const fixturePage = await browser.context.newPage();
await fixturePage.goto(fixture.url);

const popupPage = await openPopup(browser.context, browser.extensionId);
await focusFixture(fixturePage);                 // see harness.js's own doc comment — required before
await waitForIdleScreen(popupPage);               // every action that depends on the "current tab"

// ...drive popupPage/fixturePage like any other Playwright pages: click,
// fill, assert on rendered text, popupPage.screenshot({ path: '...' }), etc.

await browser.close();
await fixture.stop();
await companion.stop();                          // no-op if we didn't start it ourselves
```

### The one non-obvious trick this harness exists for

A real Chrome side panel doesn't occupy a tab slot, so `chrome.tabs.query({active:true})` called from it correctly returns whatever regular page the user is looking at. Playwright has no API to "click the toolbar icon and open the real side panel" (that UI lives outside any page's DOM) — so this harness opens `popup/popup.html` directly as an ordinary second tab instead, which is the standard trick for testing an MV3 side panel/popup's own HTML/JS. The cost: opening that tab makes *it* the active one, so `popup.js` would see itself instead of the fixture page. `focusFixture()` (a plain `fixturePage.bringToFront()`) fixes this — confirmed via a live spike that it doesn't close/hide the popup tab, it only changes which tab Chrome itself considers active, which is exactly what `chrome.tabs.query` reads.

## Design decisions (resolving Issue #180's own open questions)

- **Headed Chromium only, for now.** Playwright's own bundled Chromium (never the system's real Google Chrome via `channel: 'chrome'` — confirmed via a live spike that Chrome's Stable channel now refuses `--load-extension`/`--disable-extensions-except` entirely, leaving `chrome://extensions` empty and no service worker registered). Headless support for MV3 extensions is still evolving upstream and wasn't tested here — left as a possible future improvement, not a blocker for this first version.
- **Manual/on-demand, not CI.** Matches the issue's own suggested safer default for this project's "free plugin, lightweight tooling" principle — this is meant to be run ad hoc (by a human, or an AI assistant) when a change specifically calls for real-browser verification, not a mandatory gate on every PR.
- **Companion process management**: a fixed default port (`5000`, matching the extension's own default), health-polled before use. If something's already answering `/health` there (e.g. a human's own companion running from their IDE), it's left completely alone — `startCompanion()` returns `{ alreadyRunning: true }` and `stop()` becomes a no-op, so this harness never kills a process it didn't start.
- **Verification style**: both. DOM-state assertions (`popupPage.locator(...).textContent()`, element counts) are the cheap, precise default for "did this actually work"; `page.screenshot()` is available any time a visual/manual check (or a bug-report attachment) is more useful than an assertion.
- **Fixtures**: the existing five `test-pages/*` fixtures are enough to start with (see `fixtures.js` for the full registry, including the fixed port each one is served on). New fixtures can be added there as specific features/bugs need scenarios the existing five don't cover.
