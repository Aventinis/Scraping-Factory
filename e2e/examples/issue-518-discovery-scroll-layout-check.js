// Issue #518 follow-up: real-browser check that the number inputs of a browser-discovery Scroll action ("Max. rounds", "Pause after each
// round (seconds)", "Scroll step") are wide enough to type in and stay inside the card at narrow side-panel widths, in English and German.
// The long German labels used to squeeze the inputs to a few pixels.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-518-discovery-scroll-layout-check.js
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

    await popup.locator('.api-config-part-toggle').first().check();
    await popup.locator('.api-config-source-kind-radio[value="browserDiscovery"]').first().check();
    await popup.locator('.btn-add-discovery-action[data-kind="scroll"]').first().click();
    await popup.waitForSelector('.discovery-action-max-iterations');

    const problems = [];
    for (const language of ['en', 'de']) {
      await popup.selectOption('#lang-select', language);
      for (const width of [280, 320, 400]) {
        await popup.setViewportSize({ width, height: 900 });
        const measured = await popup.evaluate(() => {
          const card = document.querySelector('.discovery-action-max-iterations').closest('.browser-action-card, .api-discovery-action, div[class*="card"]')
            || document.querySelector('.discovery-action-max-iterations').parentElement.parentElement;
          const right = card.getBoundingClientRect().right;
          return ['.discovery-action-max-iterations', '.discovery-action-wait-after-ms', '.discovery-action-scroll-step-px'].map((selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return { selector, width: Math.round(rect.width), overflow: Math.round(rect.right - right) };
          });
        });
        for (const m of measured) {
          if (m.width < 50) problems.push(`${language} ${width}px: ${m.selector} is only ${m.width}px wide`);
          if (m.overflow > 1) problems.push(`${language} ${width}px: ${m.selector} sticks out of the card by ${m.overflow}px`);
        }
      }
    }
    await popup.setViewportSize({ width: 372, height: 900 });
    await popup.selectOption('#lang-select', 'de');
    await popup.locator('.discovery-action-max-iterations').first().scrollIntoViewIfNeeded();
    await popup.locator('.api-config-source-fields').first().screenshot({ path: path.join(__dirname, 'issue-518-discovery-scroll.png') });
    assert(problems.length === 0, `layout problems:\n  ${[...new Set(problems)].slice(0, 12).join('\n  ')}`);

    console.log('OK — the discovery Scroll action keeps usable number inputs inside its card at 280-400 px, English and German.');
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
