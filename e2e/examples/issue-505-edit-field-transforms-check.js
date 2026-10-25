// Issue #505: real-browser check that a field's name and transformation chain can be edited after the field was
// created, in Flat and in Container mode, on the transform-helpers fixture ("Preis: 12,99 € netto" …).
//   Flat:
//   1) a "Preis" field is created WITHOUT a transform, then its Edit button reopens the dialog: name prefilled, the pick
//      controls gone, and — because the raw value of the pick was kept with the field — the live preview works;
//   2) adding "Convert to number" shows 12.99 in the preview; Save keeps the field in place, and the REAL trial run
//      yields 12.99 / 8.5 / 6.2;
//   3) a second edit removes the step again and renames the field: the run yields the untouched text under the new name;
//   4) Cancel leaves a field untouched.
//   Container: the same on a field inside a repeating group (edit → Convert to number → trial run).
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-505-edit-field-transforms-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('transform-helpers');
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

    const generateAndRead = async () => {
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      const table = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
      await popup.click('#btn-back-to-config');
      await waitForIdleScreen(popup);
      return table;
    };

    // ── Flat ─────────────────────────────────────────────────────────────────────────────────
    await popup.click('#btn-add-field');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.product >> nth=0 >> .price');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Preis');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);

    await popup.locator('#fields-list .btn-edit-field').first().click();
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    assert(await popup.inputValue('#input-field-name') === 'Preis', 'the dialog should be prefilled with the field name');
    assert(await popup.locator('#field-name-mode-section').isHidden(), 'the pick controls (type, attribute, download) should be hidden while editing');
    assert((await popup.textContent('#btn-field-confirm')).trim() === 'Save', 'the confirm button should say Save');
    await popup.click('#btn-field-transform-add');
    await popup.locator('#field-transform-list .transform-kind-select').first().selectOption('toNumber');
    const preview = await popup.locator('#field-transform-preview').textContent();
    assert(preview.includes('12.99'), `the live preview should use the raw value kept from the pick, got "${preview}"`);
    await popup.screenshot({ path: path.join(__dirname, 'issue-505-edit-field.png') });
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);
    assert(await popup.locator('#fields-list .field-row').count() === 1, 'saving edits the field in place, no second field');

    // Cancel changes nothing.
    await popup.locator('#fields-list .btn-edit-field').first().click();
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Wird verworfen');
    await popup.click('#btn-field-cancel');
    await waitForIdleScreen(popup);
    assert((await popup.textContent('#fields-list .field-name')).trim() === 'Preis', 'Cancel must leave the name untouched');

    let table = await generateAndRead();
    assert(table.length >= 3 && table.slice(0, 3).map((r) => r[0]).join('|') === '12.99|8.5|6.2', `trial run should hold the converted prices, got ${JSON.stringify(table)}`);

    await popup.locator('#fields-list .btn-edit-field').first().click();
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.locator('#field-transform-list .btn-transform-remove').first().click();
    await popup.fill('#input-field-name', 'Preis roh');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);
    assert((await popup.textContent('#fields-list .field-name')).trim() === 'Preis roh', 'the new name should show in the list');
    table = await generateAndRead();
    assert(table[0][0] === 'Preis: 12,99 € netto', `with the step removed the raw text is expected, got ${JSON.stringify(table[0])}`);

    // ── Container ────────────────────────────────────────────────────────────────────────────
    await popup.click('#btn-mode-container');
    await popup.click('#btn-add-root-container');
    await popup.fill('#input-container-name', 'Produkt');
    await popup.check('#radio-container-repeating');
    await popup.click('#btn-container-confirm');
    await popup.waitForSelector('#screen-selecting:not(.hidden)');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.product >> nth=0', { position: { x: 700, y: 4 } });
    await waitForIdleScreen(popup);
    await popup.locator('.btn-add-subfield').first().click();
    await popup.waitForSelector('#screen-selecting:not(.hidden)');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.product >> nth=0 >> .price');
    await popup.waitForSelector('#modal-field-extended:not(.hidden)');
    await popup.fill('#input-field-extended-name', 'Preis');
    await popup.click('#btn-field-extended-confirm');
    await waitForIdleScreen(popup);

    await popup.locator('#group-tree-root .btn-edit-field').first().click();
    await popup.waitForSelector('#modal-field-extended:not(.hidden)');
    assert(await popup.inputValue('#input-field-extended-name') === 'Preis', 'the container dialog should be prefilled with the field name');
    assert(await popup.locator('#field-extended-mode-section').isHidden(), 'the pick controls should be hidden while editing');
    await popup.click('#btn-field-extended-transform-add');
    await popup.locator('#field-extended-transform-list .transform-kind-select').first().selectOption('toNumber');
    assert((await popup.locator('#field-extended-transform-preview').textContent()).includes('12.99'), 'the container preview should use the kept raw value');
    await popup.click('#btn-field-extended-confirm');
    await waitForIdleScreen(popup);
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    await popup.waitForSelector('#data-preview-text:not(.hidden)'); // a tree is previewed as an XML text sample
    const sample = await popup.locator('#data-preview-text').textContent();
    assert(sample.includes('12.99') && !sample.includes('€'), `the container trial run should hold the converted price, got ${sample.slice(0, 300)}`);

    console.log('OK — a field\'s name and transformations were edited after creation (Flat and Container); the real trial runs followed.');
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
