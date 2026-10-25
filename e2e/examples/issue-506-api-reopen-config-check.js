// Issue #506: real-browser check that an applied API configuration can be reopened with Edit, changed and applied again.
//   1) POST source (api-nested-and-post): record the search, use a product title (the name is taken from the path), Apply;
//      Edit shows the tree as applied; renaming and Cancel leave the confirmed configuration untouched;
//      Edit again, rename the field, add a second field from the recording ("+ Data field") and Apply;
//      the REAL trial run holds exactly the edit (<Titel>…</Titel> and <sku>…</sku>, no <title>);
//   2) embedded-JSON source (embedded-json-menu): the same round trip without any recording.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-506-api-reopen-config-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withPage(fixtureName, run) {
  const fixture = await startFixture(fixtureName);
  const browser = await launchBrowser();
  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({
      language: 'en', companionUrlOverride: 'http://localhost:5055', globalSettings: { includeDataPreview: true },
    }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await run({ popup, fixturePage, browser });
  } catch (err) {
    const toast = await (await browser.context.pages()).at(-1)?.locator('#error-toast-message').textContent().catch(() => null);
    if (toast) console.error('Toast:', toast);
    throw err;
  } finally {
    await browser.close();
    await fixture.stop();
  }
}

const treeNames = (popup) => popup.evaluate(() => [...document.querySelectorAll('#api-tree-root .api-tree-name')].map((i) => i.value));

async function renameLeaf(popup, from, to) {
  const index = (await treeNames(popup)).indexOf(from);
  assert(index !== -1, `expected a tree row named "${from}", got ${await treeNames(popup)}`);
  const input = popup.locator('#api-tree-root .api-tree-name').nth(index);
  await input.fill(to);
  await input.blur();
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');

  try {
    // ── 1) POST source ───────────────────────────────────────────────────────────────────────
    await withPage('api-nested-and-post', async ({ popup, fixturePage }) => {
      await popup.click('#btn-mode-api');
      await popup.click('#btn-api-capture');
      await fixturePage.click('#btn-reload-search');
      await fixturePage.waitForSelector('#result-search .product-title');
      await popup.click('#btn-api-capture');
      await focusFixture(fixturePage);
      await popup.click('#btn-api-search');
      await fixturePage.click('#result-search .product-title >> nth=0');
      await popup.waitForSelector('#api-candidates-list .api-candidate-confirm', { state: 'visible' });
      await popup.locator('#api-candidates-list .api-candidate-confirm').first().click();
      await popup.waitForSelector('#screen-api-config:not(.hidden)');
      await popup.click('#btn-api-config-confirm');
      await waitForIdleScreen(popup);

      assert(await popup.locator('#btn-api-config-edit').isVisible(), 'the API panel should offer Edit after Apply');
      await popup.screenshot({ path: path.join(__dirname, 'issue-506-api-panel.png') });

      // Edit shows the configuration as applied; Cancel after a change leaves it untouched.
      await popup.click('#btn-api-config-edit');
      await popup.waitForSelector('#screen-api-config:not(.hidden)');
      const applied = await treeNames(popup);
      assert(applied.includes('title'), `the reopened tree should hold the applied field "title", got ${applied}`);
      await renameLeaf(popup, 'title', 'Wird verworfen');
      await popup.click('#btn-api-config-cancel');
      await waitForIdleScreen(popup);
      await popup.click('#btn-api-config-edit');
      await popup.waitForSelector('#screen-api-config:not(.hidden)');
      assert((await treeNames(popup)).join('|') === applied.join('|'), `Cancel must leave the configuration unchanged, got ${await treeNames(popup)}`);

      // The real edit: rename, add a field from the recording, apply.
      await renameLeaf(popup, 'title', 'Titel');
      await popup.locator('#api-tree-root .btn-add-api-subfield').last().click();
      await focusFixture(fixturePage);
      await fixturePage.click('#result-search .product-sku >> nth=0');
      await popup.waitForSelector('#api-tree-search-list .api-candidate-confirm', { state: 'visible' });
      await popup.locator('#api-tree-search-list .api-candidate-confirm').first().click();
      await popup.waitForSelector('#api-tree-search-panel', { state: 'hidden' });
      assert((await treeNames(popup)).includes('sku'), `the added field should be named "sku", got ${await treeNames(popup)}`);
      await popup.click('#btn-api-config-confirm');
      await waitForIdleScreen(popup);

      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      await popup.waitForSelector('#data-preview-text:not(.hidden)');
      const sample = await popup.locator('#data-preview-text').textContent();
      assert(sample.includes('<Titel>Smartphone X</Titel>') && sample.includes('<sku>P-100</sku>') && !sample.includes('<title>'),
        `the trial run should hold exactly the edit, got ${sample.slice(0, 500)}`);
    });

    // ── 2) embedded-JSON source ──────────────────────────────────────────────────────────────
    await withPage('embedded-json-menu', async ({ popup, fixturePage }) => {
      await popup.click('#btn-mode-api');
      await popup.click('#btn-api-search');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('.menu-item >> nth=0 >> .item-name');
      await popup.waitForSelector('#api-candidates-list .api-candidate-confirm', { state: 'visible' });
      await popup.locator('#api-candidates-list .api-candidate-confirm').first().click();
      await popup.waitForSelector('#screen-api-config:not(.hidden)');
      await popup.click('#btn-api-config-confirm');
      await waitForIdleScreen(popup);

      await popup.click('#btn-api-config-edit');
      await popup.waitForSelector('#screen-api-config:not(.hidden)');
      await renameLeaf(popup, 'name', 'Gericht');
      await popup.locator('#api-tree-root .btn-add-api-subfield').last().click();
      await focusFixture(fixturePage);
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('.menu-item >> nth=0 >> .item-description');
      await popup.waitForSelector('#api-tree-search-list .api-candidate-confirm', { state: 'visible' });
      await popup.locator('#api-tree-search-list .api-candidate-confirm').first().click();
      await popup.waitForSelector('#api-tree-search-panel', { state: 'hidden' });
      await popup.click('#btn-api-config-confirm');
      await waitForIdleScreen(popup);

      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      await popup.waitForSelector('#data-preview-text:not(.hidden)');
      const sample = await popup.locator('#data-preview-text').textContent();
      assert(sample.includes('<Gericht>Hausgemachte Leberknödelsuppe</Gericht>') && sample.includes('<description>') && !sample.includes('<name>Haus'),
        `the embedded-JSON trial run should hold exactly the edit, got ${sample.slice(0, 500)}`);
    });

    console.log('OK — an applied API configuration was reopened, changed and applied again (POST and embedded JSON); Cancel changed nothing.');
  } finally {
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
