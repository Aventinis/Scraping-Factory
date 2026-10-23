// Issue #321: real-browser check of API mode's Link-header pagination —
// records the api-link-pagination fixture's page 1 + page 2 requests (each
// answered with a `Link: <...>; rel="next"` header and no cursor in the body),
// confirms a data field, sees the "Follow the Link header" option suggested,
// enables it, applies, and generates. The fixture serves two items per page
// and seven in total, so the trial run's data preview only shows all seven
// rows if the generated script really follows every page's Link header.
//
// Runs its own companion on port 5057, so a companion a human already has
// running on the default port (possibly an older build) is never used or touched.
//
// Usage: node e2e/examples/issue-321-api-link-pagination-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5057 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5057 — stop it first.');
  const fixture = await startFixture('api-link-pagination');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5057' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-mode-api');
    await popupPage.click('#btn-api-capture'); // start recording
    await fixturePage.click('#btn-load');
    await fixturePage.waitForSelector('#items li');
    await fixturePage.click('#btn-more');
    await fixturePage.waitForFunction(() => document.querySelectorAll('#items li').length === 4);
    await popupPage.click('#btn-api-capture'); // stop recording

    await focusFixture(fixturePage);
    await popupPage.click('#btn-api-search');
    await fixturePage.click('#items li:first-child .title');
    await popupPage.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    await popupPage.fill('.api-candidate-field-name', 'Titel');
    await popupPage.click('.api-candidate-confirm');
    await popupPage.waitForSelector('#screen-api-config:not(.hidden)');

    // The recorded page-1 response carried a rel="next" Link header, so the
    // section nudges towards it (and stays hidden once it is switched on).
    if (await popupPage.isHidden('#api-link-detected-hint')) throw new Error('The recorded Link header should have been suggested');
    await popupPage.check('#toggle-api-link');
    if (!(await popupPage.isHidden('#api-link-detected-hint'))) throw new Error('The suggestion should disappear once the option is on');
    // Exclusive with the cursor section.
    await popupPage.click('#api-cursor-advanced > summary'); // Issue #404: the cursor option sits under "Advanced" too
    await popupPage.check('#toggle-api-cursor');
    if (await popupPage.isChecked('#toggle-api-link')) throw new Error('Cursor and Link-header pagination must exclude each other');
    await popupPage.check('#toggle-api-link');
    if (await popupPage.isChecked('#toggle-api-cursor')) throw new Error('Cursor and Link-header pagination must exclude each other');

    await popupPage.screenshot({ path: path.join(__dirname, 'issue-321-api-link-pagination.png'), fullPage: true });

    if (await popupPage.isDisabled('#btn-api-config-confirm')) throw new Error('Apply is still disabled');
    await popupPage.click('#btn-api-config-confirm');
    await waitForIdleScreen(popupPage);
    await focusFixture(fixturePage);
    // The data-preview toggle is a global preference on the Settings screen.
    await popupPage.click('#btn-open-settings');
    await popupPage.check('#toggle-include-data-preview');
    await popupPage.click('#btn-close-settings');
    await waitForIdleScreen(popupPage);
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
    // A recorded API response is a tree shape, so the preview is the XML text sample.
    const preview = await popupPage.locator('#data-preview-text').textContent();
    for (let n = 1; n <= 7; n++) {
      if (!preview.includes(`Artikel ${n}<`)) throw new Error(`Item "Artikel ${n}" is missing from the data preview — the Link chain stopped early:\n${preview}`);
    }
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-321-api-link-pagination-done.png'), fullPage: true });
    console.log('OK — Link-header option suggested from the recording, trial run followed the Link chain (7 rows from 4 pages).');
  } catch (err) {
    const toast = await (await browser.context.pages()).at(-1)?.locator('#error-toast-message').textContent().catch(() => null);
    if (toast) console.error('Toast:', toast);
    throw err;
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
