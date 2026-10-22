// Issue #402: real-browser check of the custom-request-header picker against the
// request-headers fixture (which echoes the headers it received into the page).
//   - enabling the section shows the picker and no row; the picker lists the common
//     headers plus "Other", with a "?" explaining it;
//   - picking Accept-Language creates a complete row (name, example value, description);
//     picking "X-Api-Key" creates an environment-variable row (secrets default to
//     one), with no secret warning; a used header is no longer offered;
//   - a credential-looking custom header with a fixed value shows the plain-text warning,
//     and one click switches it to an environment variable;
//   - the REAL script run sends exactly the picked headers (de-CH + the test key);
//   - German wording and no horizontal overflow at 280/320/400 px.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-402-request-headers-picker-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('request-headers');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    for (const [name, selector] of [['Lang', '.lang'], ['Key', '.key']]) {
      await popup.click('#btn-add-field');
      await fixturePage.click(selector);
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', name);
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);
    }

    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-request-headers');
    const rows = popup.locator('#request-headers-list .request-header-row');
    const row = (i) => rows.nth(i);
    const picker = popup.locator('#select-add-request-header');

    // 1) Picker without a row; lists the common headers + Other.
    assert(await rows.count() === 0, 'enabling the section should not add an empty row');
    const labels = await picker.locator('option').allTextContents();
    assert(labels[0] === 'Add a header…', `unexpected placeholder: ${labels[0]}`);
    for (const wanted of ['Accept-Language', 'Referer', 'User-Agent', 'Cookie', 'Authorization', 'X-Api-Key', 'Other header']) {
      assert(labels.some((l) => l.startsWith(wanted)), `the picker should offer "${wanted}", got ${JSON.stringify(labels)}`);
    }
    console.log(`picker offers ${labels.length - 1} entries`);

    // 2) The picker's "?" explains it (and does not toggle the checkbox).
    const helpBtn = popup.locator('.request-header-picker .help-btn');
    await helpBtn.click();
    const panel = popup.locator(`#${await helpBtn.getAttribute('aria-controls')}`);
    assert(/Secrets \(Cookie, Authorization, API key\) start as an environment variable/.test(await panel.locator('.help-popover-text').textContent()), 'picker help text');
    assert(await popup.locator('#toggle-request-headers').isChecked(), 'the "?" must not toggle the checkbox');
    await popup.keyboard.press('Escape');

    // 3) Picking a plain header: a complete row with a description.
    await picker.selectOption({ label: labels.find((l) => l.startsWith('Accept-Language')) });
    assert(await rows.count() === 1, 'picking Accept-Language should add one row');
    assert(await row(0).locator('.request-header-name').inputValue() === 'Accept-Language', 'name');
    assert((await row(0).locator('.request-header-value').inputValue()) === 'en-US,en;q=0.9', 'example value prefilled');
    assert(await row(0).locator('.request-header-kind').inputValue() === 'value', 'plain header starts as a fixed value');
    assert(/in this language/.test(await row(0).locator('.request-header-desc').textContent()), 'description under the row');
    assert(await row(0).locator('.request-header-secret-warning').count() === 0, 'no secret warning for Accept-Language');
    await row(0).locator('.request-header-value').fill('de-CH');
    await row(0).locator('.request-header-value').blur();
    assert(await picker.locator('option[value="acceptLanguage"]').isDisabled(), 'a used header is no longer offered');

    // 4) Picking a secret: starts as an environment variable, no warning.
    await picker.selectOption('apiKey');
    assert(await row(1).locator('.request-header-name').inputValue() === 'X-Api-Key', 'X-Api-Key row');
    assert(await row(1).locator('.request-header-kind').inputValue() === 'env', 'a secret header starts as an environment variable');
    assert(await row(1).locator('.request-header-value').inputValue() === 'API_KEY', 'suggested variable name');
    assert(await row(1).locator('.request-header-secret-warning').count() === 0, 'no warning for an env-var row');
    await row(1).locator('.request-header-value').fill('SF_E2E_402_KEY');
    await row(1).locator('.request-header-value').blur();
    await row(1).locator('.request-header-test-value').fill('picker-key-402');

    // 5) A credential-looking custom header with a fixed value: warning, one-click fix.
    await picker.selectOption('other');
    assert(await rows.count() === 3, '"Other" adds an empty row');
    await row(2).locator('.request-header-name').fill('X-Auth-Token');
    await row(2).locator('.request-header-name').blur();
    await row(2).locator('.request-header-value').fill('plain-secret');
    await row(2).locator('.request-header-value').blur();
    const warning = row(2).locator('.request-header-secret-warning');
    assert(/plain text/.test(await warning.textContent()), 'the warning should say the value would be plain text');
    await popup.locator('#request-headers-list').screenshot({ path: path.join(__dirname, 'issue-402-request-headers-picker-warning.png') });
    await row(2).locator('.request-header-switch-env').click();
    assert(await row(2).locator('.request-header-kind').inputValue() === 'env', 'switch moves the row to an environment variable');
    assert(await row(2).locator('.request-header-value').inputValue() === 'X_AUTH_TOKEN', 'with a suggested variable name');
    assert(await row(2).locator('.request-header-secret-warning').count() === 0, 'the warning is gone after the switch');
    await row(2).locator('.btn-remove-request-header').click();
    assert(await rows.count() === 2, 'the extra row is removed');
    console.log('picker rows, descriptions, secret defaults and the warning behave');

    // 6) No horizontal overflow at typical side-panel widths.
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 900 });
      const { widest, blockRight } = await popup.evaluate(() => {
        const block = document.getElementById('request-headers-config');
        return {
          blockRight: block.getBoundingClientRect().right,
          widest: Math.max(...Array.from(block.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right)),
        };
      });
      assert(widest <= blockRight + 1, `request headers overflow at ${width}px (${widest} > ${blockRight})`);
    }
    await popup.setViewportSize({ width: 1280, height: 720 });

    // 7) The real run sends exactly the picked headers.
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
    const cells = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
    assert(cells.length === 1 && JSON.stringify(cells[0]) === JSON.stringify(['de-CH', 'picker-key-402']), `expected the picked headers to reach the server, got ${JSON.stringify(cells)}`);
    console.log('the script run carried Accept-Language and the env-var-backed X-Api-Key');
    await popup.click('#btn-back-to-config');
    await waitForIdleScreen(popup);

    // 8) German wording.
    await popup.evaluate(() => chrome.storage.local.set({ language: 'de' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    if (!(await popup.locator('#request-headers-config').isVisible())) await popup.click('#settings-section-toggle');
    const deLabels = await popup.locator('#select-add-request-header option').allTextContents();
    assert(deLabels[0] === 'Header hinzufügen…', `German placeholder: ${deLabels[0]}`);
    assert(deLabels.some((l) => l.startsWith('Authorization — Zugangstoken')), `German preset label: ${JSON.stringify(deLabels)}`);
    assert(/bevorzugte|Sprache/.test(await popup.locator('#request-headers-list .request-header-desc').first().textContent()), 'German description');
    console.log('OK — header picker end to end (English + German).');
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
