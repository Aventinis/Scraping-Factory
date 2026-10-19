// Issue #226: real-browser check of "Send custom request headers" against the
// request-headers fixture, which echoes the headers it received into the page.
// Picks the echoed Accept-Language and X-Api-Key values, then generates twice
// with the trial-run data preview on:
//   1) with two configured headers — a fixed Accept-Language and an X-Api-Key
//      backed by an environment variable (its one-time test value typed into
//      the popup): the companion's real script run must scrape exactly those
//      values, proving both the header and the test-value plumbing;
//   2) with the section switched off again: the script sends neither ("-").
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port — possibly an older build without this feature —
// is never used or touched.
//
// Usage: node e2e/examples/issue-226-request-headers-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('request-headers');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    for (const [name, selector] of [['Lang', '.lang'], ['Key', '.key']]) {
      await popupPage.click('#btn-add-field');
      await fixturePage.click(selector);
      await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
      await popupPage.fill('#input-field-name', name);
      await popupPage.click('#btn-field-confirm');
      await waitForIdleScreen(popupPage);
    }

    const previewRow = async () => {
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
      const rows = await popupPage.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map(tr => Array.from(tr.cells).map(c => c.textContent)));
      if (rows.length !== 1) throw new Error(`Expected exactly one preview row, got ${JSON.stringify(rows)}`);
      return rows[0];
    };

    // Configure the headers.
    await popupPage.click('#settings-section-toggle');
    await popupPage.check('#toggle-request-headers');
    const rowCount = async () => (await popupPage.$$('#request-headers-list .request-header-row')).length;
    if ((await rowCount()) !== 1) throw new Error('Enabling the section should offer one empty row');

    const row = (i) => popupPage.locator('#request-headers-list .request-header-row').nth(i);
    await row(0).locator('.request-header-name').fill('Accept-Language');
    await row(0).locator('.request-header-value').fill('de-CH');
    await row(0).locator('.request-header-value').blur();
    await popupPage.click('#btn-add-request-header');
    await row(1).locator('.request-header-name').fill('X-Api-Key');
    await row(1).locator('.request-header-name').blur();
    await row(1).locator('.request-header-kind').selectOption('env');
    await row(1).locator('.request-header-value').fill('SF_E2E_API_KEY');
    await row(1).locator('.request-header-value').blur();
    await row(1).locator('.request-header-test-value').fill('trial-key-226');
    // The rows must fit typical side-panel widths (the request-delay row once didn't).
    for (const width of [280, 320, 400]) {
      await popupPage.setViewportSize({ width, height: 900 });
      const { widest, blockRight } = await popupPage.evaluate(() => {
        const block = document.getElementById('request-headers-config');
        return {
          blockRight: block.getBoundingClientRect().right,
          widest: Math.max(...Array.from(block.querySelectorAll('*')).map(el => el.getBoundingClientRect().right)),
        };
      });
      console.log(`width ${width}px: widest child right edge ${widest.toFixed(0)} / block ${blockRight.toFixed(0)}`);
      if (widest > blockRight + 1) throw new Error(`Request headers overflow at ${width}px`);
      if (width === 320) await popupPage.locator('#request-headers-config').screenshot({ path: path.join(__dirname, 'issue-226-request-headers.png') });
    }
    await popupPage.setViewportSize({ width: 1280, height: 720 });

    // 1) With headers: the script's own request carried them.
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    const withHeaders = await previewRow();
    if (JSON.stringify(withHeaders) !== JSON.stringify(['de-CH', 'trial-key-226'])) {
      throw new Error(`Expected the configured headers to reach the server, got ${JSON.stringify(withHeaders)}`);
    }
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-226-request-headers-done.png'), fullPage: true });
    await popupPage.click('#btn-back-to-config');
    await waitForIdleScreen(popupPage);

    // 2) Section off: neither header is sent any more.
    await popupPage.uncheck('#toggle-request-headers');
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    const withoutHeaders = await previewRow();
    if (JSON.stringify(withoutHeaders) !== JSON.stringify(['-', '-'])) {
      throw new Error(`Expected no custom headers when the section is off, got ${JSON.stringify(withoutHeaders)}`);
    }
    console.log('OK — configured Accept-Language and an env-var-backed X-Api-Key (test value) reached the server; with the section off neither is sent.');
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
