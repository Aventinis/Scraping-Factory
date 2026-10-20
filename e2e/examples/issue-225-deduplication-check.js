// Issue #225: real-browser check of "Remove duplicates by key field(s)" on the
// dedup-listing fixture (five job entries, three distinct ones). Picks the
// Titel and Ort fields, generates once WITHOUT deduplication and checks the
// trial run's data preview shows all five rows, then adds Titel as the key
// field and checks the same configuration now yields exactly the three
// distinct rows, in their first-seen order. Also checks the incremental
// options in the Settings section (the Append choice is available for flat
// output, retention switches between "number" and "days" with its own default).
//
// The cross-run (incremental) behavior itself needs two runs of the same
// script, which /generate's always-fresh trial run can't provide — it is
// covered by DeduplicationEndToEndTests.cs and by the manual steps in the PR.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port — possibly an older build without this
// feature — is never used or touched.
//
// Usage: node e2e/examples/issue-225-deduplication-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('dedup-listing');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    for (const [name, selector] of [['Titel', '.title'], ['Ort', '.city']]) {
      await popupPage.click('#btn-add-field');
      await fixturePage.click(`li.job >> nth=0 >> ${selector}`);
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', name);
      await popupPage.click('#btn-field-confirm');
      await waitForIdleScreen(popupPage);
    }

    const previewRows = async () => {
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
      return popupPage.$$eval('#data-preview-table-wrap tbody tr', (rows) => rows.map(r => Array.from(r.cells).map(c => c.textContent)));
    };

    // 1) Without deduplication: all five rows.
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    const before = await previewRows();
    if (before.length !== 5) throw new Error(`Expected 5 rows without deduplication, got ${before.length}: ${JSON.stringify(before)}`);
    await popupPage.click('#btn-back-to-config');
    await waitForIdleScreen(popupPage);

    // 2) With "Titel" as the key field: three distinct rows.
    await popupPage.click('#settings-section-toggle');
    await popupPage.check('#toggle-dedup');
    await popupPage.selectOption('#select-dedup-key-field', 'Titel');
    await popupPage.click('#btn-add-dedup-key-field');
    if ((await popupPage.$$('#dedup-key-fields-list .btn-remove-dedup-key-field')).length !== 1) throw new Error('The chosen key field should be listed');
    const offered = await popupPage.$$eval('#select-dedup-key-field option', (opts) => opts.map(o => o.value));
    if (offered.join(',') !== 'Ort') throw new Error(`Only the unchosen field should still be offered, got ${offered}`);

    // Incremental options: Append is available for flat output; retention switches its default.
    await popupPage.check('#toggle-dedup-incremental');
    if (await popupPage.isDisabled('#btn-dedup-output-append')) throw new Error('Append should be available for flat output');
    const countDefault = await popupPage.inputValue('#input-dedup-retention-value');
    await popupPage.selectOption('#select-dedup-retention-kind', 'MaxAge');
    const ageDefault = await popupPage.inputValue('#input-dedup-retention-value');
    if (countDefault !== '100000' || ageDefault !== '90') throw new Error(`Unexpected retention defaults: ${countDefault} / ${ageDefault}`);
    await popupPage.locator('#dedup-section').screenshot({ path: path.join(__dirname, 'issue-225-deduplication.png') });
    // The trial run always starts without a remembered state, so incremental mode doesn't change its result.
    await popupPage.uncheck('#toggle-dedup-incremental');

    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    const after = await previewRows();
    const expected = [['Entwickler', 'Berlin'], ['Tester', 'Hamburg'], ['Admin', 'Köln']];
    if (JSON.stringify(after) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)} after deduplication, got ${JSON.stringify(after)}`);
    }
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-225-deduplication-done.png'), fullPage: true });
    console.log('OK — 5 rows without deduplication, 3 distinct rows (first-seen order) with Titel as the key field.');
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
