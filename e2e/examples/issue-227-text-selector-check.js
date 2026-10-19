// Issue #227: real-browser check of the "text contains" input in the flat field
// modal, against the text-selector fixture: two products, each with three
// identically built `a.btn` links that only their label tells apart.
// Picks the product name, then the "Merken" link of the second product as an
// Attribute (href) field with "Merken" as the required text. Checks the live
// "N elements found" hint (6 for the plain selector, 2 once the text is set,
// 0 for a text nothing matches), and that the companion's real script run
// then scrapes exactly the two "Merken" links — in both engines.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port — possibly an older build without this feature —
// is never used or touched.
//
// Usage: node e2e/examples/issue-227-text-selector-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('text-selector');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    // Field 1: the product name (plain text, no filter).
    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.product >> nth=0 >> .name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Name');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    // Field 2: the "Merken" link's href, identified by its text.
    await popupPage.click('#btn-add-field');
    // The second product's link: its label is plain text, so the click lands on the link itself (the
    // first one's label is split over a child element, where a click may hit that inner span).
    await fixturePage.click('li.product >> nth=1 >> a:has-text("Merken")');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Wunschliste');
    await popupPage.selectOption('#select-field-name-mode', 'attribute');
    await popupPage.selectOption('#select-field-name-attribute', 'href');

    const count = async () => parseInt(await popupPage.locator('#field-name-match-count').textContent(), 10);
    const plainCount = await count();
    if (plainCount !== 6) throw new Error(`The plain selector should match all six links, the hint says ${plainCount}`);

    // "Use this element's text" takes over what the clicked link says.
    await popupPage.click('#btn-field-name-use-text');
    const typed = await popupPage.inputValue('#input-field-name-text-filter');
    if (typed !== 'Merken') throw new Error(`Expected the element's text "Merken", got "${typed}"`);
    await popupPage.waitForFunction(() => parseInt(document.getElementById('field-name-match-count').textContent, 10) === 2);

    // A text nothing matches turns the hint into the zero warning ...
    await popupPage.fill('#input-field-name-text-filter', 'Gibt es nicht');
    await popupPage.waitForFunction(() => parseInt(document.getElementById('field-name-match-count').textContent, 10) === 0);
    if (!(await popupPage.locator('#field-name-match-count.warn').count())) throw new Error('Zero matches should be shown as a warning');

    // ... and a typo in capitals/spacing still finds it (tolerant matching).
    await popupPage.fill('#input-field-name-text-filter', '  MERKEN ');
    await popupPage.waitForFunction(() => parseInt(document.getElementById('field-name-match-count').textContent, 10) === 2);
    await popupPage.locator('#modal-field-name .modal-inner').screenshot({ path: path.join(__dirname, 'issue-227-text-selector.png') });
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    const rows = async () => {
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      return popupPage.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map(tr => Array.from(tr.cells).map(c => c.textContent)));
    };
    const expected = [['Kaffee', '/wish/kaffee'], ['Tee', '/wish/tee']];

    // Static engine.
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    const staticRows = await rows();
    if (JSON.stringify(staticRows) !== JSON.stringify(expected)) throw new Error(`Static engine: expected ${JSON.stringify(expected)}, got ${JSON.stringify(staticRows)}`);
    await popupPage.screenshot({ path: path.join(__dirname, 'issue-227-text-selector-done.png'), fullPage: true });
    await popupPage.click('#btn-back-to-config');
    await waitForIdleScreen(popupPage);

    // Browser engine — same configuration, Playwright instead of requests.
    await popupPage.click('#btn-engine-browser');
    await focusFixture(fixturePage);
    await popupPage.click('#btn-generate');
    const browserRows = await rows();
    if (JSON.stringify(browserRows) !== JSON.stringify(expected)) throw new Error(`Browser engine: expected ${JSON.stringify(expected)}, got ${JSON.stringify(browserRows)}`);
    console.log('OK — the text filter picked the two "Merken" links (live count 6 → 2 → 0 → 2), scraped identically by the static and the Browser engine.');
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
