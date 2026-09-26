// Issue #180: a small, reusable Playwright harness for driving the real,
// unpacked extension in a real browser against the test-pages/ fixtures and
// a real companion app process — closing the "please test this in the
// browser" gap that Jest's jsdom-based unit tests structurally can't cover
// (no chrome.* extension APIs, no side panel, no content-script injection).
// Manual/on-demand only, not wired into CI — see README.md for why.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFixture, REPO_ROOT } = require('./fixtures');

const EXTENSION_PATH = path.join(REPO_ROOT, 'extension');
const COMPANION_CSPROJ = path.join(REPO_ROOT, 'companion/ScrapingFactory.Companion/ScrapingFactory.Companion.csproj');

async function waitForHttpOk(url, { timeoutMs = 20000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url} to respond OK: ${lastError?.message}`);
}

// Real, official Google Chrome (as opposed to Playwright's own bundled
// Chromium) increasingly refuses --load-extension/--disable-extensions-except
// on its Stable channel — confirmed via a live spike while building this
// harness: chrome://extensions stayed empty and no service worker ever
// registered. Playwright's own unbranded Chromium build has no such
// restriction, so this harness deliberately never passes `channel: 'chrome'`.
async function launchBrowser({ headless = false } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;

  return {
    context,
    extensionId,
    async close() {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

// Opens the extension's popup/side-panel HTML directly as an ordinary page.
// There's no Playwright API for "click the toolbar icon and open the real
// side panel" (that UI lives outside any page's DOM), but the side panel is
// just this same HTML/JS shown in a different browser surface — navigating
// straight to it drives identical code. See focusFixture's own doc comment
// for the one behavioral difference this shortcut requires working around.
async function openPopup(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return page;
}

// The one real behavioral gap between "popup.html open as a plain tab" and
// a genuine side panel: a side panel doesn't occupy a tab slot at all, so
// chrome.tabs.query({active:true}) called from it correctly returns whatever
// regular page the user is looking at. Opening popup.html as a second tab
// makes IT the active tab the instant it's opened — popup.js would then see
// itself (a chrome-extension:// URL) as "the current page" instead of the
// fixture. Confirmed via a live spike that Playwright's page.bringToFront()
// on the fixture page fixes this: it doesn't close/hide the popup tab, it
// only changes which tab Chrome itself considers active, which is exactly
// what chrome.tabs.query reads. Call this right before any action that
// depends on popup.js reading the correct current-tab URL (initial load,
// "Check robots.txt", a fresh element-selection round, etc.).
async function focusFixture(fixturePage) {
  await fixturePage.bringToFront();
  await fixturePage.waitForTimeout(150);
}

// Waits for popup.js's init() (companion health check + chrome.tabs.query)
// to finish and land on the idle screen — the point at which #url-display
// reflects whatever tab focusFixture last made active. Throws instead of
// silently timing out on the companion-unreachable screen, since that's a
// setup problem (start the companion first) rather than a "still loading"
// state a longer timeout would fix.
async function waitForIdleScreen(popupPage, { timeoutMs = 15000 } = {}) {
  await popupPage.waitForSelector('#screen-idle:not(.hidden)', { timeout: timeoutMs }).catch(async () => {
    const errorVisible = await popupPage.locator('#screen-error:not(.hidden)').isVisible().catch(() => false);
    if (errorVisible) {
      throw new Error('Popup is stuck on the companion-unreachable screen — is the companion running/healthy?');
    }
    throw new Error('Timed out waiting for the popup to reach the idle screen.');
  });
}

// Starts the companion app if nothing is already answering /health on the
// target port — a human's own already-running companion (e.g. from their
// IDE) is left completely alone, never killed by teardown(). `dotnet run`
// (not a hardcoded bin/Debug/netX.0 path) so this doesn't need updating
// whenever the target framework version changes.
async function startCompanion({ port = 5000, timeoutMs = 60000 } = {}) {
  const healthUrl = `http://localhost:${port}/health`;
  const alreadyRunning = await fetch(healthUrl).then((r) => r.ok).catch(() => false);
  if (alreadyRunning) {
    return { alreadyRunning: true, port, async stop() {} };
  }

  const child = spawn('dotnet', ['run', '--project', COMPANION_CSPROJ, '--no-launch-profile'], {
    env: { ...process.env, Companion__Port: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  try {
    await waitForHttpOk(healthUrl, { timeoutMs });
  } catch (err) {
    child.kill();
    throw new Error(`Companion failed to become healthy: ${err.message}\n--- companion output ---\n${output}`);
  }

  return {
    alreadyRunning: false,
    port,
    async stop() {
      child.kill();
    },
  };
}

// Serves one test-pages/<name> fixture — reusing its own server.py verbatim
// when it has one (api-nested-and-post, embedded-json-menu, both already
// bind their own fixed port), or a generic `python3 -m http.server` for the
// plain-static fixtures that don't. See fixtures.js's own doc comment for
// why python3 specifically (already a hard runtime requirement) rather than
// a Node-based static server.
async function startFixture(name) {
  const fixture = resolveFixture(name);
  const args = fixture.kind === 'script'
    ? [path.join(fixture.dir, fixture.script)]
    : ['-m', 'http.server', String(fixture.port), '--bind', '127.0.0.1', '--directory', fixture.dir];

  const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  const url = `http://127.0.0.1:${fixture.port}/`;
  try {
    await waitForHttpOk(url, { timeoutMs: 10000 });
  } catch (err) {
    child.kill();
    throw new Error(`Fixture "${name}" failed to start: ${err.message}\n--- output ---\n${output}`);
  }

  return {
    url,
    async stop() {
      child.kill();
    },
  };
}

module.exports = {
  launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture,
};
