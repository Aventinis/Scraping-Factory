// Issue #390: real-browser check of API mode's API_CONFIG screen after the
// api-config-ui.ts split — records the POST search of the api-nested-and-post
// fixture, confirms a field plus all its sibling fields, then exercises each
// extracted area on the way to a real Generate:
//   - response tree: remove a field row (this used to throw a ReferenceError since
//     #389), add a group through its modal, open and cancel the transforms modal;
//   - request body tree: turn the literal `category` into a variable, create the new
//     parameter through its modal;
//   - parameter sources: give that parameter a value list;
//   - the REAL trial run then requests every value and the preview shows both
//     categories' products (electronics and books).
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-390-api-config-ui-check.js
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('api-nested-and-post');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // 1) Record the POST search and find a value in it (capture + candidate list).
    await popup.click('#btn-mode-api');
    await popup.click('#btn-api-capture');
    await fixturePage.click('#btn-reload-search');
    await fixturePage.waitForSelector('#result-search .product-title');
    await popup.click('#btn-api-capture'); // stop
    await focusFixture(fixturePage);
    await popup.click('#btn-api-search');
    await fixturePage.click('#result-search .product-title >> nth=0');
    await popup.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    assert(/POST/.test(await popup.locator('.api-candidate').first().textContent()), 'the candidate should come from the recorded POST request');
    await popup.fill('.api-candidate-field-name', 'Titel');
    const selectAll = popup.locator('.api-sibling-select-all');
    if (await selectAll.count()) await selectAll.first().click();
    await popup.click('.api-candidate-confirm');
    await popup.waitForSelector('#screen-api-config:not(.hidden)');

    // 2) Response tree.
    const nodes = popup.locator('#api-tree-root .api-tree-node');
    const before = await nodes.count();
    assert(before >= 3, `expected a group with several fields, got ${before} rows`);
    const lastField = nodes.last();
    await lastField.locator('.btn-remove-api-node').first().click();
    assert(await nodes.count() === before - 1, 'removing a field row should drop exactly that row');

    await popup.locator('#api-tree-root .btn-add-api-subgroup').first().click();
    await popup.waitForSelector('#modal-api-group-new:not(.hidden)');
    await popup.fill('#input-api-group-name', 'Tags');
    await popup.fill('#input-api-group-path', 'tags');
    await popup.click('#btn-api-group-confirm');
    await popup.waitForSelector('#modal-api-group-new', { state: 'hidden' });
    assert(await nodes.count() === before, 'the new group should appear in the tree');
    assert(await popup.evaluate(() => [...document.querySelectorAll('#api-tree-root .api-tree-name')].some((i) => i.value === 'Tags')), 'the new group is named "Tags"');

    await popup.locator('#api-tree-root .btn-api-field-transforms').first().click();
    await popup.waitForSelector('#modal-api-field-transforms:not(.hidden)');
    await popup.click('#btn-api-field-transforms-cancel');
    await popup.waitForSelector('#modal-api-field-transforms', { state: 'hidden' });

    // An empty group is not a valid configuration, so take it out again.
    await popup.evaluate(() => {
      const row = [...document.querySelectorAll('#api-tree-root .api-tree-node')].find((li) => li.querySelector(':scope > .api-tree-row .api-tree-name').value === 'Tags');
      row.querySelector(':scope > .api-tree-row .btn-remove-api-node').click();
    });
    assert(await nodes.count() === before - 1, 'removing the group should drop its row');

    // 3) Request body tree: the literal category becomes a new variable.
    await popup.locator('#body-tree-root .btn-body-to-variable').first().click();
    await popup.selectOption('#body-tree-root .body-tree-parameter-picker', '__new__');
    await popup.waitForSelector('#modal-api-body-parameter-new:not(.hidden)');
    await popup.fill('#input-api-body-parameter-name', 'category');
    await popup.click('#btn-api-body-parameter-confirm');
    await popup.waitForSelector('#modal-api-body-parameter-new', { state: 'hidden' });

    // 4) Parameter source: a value list with both categories.
    const radio = popup.locator('.api-config-source-kind-radio[value="staticList"]').first();
    await radio.check();
    await popup.fill('.api-config-static-list', 'electronics\nbooks');
    await popup.locator('.api-config-static-list').blur();
    assert(!(await popup.isDisabled('#btn-api-config-confirm')), 'Apply should be enabled once the parameter has its values');

    // 5) Apply and run for real.
    await popup.click('#btn-api-config-confirm');
    await waitForIdleScreen(popup);
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    // A tree-shaped response is previewed as an XML text sample.
    await popup.waitForSelector('#data-preview-text:not(.hidden)');
    const sample = await popup.locator('#data-preview-text').textContent();
    assert(sample.includes('Smartphone X'), `electronics products expected in the preview: ${sample.slice(0, 300)}`);
    assert(sample.includes('Der Nordwind'), `the second category (books) expected in the preview: ${sample.slice(0, 300)}`);
    console.log('OK — API_CONFIG screen end to end: both categories were requested by the trial run.');
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
