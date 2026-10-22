// Issue #404: real-browser check of the JSON-path picker for API mode's cursor
// pagination (api-cursor-pagination fixture: two items per page behind opaque
// cursors, seven in total). The paths are picked from the recorded response
// instead of typed or detected:
//   - the cursor option sits under a collapsed "Advanced" with a one-line summary
//     and a "?" popover;
//   - "Pick from the recording" shows the recorded response as a tree; clicking
//     pageInfo.endCursor / pageInfo.hasNextPage fills the two paths;
//   - the REAL trial run follows every cursor and the preview holds all seven items.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-404-api-cursor-picker-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('api-cursor-pagination');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    await popup.click('#btn-mode-api');
    await popup.click('#btn-api-capture');
    await fixturePage.click('#btn-load');
    await fixturePage.waitForSelector('#items li');
    await fixturePage.click('#btn-more');
    await fixturePage.waitForFunction(() => document.querySelectorAll('#items li').length === 4);
    await popup.click('#btn-api-capture');
    await focusFixture(fixturePage);
    await popup.click('#btn-api-search');
    await fixturePage.click('#items li:first-child .title');
    await popup.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    await popup.fill('.api-candidate-field-name', 'Titel');
    await popup.click('.api-candidate-confirm');
    await popup.waitForSelector('#screen-api-config:not(.hidden)');

    // 1) "Advanced" with a one-line summary and a "?".
    const advanced = popup.locator('#api-cursor-advanced');
    assert(!(await advanced.evaluate((el) => el.open)), 'the cursor option should start collapsed');
    assert(/the next page's cursor is in the response/.test(await advanced.locator('> summary').textContent()), 'summary says when it applies');
    await advanced.locator('> summary').click();
    const help = popup.locator('#api-cursor-section .help-btn').first();
    await help.click();
    const panel = popup.locator(`#${await help.getAttribute('aria-controls')}`);
    assert(/only reveal the next page's cursor inside the current response/.test(await panel.locator('.help-popover-text').textContent()), 'popover text');
    assert(await panel.locator('.help-popover-example').textContent() === 'pageInfo.endCursor', 'popover example');
    await popup.keyboard.press('Escape');

    // 2) Pick instead of type.
    await popup.check('#toggle-api-cursor');
    await popup.fill('.api-cursor-field[data-field="queryParameterName"]', 'cursor');
    await popup.locator('.api-cursor-field[data-field="queryParameterName"]').blur();
    await popup.click('.json-path-open[data-field="cursor.nextCursorPath"]');
    await popup.waitForSelector('.json-path-pick[data-path="pageInfo.endCursor"]');
    const source = await popup.locator('.json-path-source').textContent();
    assert(/Recorded: GET .*\/api\/items/.test(source), `the source should name the recorded request, got ${source}`);
    const offered = await popup.$$eval('.json-path-pick', (buttons) => buttons.map((b) => b.dataset.path));
    assert(offered.includes('pageInfo.endCursor') && offered.includes('pageInfo.hasNextPage'), `the tree should offer the cursor and the flag: ${JSON.stringify(offered)}`);
    await popup.locator('#api-cursor-config').screenshot({ path: path.join(__dirname, 'issue-404-api-cursor-picker.png') });
    await popup.click('.json-path-pick[data-path="pageInfo.endCursor"]');
    assert(await popup.inputValue('.api-cursor-field[data-field="nextCursorPath"]') === 'pageInfo.endCursor', 'the cursor path is filled in');
    assert(await popup.locator('.json-path-panel').count() === 0, 'the panel closes after a pick');

    await popup.click('.json-path-open[data-field="cursor.hasNextPagePath"]');
    await popup.click('.json-path-pick[data-path="pageInfo.hasNextPage"]');
    assert(await popup.inputValue('.api-cursor-field[data-field="hasNextPagePath"]') === 'pageInfo.hasNextPage', 'the flag path is filled in');
    console.log('both paths picked from the recorded response');

    // 3) The real run follows every cursor.
    assert(!(await popup.isDisabled('#btn-api-config-confirm')), 'Apply should be enabled');
    await popup.click('#btn-api-config-confirm');
    await waitForIdleScreen(popup);
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    const preview = await popup.locator('#data-preview-text').textContent();
    for (let n = 1; n <= 7; n++) assert(preview.includes(`Artikel ${n}<`), `item "Artikel ${n}" is missing — the cursor chain stopped early:\n${preview}`);
    console.log('OK — cursor paths picked from the recording, trial run followed the chain (7 items).');
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
