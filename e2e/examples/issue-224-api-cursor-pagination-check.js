// Issue #224: real-browser check of API mode's cursor/token pagination —
// records the api-cursor-pagination fixture's page 1 + page 2 requests,
// confirms a data field, enables "Follow a next-page cursor", lets
// "Detect from recording" fill the paths (response cursor, has-more flag, and
// the `cursor` query parameter seen on page 2), applies, and generates. The
// fixture serves two items per page and seven in total behind opaque cursors,
// so the trial run's data preview only shows all seven rows if the generated
// script really follows every page's cursor.
//
// Usage: node e2e/examples/issue-224-api-cursor-pagination-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion();
  const fixture = await startFixture('api-cursor-pagination');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
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

    await popupPage.check('#toggle-api-cursor');
    if (!(await popupPage.isDisabled('#btn-api-config-confirm'))) throw new Error('Apply should be blocked while the cursor section is incomplete');
    await popupPage.click('#btn-api-cursor-detect');
    await popupPage.waitForFunction(() => document.querySelector('.api-cursor-field[data-field="nextCursorPath"]')?.value);

    const expected = { nextCursorPath: 'pageInfo.endCursor', hasNextPagePath: 'pageInfo.hasNextPage', queryParameterName: 'cursor' };
    for (const [field, value] of Object.entries(expected)) {
      const actual = await popupPage.inputValue(`.api-cursor-field[data-field="${field}"]`);
      if (actual !== value) throw new Error(`Expected ${field} "${value}", got "${actual}"`);
    }

    await popupPage.screenshot({ path: path.join(__dirname, 'issue-224-api-cursor-pagination.png'), fullPage: true });

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
      if (!preview.includes(`Artikel ${n}<`)) throw new Error(`Item "Artikel ${n}" is missing from the data preview — the cursor chain stopped early:\n${preview}`);
    }
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-224-api-cursor-pagination-done.png'), fullPage: true });
    console.log('OK — cursor settings detected from the recording, trial run followed the cursor chain (7 rows from 4 pages).');
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
