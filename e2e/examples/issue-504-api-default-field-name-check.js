// Issue #504: real-browser check that "Use" works without a typed field name in API mode. The field is named after the
// last segment of the clicked JSON path; a typed name wins; a second "Use" for the same key never produces a duplicate.
//   1) first field: click a product title, the placeholder shows "title", Use with the input left empty;
//   2) second field in the same group: click a SKU, type "Artikel", Use;
//   3) third field: the same title again, the placeholder already shows "title_2", Use with the input left empty;
//   4) Apply and run for real: the trial run's XML sample carries the three element names with their values.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-504-api-default-field-name-check.js
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

    const treeNames = () => popup.evaluate(() => [...document.querySelectorAll('#api-tree-root .api-tree-name')].map((i) => i.value));

    // 1) Record the POST search, click a title, Use with the empty input.
    await popup.click('#btn-mode-api');
    await popup.click('#btn-api-capture');
    await fixturePage.click('#btn-reload-search');
    await fixturePage.waitForSelector('#result-search .product-title');
    await popup.click('#btn-api-capture'); // stop
    await focusFixture(fixturePage);
    await popup.click('#btn-api-search');
    await fixturePage.click('#result-search .product-title >> nth=0');
    await popup.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    const input = popup.locator('#api-candidates-list .api-candidate-field-name').first();
    assert(await input.getAttribute('placeholder') === 'title', `the placeholder should show the name taken from the path, got "${await input.getAttribute('placeholder')}"`);
    assert(await input.inputValue() === '', 'the input itself stays empty');
    assert(!(await popup.locator('#api-candidates-list .api-candidate-confirm').first().isDisabled()), 'Use must be enabled without a typed name');
    await popup.locator('#api-candidates-list .api-candidate-confirm').first().click();
    await popup.waitForSelector('#screen-api-config:not(.hidden)');
    assert((await treeNames()).includes('title'), `the field should be named "title", tree: ${await treeNames()}`);

    // 2) A typed name wins: a SKU, named "Artikel".
    const addSubfield = popup.locator('#api-tree-root .btn-add-api-subfield');
    await addSubfield.last().click(); // the innermost group, the one holding the product fields
    await focusFixture(fixturePage);
    await fixturePage.click('#result-search .product-sku >> nth=0');
    await popup.waitForSelector('#api-tree-search-list .api-candidate-field-name', { state: 'visible' });
    const skuInput = popup.locator('#api-tree-search-list .api-candidate-field-name').first();
    assert(await skuInput.getAttribute('placeholder') === 'sku', 'the placeholder for the SKU should be "sku"');
    await skuInput.fill('Artikel');
    await popup.locator('#api-tree-search-list .api-candidate-confirm').first().click();
    await popup.waitForSelector('#api-tree-search-panel', { state: 'hidden' });
    assert((await treeNames()).includes('Artikel'), `the typed name should win, tree: ${await treeNames()}`);

    // 3) The same key again: the name is taken, so the counter is appended.
    await addSubfield.last().click();
    await focusFixture(fixturePage);
    await fixturePage.click('#result-search .product-title >> nth=0');
    await popup.waitForSelector('#api-tree-search-list .api-candidate-field-name', { state: 'visible' });
    const againInput = popup.locator('#api-tree-search-list .api-candidate-field-name').first();
    assert(await againInput.getAttribute('placeholder') === 'title_2', `the placeholder should already show the counter, got "${await againInput.getAttribute('placeholder')}"`);
    await popup.locator('#api-tree-search-list .api-candidate-confirm').first().click();
    await popup.waitForSelector('#api-tree-search-panel', { state: 'hidden' });
    const names = await treeNames();
    assert(names.filter((n) => n === 'title').length === 1 && names.includes('title_2'), `expected title and title_2 exactly once, tree: ${names}`);

    // 4) Apply and run for real.
    await popup.click('#btn-api-config-confirm');
    await waitForIdleScreen(popup);
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    await popup.waitForSelector('#data-preview-text:not(.hidden)');
    const sample = await popup.locator('#data-preview-text').textContent();
    for (const expected of ['<title>Smartphone X</title>', '<Artikel>P-100', '<title_2>Smartphone X</title_2>']) {
      assert(sample.includes(expected), `the trial run's sample should contain ${expected}: ${sample.slice(0, 600)}`);
    }
    console.log('OK — Use without a typed name: "title", "Artikel" (typed) and "title_2" (counter) reached the generated script.');
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
