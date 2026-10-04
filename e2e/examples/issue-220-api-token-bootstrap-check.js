// Issue #220: real-browser check of API mode's "Auth bootstrap (token)"
// section — records the api-token-bootstrap fixture's login + data requests,
// confirms the data field, enables the bootstrap, adopts the token request
// via "Take from recording", checks the Authorization header was switched to
// "Bearer {token}", applies, and generates. The fixture issues a fresh random
// token per login, so /generate's trial run (and thus reaching the DONE
// screen) only succeeds if the generated script really runs the bootstrap
// request itself, using the one-time test value for the password.
//
// Usage: node e2e/examples/issue-220-api-token-bootstrap-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion();
  const fixture = await startFixture('api-token-bootstrap');
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
    await popupPage.click('#btn-api-capture'); // stop recording

    await focusFixture(fixturePage);
    await popupPage.click('#btn-api-search');
    await fixturePage.click('#items li:first-child .title');
    await popupPage.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    await popupPage.fill('.api-candidate-field-name', 'Titel');
    await popupPage.click('.api-candidate-confirm');
    await popupPage.waitForSelector('#screen-api-config:not(.hidden)');

    await popupPage.check('#toggle-api-bootstrap');
    await popupPage.click('#btn-api-bootstrap-from-recording');
    const likely = popupPage.locator('.api-bootstrap-recording-entry.likely');
    await likely.first().waitFor();
    const likelyUrl = await likely.first().locator('.api-candidate-path').textContent();
    if (!likelyUrl.includes('/auth/token')) throw new Error(`Expected the token request to be marked likely, got ${likelyUrl}`);
    await likely.first().click();

    const template = await popupPage.inputValue('.api-config-header-template');
    if (template !== 'Bearer {token}') throw new Error(`Expected header template "Bearer {token}", got "${template}"`);
    const valuePath = await popupPage.inputValue('.api-bootstrap-field[data-field="valuePath"]');
    if (valuePath !== 'data.access_token') throw new Error(`Expected value path data.access_token, got "${valuePath}"`);
    await popupPage.fill('.api-bootstrap-test-value[data-env-name="API_PASSWORD"]', 's3cret');
    await popupPage.locator('.api-bootstrap-test-value[data-env-name="API_PASSWORD"]').dispatchEvent('change');

    await popupPage.screenshot({ path: path.join(__dirname, 'issue-220-api-token-bootstrap.png'), fullPage: true });

    if (await popupPage.isDisabled('#btn-api-config-confirm')) throw new Error('Apply is still disabled');
    await popupPage.click('#btn-api-config-confirm');
    await waitForIdleScreen(popupPage);
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-220-api-token-bootstrap-done.png'), fullPage: true });
    console.log('OK — bootstrap adopted from recording, header wired, trial run fetched a fresh token and succeeded.');
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
