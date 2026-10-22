// Issue #292: real-browser check of the "Skip the trial run" preference. The
// flaky-server fixture answers a generated script's first request with 503,
// so with the trial run Generate fails; with the preference ticked on the
// Settings screen the same configuration must reach the DONE screen right
// away, with the companion's "disabled in Settings" warning toast.
//
// Runs its own companion on port 5056, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-292-skip-verification-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5056 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5056 — stop it first.');
  const fixture = await startFixture('flaky-server');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5056' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.offer >> nth=0 >> .name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Name');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    // 1) With the trial run: the script's first request gets the 503.
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#error-toast:not(.hidden)', { timeout: 60000 });
    const failure = await popupPage.locator('#error-toast').textContent(); // title + hint + original text (Issue #401)
    console.log('With trial run →', failure.slice(0, 120));
    if (!failure.includes('HTTP 503')) throw new Error(`Expected the trial run to fail with the 503, got: ${failure}`);
    await waitForIdleScreen(popupPage);
    await popupPage.evaluate(() => document.getElementById('error-toast').classList.add('hidden'));

    // 2) Skip the trial run (a global preference on the Settings screen).
    await popupPage.click('#btn-open-settings');
    await popupPage.check('#toggle-skip-verification');
    await popupPage.locator('#toggle-skip-verification').scrollIntoViewIfNeeded();
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-292-skip-verification-settings.png'), fullPage: true });
    await popupPage.click('#btn-close-settings');
    await waitForIdleScreen(popupPage);

    await focusFixture(fixturePage);
    const started = Date.now();
    await popupPage.click('#btn-generate');
    try {
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 20000 });
    } catch (err) {
      const shown = await popupPage.locator('#error-toast-message').textContent().catch(() => null);
      throw new Error(`DONE screen not reached (toast: ${shown})`);
    }
    console.log(`Skipped → DONE after ${Date.now() - started} ms`);
    const toast = popupPage.locator('#error-toast');
    await toast.waitFor({ state: 'visible', timeout: 5000 });
    const text = await popupPage.locator('#error-toast-message').textContent();
    console.log('Toast →', text.slice(0, 120));
    if (!text.includes('disabled in Settings')) throw new Error(`Expected the "disabled in Settings" warning, got: ${text}`);
    if (!(await toast.evaluate((el) => el.classList.contains('toast-warn')))) throw new Error('The skip notice should be a warning, not an error');
    console.log('OK — fails with the trial run, reaches DONE with the skip warning once it is switched off.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
