// Issue #279: real-browser check of transform-chain presets — on the
// speisekarte fixture, picks a price, applies the built-in "clean up price"
// preset in the field modal (live preview must show 6.90), saves the chain
// as an own preset, then finds and deletes it on the Settings screen.
//
// Runs its own companion on port 5055 with a throwaway presets database, so
// neither a human's already-running companion nor their real
// transform-presets.db is ever used or touched.
//
// Usage: node e2e/examples/issue-279-transform-presets-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `sf-e2e-transform-presets-${Date.now()}.db`);
process.env.Companion__TransformPresetsDbPath = dbPath;

const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5055' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.menu-item >> nth=0 >> .item-price');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Preis');

    const applySelect = '#modal-field-name .transform-preset-apply-select';
    await popupPage.selectOption(applySelect, 'builtin:price-comma-decimal');
    const kinds = await popupPage.locator('#field-transform-list .transform-kind-select').evaluateAll(els => els.map(e => e.value));
    const preview = await popupPage.locator('#field-transform-preview').textContent();
    console.log('Applied built-in preset →', kinds.join(' → '), '| live preview:', preview);
    if (kinds.join(',') !== 'trim,toCurrency' || !preview.includes('6.90')) throw new Error('Built-in preset did not apply as expected');

    await popupPage.click('#modal-field-name .btn-transform-preset-save');
    await popupPage.fill('#modal-field-name .transform-preset-name-input', 'E2E Preis');
    await popupPage.click('#modal-field-name .btn-transform-preset-save-confirm');
    await popupPage.waitForFunction(sel => Array.from(document.querySelector(sel).options).some(o => o.textContent === 'E2E Preis'), applySelect);
    console.log('Saved own preset "E2E Preis" — now offered in the dropdown.');
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-279-transform-presets.png') });

    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);
    await popupPage.click('#btn-open-settings');
    const ownRow = popupPage.locator('#transform-presets-list .transform-preset-row', { hasText: 'E2E Preis' });
    await ownRow.waitFor();
    console.log('Settings row:', (await ownRow.locator('.transform-preset-summary').textContent()));
    await ownRow.locator('.btn-transform-preset-delete').click();
    await ownRow.locator('.btn-transform-preset-delete-yes').click();
    await ownRow.waitFor({ state: 'detached' });
    console.log('OK — built-in preset applies, own preset saves, shows up in Settings and deletes again.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
    fs.rmSync(dbPath, { force: true });
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
