// Issue #517: real-browser check that the ? popover of the Range value source explains `today` (where it works, that it is resolved when
// the script runs, that today … today is one value), in English and German, and that its "Learn more" link leads to the documented section.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-517-range-today-help-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('api-nested-and-post');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // Record the GET catalog request, pick a value, and open the API screen.
    await popup.click('#btn-mode-api');
    await popup.click('#btn-api-capture');
    await fixturePage.click('#btn-reload-catalog');
    await fixturePage.waitForSelector('#result-catalog .product-title');
    await popup.click('#btn-api-capture');
    await focusFixture(fixturePage);
    await popup.click('#btn-api-search');
    await fixturePage.click('#result-catalog .product-title >> nth=0');
    await popup.waitForSelector('#api-candidates-list .api-candidate-confirm', { state: 'visible' });
    await popup.locator('#api-candidates-list .api-candidate-confirm').first().click();
    await popup.waitForSelector('#screen-api-config:not(.hidden)');

    // Make the first URL part variable and choose the Range source.
    await popup.locator('.api-config-part-toggle').first().check();
    await popup.locator('.api-config-source-kind-radio[value="range"]').first().check();
    await popup.waitForSelector('.api-config-range-row');

    const readPopover = async () => {
      const radio = popup.locator('.api-config-source-kind-radio[value="range"]').first();
      const button = radio.locator('xpath=ancestor::label[1]').locator('.help-btn');
      await button.click();
      const panel = popup.locator(`#${await button.getAttribute('aria-controls')}`);
      const text = await panel.locator('.help-popover-text').textContent();
      const link = panel.locator('a.learn-more');
      const href = await link.count() ? await link.first().getAttribute('data-doc') : null;
      const linkText = await link.count() ? await link.first().textContent() : '';
      await popup.keyboard.press('Escape');
      return { text, href, linkText };
    };

    const en = await readPopover();
    assert(/today/.test(en.text) && /ISO weeks/.test(en.text) && /dates only as the end/.test(en.text), `the English popover should explain where today works: ${en.text}`);
    assert(/when the script runs/.test(en.text) && /today … today/.test(en.text), `it should say when it is resolved and that today … today is one value: ${en.text}`);
    assert(en.href === 'range' && en.linkText.length > 0, `a "Learn more" link to the range section is expected, got ${JSON.stringify(en)}`);

    await popup.selectOption('#lang-select', 'de');
    await popup.waitForSelector('.api-config-source-kind-radio[value="range"]');
    const de = await readPopover();
    assert(de && /today/.test(de.text) && /Daten nur als Ende/.test(de.text), `the German popover should explain where today works: ${de && de.text}`);

    console.log('OK — the Range help explains today (where it works, run-time resolution, today … today) with a Learn more link, English and German.');
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
