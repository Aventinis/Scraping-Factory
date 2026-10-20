// Issue #223: real-browser check of "Retry on transient errors" against the
// flaky-server fixture, which answers every other request of a generated
// script with 503. Without retries, Generate must fail (the trial run's
// first request gets the 503); with retries enabled, the same configuration
// must pass. Also checks the settings block fits typical side-panel widths
// (the request-delay row once didn't).
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-223-retry-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('flaky-server');
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
    await fixturePage.click('li.offer >> nth=0 >> .name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Name');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    // 1) Without retries: the trial run's first request gets the 503.
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#error-toast:not(.hidden)', { timeout: 60000 });
    console.log('Without retries →', (await popupPage.locator('#error-toast-message').textContent()).slice(0, 120));
    await waitForIdleScreen(popupPage);

    // 2) With retries: the same configuration passes.
    await popupPage.evaluate(() => document.getElementById('error-toast').classList.add('hidden')); // step 1's toast would cover the screenshot
    await popupPage.click('#settings-section-toggle');
    await popupPage.check('#toggle-retry');
    for (const width of [280, 320, 400]) {
      await popupPage.setViewportSize({ width, height: 900 });
      const { widest, blockRight } = await popupPage.evaluate(() => {
        const block = document.getElementById('retry-config');
        return {
          blockRight: block.getBoundingClientRect().right,
          widest: Math.max(...Array.from(block.querySelectorAll('*')).map(el => el.getBoundingClientRect().right)),
        };
      });
      console.log(`width ${width}px: widest child right edge ${widest.toFixed(0)} / block ${blockRight.toFixed(0)}`);
      if (widest > blockRight + 1) throw new Error(`Retry settings overflow at ${width}px`);
      if (width === 320) await popupPage.locator('#retry-config').screenshot({ path: path.join(__dirname, 'issue-223-retry.png') });
    }
    await popupPage.setViewportSize({ width: 1280, height: 720 });

    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
    console.log('OK — fails without retries, passes with retries enabled.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
