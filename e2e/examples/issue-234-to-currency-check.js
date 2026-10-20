// Issue #234: real-browser check of "Convert price/currency to number" —
// picks a price ("6,90 €") on the speisekarte fixture, adds the transform in
// the field modal, checks the live preview, then generates with the
// trial-run data preview on and checks the companion's real script run
// produced plain numbers ("6.90") for every scraped price.
//
// Runs its own companion on port 5055 (pointed at via the extension's own
// companion-URL override), so a companion a human already has running on
// the default port — possibly an older build without this transform — is
// never used or touched.
//
// Usage: node e2e/examples/issue-234-to-currency-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5055 });
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.menu-item >> nth=0 >> .item-price');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Preis');
    await popupPage.click('#btn-field-transform-add');
    await popupPage.selectOption('#field-transform-list .transform-kind-select', 'toCurrency');

    const formats = await popupPage.locator('#field-transform-list .transform-currency-format-select option').allTextContents();
    console.log('Format presets:', formats);
    const preview = await popupPage.locator('#field-transform-preview').textContent();
    console.log('Live preview:', preview);
    if (!preview.includes('6.90')) throw new Error(`Expected the live preview to show 6.90, got "${preview}"`);
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-234-to-currency.png') });

    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
    const cells = await popupPage.locator('#data-preview-table-wrap td').allTextContents();
    console.log('Trial-run values:', cells.slice(0, 6).join(', '), `… (${cells.length} total)`);
    // How many prices the clicked selector covers depends on how specific
    // buildSelector made it — the point here is that every one is converted.
    if (cells.length === 0 || cells[0] !== '6.90' || !cells.every(c => /^\d+\.\d{2}$/.test(c))) {
      throw new Error(`Expected plain decimal prices starting with 6.90, got: ${cells.join(', ')}`);
    }
    console.log('OK — live preview and the real trial run both convert "6,90 €" to "6.90".');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
