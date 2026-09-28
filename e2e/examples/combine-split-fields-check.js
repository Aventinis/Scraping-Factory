// Manual real-browser verification for Issue #206 follow-up's dedicated
// "Felder kombinieren"/"Feld aufteilen" creation flow — see CLAUDE.md.
// Usage: node e2e/examples/combine-split-fields-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  console.log('Starting companion...');
  const companion = await startCompanion();
  console.log(companion.alreadyRunning ? '  (already running)' : '  started');

  console.log('Starting speisekarte fixture...');
  const fixture = await startFixture('speisekarte');
  console.log(`  serving at ${fixture.url}`);

  console.log('Launching browser with the unpacked extension...');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);

    const popupPage = await openPopup(browser.context, browser.extensionId);
    popupPage.on('console', (msg) => console.log('  [popup console]', msg.type(), msg.text()));
    popupPage.on('pageerror', (err) => console.log('  [popup pageerror]', err.message));
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    // ── Flat mode: pick two ordinary fields ──────────────────────────────
    async function pickField(cssSelector, name) {
      await focusFixture(fixturePage);
      await popupPage.locator('#btn-add-field').click();
      await focusFixture(fixturePage);
      await fixturePage.locator(cssSelector).first().click();
      await popupPage.locator('#input-field-name').waitFor({ state: 'visible', timeout: 10000 });
      await popupPage.locator('#input-field-name').fill(name);
      await popupPage.locator('#btn-field-confirm').click();
    }

    console.log('Step 1: buttons disabled with 0/1 real fields...');
    let combineDisabled = await popupPage.locator('#btn-add-combine-field').isDisabled();
    let splitDisabled = await popupPage.locator('#btn-add-split-field').isDisabled();
    assert(combineDisabled, 'Expected "Felder kombinieren" disabled with 0 fields');
    assert(splitDisabled, 'Expected "Feld aufteilen" disabled with 0 fields');

    await pickField('.item-name', 'Titel');
    splitDisabled = await popupPage.locator('#btn-add-split-field').isDisabled();
    combineDisabled = await popupPage.locator('#btn-add-combine-field').isDisabled();
    assert(!splitDisabled, 'Expected "Feld aufteilen" enabled with 1 field');
    assert(combineDisabled, 'Expected "Felder kombinieren" still disabled with 1 field');

    await pickField('.item-price', 'Preis');
    combineDisabled = await popupPage.locator('#btn-add-combine-field').isDisabled();
    assert(!combineDisabled, 'Expected "Felder kombinieren" enabled with 2 fields');
    console.log('  OK — disabled-state gating matches field count');

    // ── Step 2: open the combine modal, no click-based selection ────────
    console.log('Step 2: opening "Felder kombinieren" — must not enter selecting mode...');
    await popupPage.locator('#btn-add-combine-field').click();
    await popupPage.locator('#modal-combine-field').waitFor({ state: 'visible', timeout: 5000 });
    const selectingVisible = await popupPage.locator('#screen-selecting').isVisible();
    assert(!selectingVisible, 'Expected #screen-selecting to stay hidden — combine flow needs no click-based selection');

    const checkboxNames = await popupPage.locator('#combine-field-source-list .combine-field-source-checkbox').evaluateAll(
      (els) => els.map((el) => el.dataset.fieldName)
    );
    assert(JSON.stringify(checkboxNames) === JSON.stringify(['Titel', 'Preis']), `Expected checkbox list ['Titel','Preis'], got ${JSON.stringify(checkboxNames)}`);
    console.log('  OK — modal opened directly with a real checkbox list:', checkboxNames);

    // ── Step 3+4: confirm with remove-originals checked ──────────────────
    await popupPage.locator('#input-combine-field-name').fill('TitelUndPreis');
    await popupPage.locator('#combine-field-source-list .combine-field-source-checkbox').first().check();
    await popupPage.locator('#combine-field-source-list .combine-field-source-checkbox').nth(1).check();
    await popupPage.locator('#input-combine-field-separator').fill(' — ');
    await popupPage.locator('#toggle-combine-field-remove-originals').check();
    await popupPage.locator('#btn-combine-field-confirm').click();

    await popupPage.locator('#modal-combine-field').waitFor({ state: 'hidden', timeout: 5000 });
    const fieldRows = await popupPage.locator('#fields-list .field-row').count();
    assert(fieldRows === 3, `Expected 3 field rows after combining, got ${fieldRows}`);
    const hiddenBadges = await popupPage.locator('#fields-list .field-hidden-badge').count();
    assert(hiddenBadges === 2, `Expected 2 hidden badges (the two source fields), got ${hiddenBadges}`);
    console.log('  OK — 3 fields listed, 2 marked hidden, sources not deleted');

    // ── Step 5: generate and inspect the actual trial-run output ────────
    console.log('Step 5: enabling trial-run data preview and generating...');
    await popupPage.locator('#settings-section-toggle').click(); // Settings section starts collapsed
    await popupPage.locator('#toggle-include-data-preview').check();
    const generateDisabled = await popupPage.locator('#btn-generate').isDisabled();
    console.log('  #btn-generate disabled?', generateDisabled);
    await popupPage.locator('#btn-generate').click();
    try {
      await popupPage.locator('#screen-done, #error-toast:not(.hidden)').first().waitFor({ state: 'visible', timeout: 30000 });
    } catch (err) {
      await popupPage.screenshot({ path: path.join(__dirname, 'combine-split-fields-check-FAIL.png') });
      throw err;
    }
    const errorToastVisible = await popupPage.locator('#error-toast').isVisible().catch(() => false);
    if (errorToastVisible) {
      const errorToastText = await popupPage.locator('#error-toast-message').textContent();
      await popupPage.screenshot({ path: path.join(__dirname, 'combine-split-fields-check-FAIL.png') });
      throw new Error(`Generate failed: ${errorToastText}`);
    }

    const headerCells = await popupPage.locator('.data-preview-table thead th').allTextContents();
    console.log('  Output columns:', headerCells);
    assert(headerCells.includes('TitelUndPreis'), 'Expected the combined column in the output');
    assert(!headerCells.includes('Titel') && !headerCells.includes('Preis'), 'Expected the two hidden source fields to NOT appear as output columns');

    const firstDataRow = await popupPage.locator('.data-preview-table tbody tr').first().locator('td').allTextContents();
    console.log('  First row value:', firstDataRow);
    assert(firstDataRow.some((v) => v.includes(' — ')), `Expected the combined value to contain the " — " separator, got ${JSON.stringify(firstDataRow)}`);
    console.log('  OK — generated script output confirms combine actually worked end to end');

    const screenshotPath = path.join(__dirname, 'combine-split-fields-check.png');
    await popupPage.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);

    // ── Step 6: quick "New" reset + split sanity check ───────────────────
    console.log('Step 6: quick split sanity check...');
    await popupPage.locator('#btn-new-scraper').click();
    await waitForIdleScreen(popupPage);
    await pickField('.item-price', 'Preis');
    await popupPage.locator('#btn-add-split-field').click();
    await popupPage.locator('#modal-split-field').waitFor({ state: 'visible', timeout: 5000 });
    await popupPage.locator('#input-split-field-name').fill('Waehrung');
    await popupPage.locator('#select-split-field-source').selectOption('Preis');
    await popupPage.locator('#input-split-field-separator').fill(' ');
    await popupPage.locator('#input-split-field-index').fill('1');
    await popupPage.locator('#btn-split-field-confirm').click();
    await popupPage.locator('#modal-split-field').waitFor({ state: 'hidden', timeout: 5000 });

    const splitFieldRows = await popupPage.locator('#fields-list .field-row').count();
    assert(splitFieldRows === 2, `Expected 2 field rows after split, got ${splitFieldRows}`);

    await popupPage.locator('#btn-generate').click();
    await popupPage.locator('#screen-done').waitFor({ state: 'visible', timeout: 30000 });
    console.log('  OK — split field generated successfully');

    console.log('\nALL CHECKS PASSED.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
