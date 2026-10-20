// Issue #267: real-browser check of the Click browser action's "which match"
// choice against the click-targets fixture (three identical "Assets" buttons,
// each writing its number into #opened when clicked). A selector matching
// several buttons used to abort the run with Playwright's strict-mode error:
//   first (default) → "opened: 1", last → "opened: 3", all → "opened: 1,2,3".
//
// Runs its own companion on port 5057, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-267-click-target-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5057 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5057 — stop it first.');
  const fixture = await startFixture('click-targets');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    // The click's selector can only be *picked* (a unique selector); the
    // multi-match one is written into the session state the popup restores.
    await popupPage.evaluate(async () => {
      await chrome.storage.local.set({ globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5057' });
      await chrome.storage.session.set({ engine: 'Browser', browserActions: [{ kind: 'click', selector: 'button.toggle' }] });
    });
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('#opened');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Opened');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    const generate = async () => {
      await focusFixture(fixturePage);
      await popupPage.click('#btn-generate');
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
      const rows = await popupPage.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map(tr => Array.from(tr.cells).map(c => c.textContent)));
      await popupPage.click('#btn-back-to-config');
      await waitForIdleScreen(popupPage);
      return rows.map(r => r[0]);
    };

    if ((await popupPage.inputValue('.browser-action-click-target')) !== 'first') throw new Error('the click target should default to the first match');
    const expectRows = (label, actual, expected) => {
      console.log(`${label} →`, JSON.stringify(actual));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}`);
    };

    expectRows('first match', await generate(), ['opened: 1']);

    await popupPage.selectOption('.browser-action-click-target', 'last');
    expectRows('last match', await generate(), ['opened: 3']);

    await popupPage.selectOption('.browser-action-click-target', 'all');
    await popupPage.fill('.browser-action-click-wait-after-ms', '50');
    await popupPage.locator('#browser-actions-list').screenshot({ path: path.join(__dirname, 'issue-267-click-target.png') });
    expectRows('all matches', await generate(), ['opened: 1,2,3']);

    console.log('OK — a click selector matching three buttons clicked the first, the last, and all of them in order.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
