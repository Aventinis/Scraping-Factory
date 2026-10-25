// Issue #516: real-browser check that a Range value source (type select, From, To, format row) stays inside its card and the panel
// at narrow side-panel widths. A parameter of the recorded catalog request is made variable and given the Range source; then
// every element of the source is measured against the card and the viewport — for the narrowest widths and for both Range types
// that have a format row (IsoWeek, Date) as well as Number (none), in English and German. The dropdowns of the source must also look like
// the inputs next to them (font size, border, corner radius).
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-516-range-source-layout-check.js
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

    // Every element of the source against its card and the viewport.
    const measure = () => popup.evaluate(() => {
      const card = document.querySelector('.api-config-range-row').closest('.api-config-parameter-card, .api-config-card, .browser-action-card, div[class*="card"]')
        || document.querySelector('.api-config-source-fields').parentElement;
      const cardRect = card.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const parts = [...document.querySelectorAll('.api-config-source-fields select, .api-config-source-fields input, .api-config-source-fields .api-config-range-format-example')]
        .map((el) => ({ cls: el.className || el.tagName, right: el.getBoundingClientRect().right }));
      return { cardRight: cardRect.right, viewport, scrollWidth: document.documentElement.scrollWidth, parts };
    });

    // The dropdowns look like the inputs next to them: same font size, border colour and corner radius, and a themed background.
    const look = (selector) => popup.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { fontSize: style.fontSize, radius: style.borderTopLeftRadius, border: style.borderTopColor, borderWidth: style.borderTopWidth };
    });
    const selectLook = await look('.api-config-range-type');
    const inputLook = await look('.api-config-range-from');
    assert(JSON.stringify(selectLook) === JSON.stringify(inputLook), `the range select should look like the inputs: ${JSON.stringify(selectLook)} vs ${JSON.stringify(inputLook)}`);
    assert(JSON.stringify(await look('.api-config-range-format-preset')) === JSON.stringify(inputLook), 'the format dropdown should look like the inputs too');

    const problems = [];
    for (const language of ['en', 'de']) {
      await popup.evaluate((lang) => chrome.storage.local.set({ language: lang }), language);
      for (const width of [280, 320, 360, 400]) {
        for (const type of ['IsoWeek', 'Date', 'Number']) {
          await popup.setViewportSize({ width, height: 900 });
          await popup.locator('.api-config-range-type').first().selectOption(type);
          const m = await measure();
          for (const part of m.parts) {
            if (part.right > m.cardRight + 1) problems.push(`${language} ${width}px ${type}: ${part.cls} sticks out of the card by ${Math.round(part.right - m.cardRight)}px`);
            if (part.right > m.viewport + 1) problems.push(`${language} ${width}px ${type}: ${part.cls} leaves the panel`);
          }
          if (m.scrollWidth > m.viewport + 1) problems.push(`${language} ${width}px ${type}: the panel scrolls horizontally (${m.scrollWidth} > ${m.viewport})`);
        }
      }
    }
    await popup.setViewportSize({ width: 320, height: 900 });
    await popup.locator('.api-config-range-type').first().selectOption('IsoWeek');
    await popup.locator('.api-config-source-fields').first().screenshot({ path: path.join(__dirname, 'issue-516-range-source.png') });
    assert(problems.length === 0, `layout problems:\n  ${[...new Set(problems)].slice(0, 12).join('\n  ')}`);

    console.log('OK — the Range source (type, From, To, format row) stays inside its card and the panel at 280–400 px, English and German.');
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
