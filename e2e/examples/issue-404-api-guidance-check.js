// Issue #404: real-browser check of API mode's guidance on the api-nested-and-post
// fixture (nested JSON response, POST body):
//   - the "add group" modal gets its JSON path from the recorded response: the
//     tree is rooted at the parent group's first instance, so the paths it offers
//     are relative to it (this used to be free text only);
//   - the URL parts and every value source have a "?" with an explanation and an
//     example; browser discovery sits under a collapsed "Advanced" group;
//   - a request-body value turned into a variable gets its value type under a
//     collapsed "Advanced" with its own "?".
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-404-api-guidance-check.js
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

    await popup.click('#btn-mode-api');
    await popup.click('#btn-api-capture');
    await fixturePage.click('#btn-reload-search');
    await fixturePage.waitForSelector('#result-search .product-title');
    await popup.click('#btn-api-capture');
    await focusFixture(fixturePage);
    await popup.click('#btn-api-search');
    await fixturePage.click('#result-search .product-title >> nth=0');
    await popup.waitForSelector('.api-candidate-field-name', { state: 'visible' });
    await popup.fill('.api-candidate-field-name', 'Titel');
    await popup.click('.api-candidate-confirm');
    await popup.waitForSelector('#screen-api-config:not(.hidden)');

    const helpText = async (hostSelector) => {
      const btn = popup.locator(`${hostSelector} .help-btn`).first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const panel = popup.locator(`#${await btn.getAttribute('aria-controls')}`);
      const text = await panel.locator('.help-popover-text').textContent();
      const example = await panel.locator('.help-popover-example').textContent().catch(() => '');
      await popup.keyboard.press('Escape');
      return { text, example };
    };

    // 1) The group modal picks its path from the recorded response.
    await popup.locator('#api-tree-root .btn-add-api-subgroup').first().click();
    await popup.waitForSelector('#modal-api-group-new:not(.hidden)');
    await popup.fill('#input-api-group-name', 'Unterkategorie');
    await popup.click('#modal-api-group-new .json-path-open');
    await popup.waitForSelector('#api-group-path-picker .json-path-panel');
    assert(await popup.inputValue('#input-api-group-name') === 'Unterkategorie', 'opening the picker must not wipe the typed name');
    assert(/Recorded: POST .*\/api\/search/.test(await popup.locator('#api-group-path-picker .json-path-source').textContent()), 'tree comes from the recorded POST search');
    const offered = await popup.$$eval('#api-group-path-picker .json-path-pick', (buttons) => buttons.map((b) => b.dataset.path));
    assert(offered.includes('subcategories'), `relative to the parent group, "subcategories" should be offered: ${JSON.stringify(offered)}`);
    assert(offered.every((p) => !p.startsWith('categories') && !p.includes('[')), `paths must be relative and array-free: ${JSON.stringify(offered)}`);
    await popup.locator('#modal-api-group-new').screenshot({ path: path.join(__dirname, 'issue-404-api-group-picker.png') });
    await popup.click('#api-group-path-picker .json-path-pick[data-path="subcategories"]');
    assert(await popup.inputValue('#input-api-group-path') === 'subcategories', 'the path is filled in');
    assert(await popup.inputValue('#input-api-group-name') === 'Unterkategorie', 'the name is still there');
    await popup.click('#btn-api-group-cancel'); // an empty group would not be valid; the pick is what matters
    console.log('group path picked relative to the parent scope');

    // 2) Popovers: URL parts.
    const urlParts = await helpText('#screen-api-config [data-help="help.apiConfig.urlParts"]');
    assert(/"variable" for a part that takes different values/.test(urlParts.text), `URL parts popover: ${urlParts.text}`);

    // 3) Body: turn the literal into a variable, then look at the source cards.
    await popup.locator('#body-tree-root .btn-body-to-variable').first().click();
    await popup.selectOption('#body-tree-root .body-tree-parameter-picker', '__new__');
    await popup.waitForSelector('#modal-api-body-parameter-new:not(.hidden)');
    await popup.fill('#input-api-body-parameter-name', 'category');
    await popup.click('#btn-api-body-parameter-confirm');
    await popup.waitForSelector('#modal-api-body-parameter-new', { state: 'hidden' });

    const bodyHelp = await helpText('[data-help="help.apiConfig.bodyVariable"]');
    assert(/→ Variable/.test(bodyHelp.text) && bodyHelp.example.includes('category'), `body popover: ${JSON.stringify(bodyHelp)}`);

    const card = popup.locator('.api-config-param-card').first();
    // Issue #518: every source is a plain option; the browser-discovery radio is visible without opening anything.
    const sources = await card.locator('.api-config-source-kind > label .api-config-source-kind-radio').evaluateAll((radios) => radios.map((r) => r.value));
    assert(JSON.stringify(sources) === JSON.stringify(['staticList', 'discovery', 'range', 'browserDiscovery']), `all sources up front: ${JSON.stringify(sources)}`);
    assert(await card.locator('.api-config-source-kind details').count() === 0, 'no Advanced sources disclosure');
    assert(await card.locator('.api-config-source-kind-radio[value="browserDiscovery"]').isVisible(), 'browser discovery is visible without opening anything');
    for (const width of [280, 320]) {
      await popup.setViewportSize({ width, height: 900 });
      const overflow = await card.evaluate((el) => {
        const right = el.getBoundingClientRect().right;
        return [...el.querySelectorAll('.api-config-source-kind > label')].filter((l) => l.getBoundingClientRect().right > right + 1).length;
      });
      assert(overflow === 0, `the source options must wrap inside the card at ${width}px (${overflow} stick out)`);
    }
    await popup.setViewportSize({ width: 1280, height: 720 });
    assert(/List from another request/.test(await card.locator('.api-config-source-kind').textContent()), 'plainer label for the discovery source');
    const staticHelp = await helpText('.api-config-source-kind label:has(input[value="staticList"])');
    assert(staticHelp.example === 'electronics, books', `value-list popover example: ${staticHelp.example}`);

    // 4) Value type: Advanced + "?".
    const valueType = popup.locator('#body-tree-root details[data-advanced="api-body-value-type"]').first();
    assert(!(await valueType.evaluate((el) => el.open)), 'value type starts collapsed');
    await valueType.locator('> summary').click();
    const typeHelp = await helpText('#body-tree-root details[data-advanced="api-body-value-type"] .advanced-disclosure-body');
    assert(/Number or Boolean/.test(typeHelp.text), `value type popover: ${typeHelp.text}`);
    await popup.locator('#screen-api-config').screenshot({ path: path.join(__dirname, 'issue-404-api-guidance.png') }).catch(() => {});

    console.log('OK — group path picker, popovers and Advanced groups on the API_CONFIG screen.');
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
