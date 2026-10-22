// Issue #398: real-browser check of the guidance for the first decisions of a
// scrape (mode, container type, field type, engine).
//
//   - "?" popovers with the "which fits?" texts: the mode toggle and the engine
//     row on the idle screen, the container type in the "new container" modal,
//     the field type in the container field modal and the flat field modal —
//     each opens with the expected lines, one at a time; the hover-only engine
//     tooltip is gone;
//   - the texts follow the language (de/es);
//   - the container type is chosen BEFORE the element is clicked, so the count
//     can't sit next to the choice; instead the toast after the click checks it:
//     "single" + many matches warns, and the "(single)" suffix in the tree is a
//     toggle that switches it to repeating; "repeating" + one match hints;
//   - a trial run on the Static engine that finds nothing (content built by
//     JavaScript — infinite-scroll fixture) ends with the suggestion to try the
//     Browser engine.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-398-choice-guidance-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const menu = await startFixture('speisekarte');
  const feed = await startFixture('infinite-scroll');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(menu.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    const isOpen = async (btn) => (await btn.getAttribute('aria-expanded')) === 'true'
      && await popup.locator(`#${await btn.getAttribute('aria-controls')}`).isVisible();
    const linesOf = async (btn) => (await popup.locator(`#${await btn.getAttribute('aria-controls')} .help-popover-text`).textContent()).split('\n');
    const toastText = () => popup.locator('#error-toast-message').textContent();
    const toastClass = async () => (await popup.locator('#error-toast').getAttribute('class')) || '';

    // 1) Idle screen: mode and engine popovers, tooltip gone.
    const modeBtn = popup.locator('.row-label:has(.help-host[data-help="help.mode.choice"]) .help-btn');
    const engineBtn = popup.locator('#engine-section .help-btn').first();
    await modeBtn.click();
    assert(await isOpen(modeBtn), 'the mode popover should open');
    let lines = await linesOf(modeBtn);
    assert(lines.length === 4 && /^Fields — /.test(lines[0]) && /^Containers — /.test(lines[1]) && /^API — /.test(lines[2]) && /hidden request/.test(lines[2]) && /^Combined, Blocks — /.test(lines[3]), `unexpected mode help: ${JSON.stringify(lines)}`);
    await engineBtn.click();
    assert(await isOpen(engineBtn) && !(await isOpen(modeBtn)), 'one popover at a time (engine replaces mode)');
    lines = await linesOf(engineBtn);
    assert(lines.length === 3 && /^Static — fast/.test(lines[0]) && /^Browser — a real browser/.test(lines[1]) && /Browser is usually the fix/.test(lines[2]), `unexpected engine help: ${JSON.stringify(lines)}`);
    assert((await popup.locator('#btn-engine-browser').getAttribute('title')) === null, 'the hover-only engine tooltip should be gone');
    await popup.keyboard.press('Escape');
    console.log('idle screen: mode + engine popovers, no tooltip');

    // 2) Container type: popover in the modal; "single" + many matches warns, the suffix toggles.
    await popup.click('#btn-mode-container');
    await popup.click('#btn-add-root-container');
    await popup.waitForSelector('#modal-container-new:not(.hidden)');
    const typeBtn = popup.locator('#modal-container-new .help-btn');
    await typeBtn.click();
    lines = await linesOf(typeBtn);
    assert(lines.length === 2 && /^Single element — /.test(lines[0]) && /^Repeating — /.test(lines[1]), `unexpected container type help: ${JSON.stringify(lines)}`);
    const example = await popup.locator(`#${await typeBtn.getAttribute('aria-controls')} .help-popover-example`).textContent();
    assert(example === 'Menu with 12 dishes → Repeating', `unexpected example: ${example}`);
    await popup.screenshot({ path: path.join(__dirname, 'issue-398-container-type.png') });
    await popup.keyboard.press('Escape');

    await popup.fill('#input-container-name', 'Dish');
    // "Single element" stays selected (the default) — then pick the <li> itself (its padding, not a child).
    await popup.click('#btn-container-confirm');
    await popup.waitForSelector('#screen-selecting:not(.hidden)');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.menu-item >> nth=0', { position: { x: 2, y: 2 } });
    await waitForIdleScreen(popup);
    const warned = await toastText();
    assert(/elements found, but it is set to "single"/.test(warned) && /only the first is used/.test(warned), `expected the single/many warning, got: ${warned}`);
    assert(/toast-warn/.test(await toastClass()), 'the single/many toast should be a warning');
    const suffix = popup.locator('#group-tree-root .group-tree-type').first();
    assert((await suffix.textContent()) === '(single)', 'the tree row should show "(single)"');
    await suffix.click();
    assert((await popup.locator('#group-tree-root .group-tree-type').first().textContent()) === '(repeating)', 'clicking the suffix should switch to repeating');
    assert(await popup.locator('#group-tree-root .group-tree-name').first().inputValue() === 'Dish', 'the container should keep its name');
    await popup.screenshot({ path: path.join(__dirname, 'issue-398-single-many-toggle.png') });
    console.log('container type: popover, single+many warns, suffix toggles to repeating');

    // 3) "Repeating" + one match hints.
    await popup.click('#btn-add-root-container');
    await popup.fill('#input-container-name', 'Header');
    await popup.check('#radio-container-repeating');
    await popup.click('#btn-container-confirm');
    await popup.waitForSelector('#screen-selecting:not(.hidden)');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('h1.restaurant-name');
    await waitForIdleScreen(popup);
    const hint = await toastText();
    assert(/only 1 element found/.test(hint) && /"\(repeating\)"/.test(hint), `expected the repeating/one hint, got: ${hint}`);
    console.log('container type: repeating + one match hints');

    // 4) Field type: container modal (four lines) and flat modal (two lines).
    await popup.locator('.btn-add-subfield').first().click();
    await popup.waitForSelector('#screen-selecting:not(.hidden)');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popup.waitForSelector('#modal-field-extended:not(.hidden)');
    const containerTypeBtn = popup.locator('#modal-field-extended .help-btn').first();
    await containerTypeBtn.click();
    lines = await linesOf(containerTypeBtn);
    assert(lines.length === 4 && /^Text — /.test(lines[0]) && /^Attribute — /.test(lines[1]) && /link's address/.test(lines[1]) && /^Exists\? — /.test(lines[2]) && /^Own text only — /.test(lines[3]), `unexpected field type help: ${JSON.stringify(lines)}`);
    await popup.keyboard.press('Escape');
    await popup.click('#btn-field-extended-cancel');
    await waitForIdleScreen(popup);

    await popup.click('#btn-mode-flat');
    await popup.click('#btn-add-field');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    const flatTypeBtn = popup.locator('#field-name-mode-section .help-btn');
    await flatTypeBtn.click();
    lines = await linesOf(flatTypeBtn);
    assert(lines.length === 2 && /^Text — /.test(lines[0]) && /^Attribute — /.test(lines[1]), `unexpected flat field type help: ${JSON.stringify(lines)}`);
    await popup.keyboard.press('Escape');
    await popup.click('#btn-field-cancel');
    await waitForIdleScreen(popup);
    console.log('field type: container modal (4 lines) and flat modal (2 lines)');

    // 5) German and Spanish.
    for (const [language, modeFirst, engineFirst] of [['de', /^Felder — /, /^Statisch — schnell/], ['es', /^Campos — /, /^Estático — rápido/]]) {
      await popup.evaluate((l) => chrome.storage.local.set({ language: l }), language);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
      const m = popup.locator('.row-label:has(.help-host[data-help="help.mode.choice"]) .help-btn');
      await m.click();
      const modeLines = await linesOf(m);
      assert(modeLines.length === 4 && modeFirst.test(modeLines[0]), `${language}: unexpected mode help ${JSON.stringify(modeLines)}`);
      const e = popup.locator('#engine-section .help-btn').first();
      await e.click();
      assert(engineFirst.test((await linesOf(e))[0]), `${language}: unexpected engine help`);
      await popup.keyboard.press('Escape');
    }
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en' }));
    console.log('german and spanish: mode + engine texts');

    // 6) Static engine, content built by JavaScript → no data → suggestion.
    await fixturePage.goto(feed.url);
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await popup.click('#btn-add-field');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('.post-title >> nth=0');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Titel');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#error-toast:not(.hidden)', { timeout: 90000 });
    const failure = await toastText();
    assert(/returned no data/.test(failure), `expected the trial run to find no data on Static, got: ${failure}`);
    assert(/try the Browser engine/.test(failure), `the error should suggest the Browser engine, got: ${failure}`);
    await popup.screenshot({ path: path.join(__dirname, 'issue-398-static-no-data.png') });
    console.log('static + JavaScript-built page: "no data" error suggests the Browser engine');

    console.log('OK — popovers for mode/engine/container type/field type, count check + type toggle, de/es, Browser suggestion.');
  } catch (err) {
    const pages = browser.context.pages();
    const toast = await pages[pages.length - 1].locator('#error-toast-message').textContent().catch(() => null);
    if (toast) console.error('Toast:', toast);
    throw err;
  } finally {
    await browser.close();
    await menu.stop();
    await feed.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
