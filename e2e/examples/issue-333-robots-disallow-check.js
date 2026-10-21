// Issue #333: real-browser check of "Check the site's robots.txt before every
// request" against the robots-disallow fixture ("/" is public, "/private/" is
// disallowed by its robots.txt). The listing at "/" is the start URL and
// "/private/" an additional start URL; the fixture logs which paths a
// generated script actually requested:
//   1) checkbox off: both pages are requested,
//   2) on, "Skip it and carry on": only "/" is requested and Generate succeeds,
//   3) on, "Stop the run": Generate fails with the robots.txt message.
//
// Runs its own companion on port 5058, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-333-robots-disallow-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const requestedPaths = async (fixture) => (await fetch(`${fixture.url}__log`)).json();

(async () => {
  const companion = await startCompanion({ port: 5058 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5058 — stop it first.');
  const fixture = await startFixture('robots-disallow');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5058' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.offer >> nth=0 >> .name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Name');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    await popupPage.fill('#input-additional-urls', `${fixture.url}private/`);
    await popupPage.click('#settings-section-toggle');

    const generate = async () => {
      await focusFixture(fixturePage);
      await fetch(`${fixture.url}__reset`);
      await popupPage.click('#btn-generate');
    };
    const backToConfig = async () => {
      await popupPage.click('#btn-back-to-config');
      await waitForIdleScreen(popupPage);
    };

    // 1) Checkbox off: the disallowed page is requested like any other.
    await generate();
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    let paths = await requestedPaths(fixture);
    console.log('Without the check, requested:', paths.join(', '));
    if (!paths.includes('/private/')) throw new Error('/private/ should be requested while the check is off');
    await backToConfig();

    // 2) On + Skip: the disallowed page is never requested, the rest goes on.
    await popupPage.check('#toggle-robots-disallow');
    await popupPage.locator('#robots-disallow-config').scrollIntoViewIfNeeded();
    await popupPage.locator('#toggle-robots-disallow').screenshot({ path: path.join(__dirname, 'issue-333-robots-disallow.png') });
    await generate();
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    paths = await requestedPaths(fixture);
    console.log('With Skip, requested:', paths.join(', '));
    if (paths.includes('/private/')) throw new Error('/private/ is disallowed and must not be requested with "Skip"');
    if (!paths.includes('/')) throw new Error('the public page should still have been requested');
    await backToConfig();

    // 3) On + Abort: the run stops with a clear message.
    await popupPage.selectOption('#select-robots-disallow-action', 'Abort');
    await generate();
    await popupPage.waitForSelector('#error-toast:not(.hidden)', { timeout: 120000 });
    const message = await popupPage.locator('#error-toast-message').textContent();
    console.log('With Abort →', message.slice(0, 140));
    if (!message.includes('robots.txt disallows') || message.includes('Traceback')) throw new Error(`Unexpected Abort message: ${message}`);

    console.log('OK — requested with the check off; skipped with "Skip"; stopped with "Abort".');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
