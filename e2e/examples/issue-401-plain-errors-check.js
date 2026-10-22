// Issue #401: real-browser check that a failed Generate explains itself in plain
// language instead of showing the companion's/script's raw text.
//
//   1) A trial run on the Static engine of a page whose content is built by
//      JavaScript (infinite-scroll fixture): "No data was found", the hint mentions
//      the preview and the Browser engine, the original companion text is behind
//      "Details" (closed by default, copyable), the toast stays instead of vanishing
//      after a few seconds, "Report bug" still carries the raw text, × closes it.
//   2) A missing page (HTTP 404) — "The page was not found" — also in German.
//   3) A header backed by an environment variable with no test value: "The script
//      needs the variable …" (the script's own ERROR line, exit code 78).
//   4) A start URL without a scheme (a 400 the user can fix): plain message, no
//      "Report bug" (it is not a defect).
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-401-plain-errors-check.js
const fs = require('fs');
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const feed = await startFixture('infinite-scroll');
  const menu = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    // The bug report opens a GitHub issue page — never actually go there.
    await browser.context.route(/^https:\/\/github\.com\//, (route) => route.abort());
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(feed.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    const reload = async () => {
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
    };
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await reload();

    const addField = async (name, selector) => {
      await popup.click('#btn-add-field');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click(selector);
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', name);
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);
    };
    const generate = async () => {
      await popup.evaluate(() => document.getElementById('error-toast').classList.add('hidden'));
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#error-toast:not(.hidden)', { timeout: 120000 });
    };
    const toast = {
      title: () => popup.locator('#error-toast-message').textContent(),
      hint: () => popup.locator('#error-toast-hint').textContent(),
      raw: () => popup.locator('#error-toast-details-text').textContent(),
      reportVisible: () => popup.locator('#btn-report-bug-toast').isVisible(),
    };

    // 1) JavaScript-built page on the Static engine → no data.
    await addField('Titel', '.post-title >> nth=0');
    await generate();
    assert(await toast.title() === 'No data was found', `unexpected title: ${await toast.title()}`);
    const hint = await toast.hint();
    assert(/Show preview/.test(hint) && /try the Browser engine/.test(hint), `unexpected hint: ${hint}`);
    assert(!(await popup.locator('#error-toast-details').evaluate((d) => d.open)), '"Details" should start closed');
    assert(!/returned no data/.test(await popup.locator('#error-toast-message').textContent()), 'the raw text must not be the headline');
    await popup.locator('#error-toast-details > summary').click();
    assert(await popup.locator('#error-toast-details-text').isVisible(), 'Details should open');
    const raw = await toast.raw();
    assert(/returned no data/.test(raw) && /output\.csv/.test(raw), `Details should hold the original text, got: ${raw}`);
    await popup.screenshot({ path: path.join(__dirname, 'issue-401-no-data.png') });

    // Copy
    await browser.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await popup.click('#btn-toast-copy-details');
    await popup.waitForTimeout(300);
    const copied = await popup.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (copied === null) console.log('(clipboard read not permitted in this browser — skipping the content check)');
    else assert(copied === raw, `the clipboard should hold the original text, got: ${copied}`);

    // Sticky: still there well past the old 8 seconds.
    await popup.waitForTimeout(9500);
    assert(await popup.locator('#error-toast').isVisible(), 'the error toast should stay until it is closed');

    // Report bug: the downloaded report holds the raw text.
    assert(await toast.reportVisible(), '"Report bug" should be offered for a failed trial run');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('#btn-report-bug-toast')]);
    const report = fs.readFileSync(await download.path(), 'utf8');
    assert(/Last error: .*returned no data/.test(report), 'the bug report should carry the original text');
    assert(!/Last error: No data was found/.test(report), 'the bug report should not only carry the plain title');

    await popup.click('#btn-toast-close');
    assert(!(await popup.locator('#error-toast').isVisible()), '× should close the toast');
    console.log('static + JavaScript page: plain "no data", Details with the original text, copy, sticky, report bug raw, close');

    // 2) HTTP 404 — also in German.
    await fixturePage.goto(`${menu.url}no-such-page.html`);
    await popup.evaluate(() => chrome.storage.session.clear());
    await reload();
    await addField('Fehler', 'h1');
    await generate();
    assert(await toast.title() === 'The page was not found', `unexpected 404 title: ${await toast.title()}`);
    assert(/HTTP 404/.test(await toast.raw()), 'the original 404 text should be in Details');
    await popup.evaluate(() => chrome.storage.local.set({ language: 'de' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await generate();
    assert(await toast.title() === 'Die Seite wurde nicht gefunden', `unexpected German title: ${await toast.title()}`);
    assert(/Seitenadresse/.test(await toast.hint()), 'the German hint should mention the page address');
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en' }));
    console.log('404: plain title in English and German');

    // 3) A header backed by an environment variable with no test value.
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-request-headers');
    await popup.selectOption('#select-add-request-header', 'apiKey'); // Issue #402: an env-var row, named X-Api-Key
    const row = popup.locator('#request-headers-list .request-header-row').first();
    await row.locator('.request-header-value').fill('SF_E2E_MISSING_VARIABLE');
    await row.locator('.request-header-value').blur();
    await generate();
    assert(await toast.title() === 'The script needs the variable SF_E2E_MISSING_VARIABLE', `unexpected missing-variable title: ${await toast.title()}`);
    assert(/test value/.test(await toast.hint()), 'the hint should mention the test value');
    assert(/required environment variable 'SF_E2E_MISSING_VARIABLE' is not set/.test(await toast.raw()), 'the original line should be in Details');
    await popup.uncheck('#toggle-request-headers');
    console.log('missing environment variable: plain title naming the variable');

    // 4) A start URL without a scheme → 400 the user can fix: plain message, no Report bug.
    await popup.fill('#input-additional-urls', 'example.com/page');
    await popup.locator('#input-additional-urls').blur();
    await generate();
    assert(await toast.title() === "The page address isn't valid", `unexpected invalid-URL title: ${await toast.title()}`);
    assert(/example\.com\/page/.test(await toast.hint()), 'the hint should name the address');
    assert(!(await toast.reportVisible()), 'a configuration the user can fix is not a bug — no "Report bug"');
    await popup.screenshot({ path: path.join(__dirname, 'issue-401-invalid-url.png') });
    console.log('invalid start URL: plain message, no Report bug');

    console.log('OK — failed Generate: plain title and hint, original text behind Details, report bug keeps the raw text.');
  } catch (err) {
    const toastText = await browser.context.pages().at(-1).locator('#error-toast').textContent().catch(() => null);
    if (toastText) console.error('Toast:', toastText.replace(/\s+/g, ' ').slice(0, 300));
    throw err;
  } finally {
    await browser.close();
    await feed.stop();
    await menu.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
