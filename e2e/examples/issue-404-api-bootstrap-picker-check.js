// Issue #404: real-browser check of the JSON-path picker for the auth bootstrap's
// token path (api-token-bootstrap fixture: the data endpoint only answers to a
// token the login request issued a moment ago).
//   - the option sits under a collapsed "Advanced" with a one-line summary;
//   - after "Take from recording" the token path is cleared on purpose and picked
//     again from the recorded response of the token request — the tree shows the
//     response (data.access_token) and a click fills the path;
//   - the REAL trial run fetches a fresh token with it.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-404-api-bootstrap-picker-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('api-token-bootstrap');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    await popup.click('#btn-mode-api');
    await popup.click('#btn-api-capture');
    await fixturePage.click('#btn-load');
    await fixturePage.waitForSelector('#items li');
    await popup.click('#btn-api-capture');
    await focusFixture(fixturePage);
    await popup.click('#btn-api-search');
    await fixturePage.click('#items li:first-child .title');
    await popup.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    await popup.fill('.api-candidate-field-name', 'Titel');
    await popup.click('.api-candidate-confirm');
    await popup.waitForSelector('#screen-api-config:not(.hidden)');

    // Advanced + summary.
    const advanced = popup.locator('#api-bootstrap-advanced');
    assert(!(await advanced.evaluate((el) => el.open)), 'the bootstrap option should start collapsed');
    assert(/the API needs a login token first/.test(await advanced.locator('> summary').textContent()), 'summary says when it applies');
    await advanced.locator('> summary').click();
    await popup.check('#toggle-api-bootstrap');

    // Adopt the token request, then throw its detected path away and pick it again.
    await popup.click('#btn-api-bootstrap-from-recording');
    const likely = popup.locator('.api-bootstrap-recording-entry.likely').first();
    await likely.waitFor();
    await likely.click();
    const valuePath = popup.locator('.api-bootstrap-field[data-field="valuePath"]');
    assert(await valuePath.inputValue() === 'data.access_token', 'the recording should have detected the token path');
    await valuePath.fill('');
    await valuePath.blur();
    assert(await popup.inputValue('.api-bootstrap-field[data-field="valuePath"]') === '', 'the path is cleared');

    await popup.click('.json-path-open[data-field="bootstrap.valuePath"]');
    await popup.waitForSelector('.json-path-pick[data-path="data.access_token"]');
    assert(/Recorded: POST .*\/auth\/token/.test(await popup.locator('.json-path-source').textContent()), 'the tree comes from the token request\'s own response');
    const preview = await popup.locator('.json-path-pick[data-path="data.access_token"] .json-path-preview').textContent();
    assert(preview.length > 5, `the token's value is previewed, got ${preview}`);
    await popup.locator('#api-bootstrap-config').screenshot({ path: path.join(__dirname, 'issue-404-api-bootstrap-picker.png') });
    await popup.click('.json-path-pick[data-path="data.access_token"]');
    assert(await popup.inputValue('.api-bootstrap-field[data-field="valuePath"]') === 'data.access_token', 'the token path is picked');
    console.log('token path picked from the recorded response');

    // The real run fetches a fresh token with it.
    await popup.fill('.api-bootstrap-test-value[data-env-name="API_PASSWORD"]', 's3cret');
    await popup.locator('.api-bootstrap-test-value[data-env-name="API_PASSWORD"]').dispatchEvent('change');
    assert(!(await popup.isDisabled('#btn-api-config-confirm')), 'Apply should be enabled');
    await popup.click('#btn-api-config-confirm');
    await waitForIdleScreen(popup);
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    console.log('OK — token path picked from the recording, trial run fetched a fresh token and succeeded.');
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
