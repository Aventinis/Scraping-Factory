// Issue #222: real-browser check of "Pause between requests" — on the
// speisekarte fixture, picks a field, enables page-number pagination (3
// pages) and a fixed 2 s pause between requests, then generates. The test
// companion runs with a deliberately short 3 s trial-run timeout: 2 pauses
// × 2 s = 4 s of pure waiting would blow it, so reaching the DONE screen
// proves the verifier really extends its deadline by the announced pauses.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-222-request-delay-check.js
const path = require('path');

process.env.Companion__VerifierTimeoutSeconds = '3';

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
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Gericht');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    await popupPage.click('#settings-section-toggle');
    await popupPage.check('#toggle-request-delay');
    await popupPage.fill('#input-request-delay-min', '2');
    await popupPage.check('#toggle-pagination');
    await popupPage.click('#btn-pagination-page-number');
    await popupPage.fill('#input-pagination-url-template', '{url}?page={page}');
    await popupPage.fill('#input-pagination-max-pages', '3');
    // Regression check (reported: the settings row overflowed the side
    // panel's right edge) — at typical side-panel widths, nothing in the
    // request-delay block may reach past the block's own right edge. (The
    // page as a whole can scroll horizontally at 280px regardless of this
    // feature — that's the panel's own min-width: 280px plus its scrollbar.)
    for (const width of [280, 320, 400]) {
      await popupPage.setViewportSize({ width, height: 900 });
      const overflow = await popupPage.evaluate(() => {
        const block = document.getElementById('request-delay-config');
        const blockRight = block.getBoundingClientRect().right;
        const widest = Math.max(...Array.from(block.querySelectorAll('*')).map(el => el.getBoundingClientRect().right));
        return { widest, blockRight };
      });
      console.log(`width ${width}px: widest child right edge ${overflow.widest.toFixed(0)} / block ${overflow.blockRight.toFixed(0)}`);
      if (overflow.widest > overflow.blockRight + 1) throw new Error(`Request-delay settings overflow at ${width}px`);
      if (width === 320) await popupPage.locator('#request-delay-config').screenshot({ path: path.join(__dirname, 'issue-222-request-delay.png') });
    }
    await popupPage.setViewportSize({ width: 1280, height: 720 });

    await focusFixture(fixturePage);
    const started = Date.now();
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    const seconds = (Date.now() - started) / 1000;
    console.log(`Generate finished after ${seconds.toFixed(1)} s (trial-run timeout: 3 s).`);
    if (seconds < 4) throw new Error('Expected the trial run to take at least the 4 s of pauses');
    console.log('OK — the trial run paused between pages and still passed despite a 3 s timeout.');
  } catch (err) {
    const pages = browser.context.pages();
    const toast = await pages[pages.length - 1].locator('#error-toast-message').textContent().catch(() => null);
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
