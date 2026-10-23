// Issue #405: real-browser check of the pagination helpers on the paginated-listing
// fixture (two listings of three pages: "?page=N" and "/blog/page/N/").
//   1) start "/" (page 1 without a number): clicking the "Next »" link proposes
//      "{url}?page={page}"; "Use this pattern" fills it in; the REAL Generate
//      scrapes all nine items;
//   2) start "/?page=1": the URL alone proposes a template without {url}
//      ("…/?page={page}"), which also scrapes all nine items;
//   3) start "/blog/": clicking the link proposes "{url}page/{page}/", nine items;
//   - the typed selector and "Discover start pages" are collapsed under Advanced,
//     the URL pattern and max-pages "?" popovers explain themselves;
//   - German wording and no horizontal overflow at 280/320/400 px.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-405-pagination-helpers-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('paginated-listing');
  const browser = await launchBrowser();

  try {
    const base = fixture.url.endsWith('/') ? fixture.url : `${fixture.url}/`;
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(base);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // The field: every list item (flat mode matches the selector page-wide).
    await popup.click('#btn-add-field');
    await fixturePage.click('li.item >> nth=0');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Titel');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);

    // Pagination on, page-number kind not chosen yet.
    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-pagination');
    const banner = popup.locator('#pagination-suggestion');
    assert(!(await banner.isVisible()), 'no proposal before there is anything to learn from');

    // Advanced placement.
    assert(!(await popup.locator('#input-pagination-next-link-selector').isVisible()), 'the typed selector sits under a collapsed Advanced');
    assert(!(await popup.locator('#toggle-discovered-urls').isVisible()), '"Discover start pages" sits under a collapsed Advanced');
    assert(/Advanced: find start pages automatically/.test(await popup.locator('#discovered-urls-advanced > summary').textContent()), 'summary of the discovery block');

    const reloadPopup = async (language) => {
      if (language) await popup.evaluate((lang) => chrome.storage.local.set({ language: lang }), language);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
      if (!(await popup.locator('#pagination-config').isVisible())) await popup.click('#settings-section-toggle');
    };

    const generateRows = async () => {
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      const cells = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => tr.cells[0].textContent));
      await popup.click('#btn-back-to-config');
      await waitForIdleScreen(popup);
      return cells;
    };
    const useProposal = async (expectedTemplate, label) => {
      await popup.waitForSelector('#pagination-suggestion:not(.hidden)');
      const template = await popup.locator('#pagination-suggestion-template').textContent();
      assert(template === expectedTemplate, `${label}: expected the proposal ${expectedTemplate}, got ${template}`);
      await popup.click('#btn-pagination-use-template');
      assert(await popup.inputValue('#input-pagination-url-template') === expectedTemplate, `${label}: the template field should hold the proposal`);
      assert(!(await banner.isVisible()), `${label}: the banner should go away once applied`);
    };

    // 1) Learn the pattern from the "Next »" link.
    await popup.click('#btn-pick-pagination-next-link');
    await focusFixture(fixturePage);
    await fixturePage.click('a.next');
    await waitForIdleScreen(popup);
    assert(await fixturePage.url() === base, 'selecting the link must not navigate the page');
    assert(/a\.next/.test(await popup.locator('#pagination-next-link-selected').textContent()), 'the picked selector is shown');
    await useProposal('{url}?page={page}', 'query style');
    await popup.screenshot({ path: path.join(__dirname, 'issue-405-pagination-suggestion.png'), fullPage: true });
    await popup.fill('#input-pagination-max-pages', '5');
    await popup.locator('#input-pagination-max-pages').blur();
    let rows = await generateRows();
    assert(rows.length === 9 && rows[0] === 'Artikel 1' && rows[8] === 'Artikel 9', `query style: expected Artikel 1..9, got ${JSON.stringify(rows)}`);
    console.log('query style: "{url}?page={page}" scraped', rows.length, 'items');

    // 2) A start URL that already says ?page=1: proposal without {url}.
    await fixturePage.goto(`${base}?page=1`);
    await reloadPopup();
    await useProposal(`${base}?page={page}`, 'start URL with page=1');
    rows = await generateRows();
    assert(rows.length === 9 && rows[8] === 'Artikel 9', `start URL with page=1: expected 9 items, got ${JSON.stringify(rows)}`);
    console.log('start URL with page=1: the written-out template scraped', rows.length, 'items');

    // 3) Path style on the blog listing, learned from the page-2 link.
    await fixturePage.goto(`${base}blog/`);
    await reloadPopup();
    await popup.click('#btn-pagination-page-number');
    await popup.click('#btn-pick-pagination-page-link');
    await focusFixture(fixturePage);
    await fixturePage.click('a.page-link >> nth=1'); // the "2" link
    await waitForIdleScreen(popup);
    await useProposal('{url}page/{page}/', 'path style');
    rows = await generateRows();
    assert(rows.length === 9 && rows[0] === 'Beitrag 1' && rows[8] === 'Beitrag 9', `path style: expected Beitrag 1..9, got ${JSON.stringify(rows)}`);
    console.log('path style: "{url}page/{page}/" scraped', rows.length, 'items');

    // Popovers.
    for (const [hostSelector, pattern] of [['[data-help="help.pagination.urlTemplate"]', /\{page\} is replaced by the page number/], ['[data-help="help.pagination.maxPages"]', /safety limit/]]) {
      const btn = popup.locator(`${hostSelector} .help-btn`);
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const panel = popup.locator(`#${await btn.getAttribute('aria-controls')}`);
      assert(pattern.test(await panel.locator('.help-popover-text').textContent()), `popover text for ${hostSelector}`);
      await popup.keyboard.press('Escape');
    }
    console.log('popovers explain the pattern and the safety limit');

    // Widths.
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 900 });
      const { widest, blockRight } = await popup.evaluate(() => {
        const block = document.getElementById('pagination-config');
        return {
          blockRight: block.getBoundingClientRect().right,
          widest: Math.max(...Array.from(block.querySelectorAll('*')).filter((el) => !el.classList.contains('mode-toggle-thumb')).map((el) => el.getBoundingClientRect().right)),
        };
      });
      assert(widest <= blockRight + 1, `pagination overflows at ${width}px (${widest} > ${blockRight})`);
    }
    await popup.setViewportSize({ width: 1280, height: 720 });

    // German.
    await reloadPopup('de');
    assert(/Muster für die Seiten-URL/.test(await popup.locator('label[for="input-pagination-url-template"]').textContent()), 'German template label');
    assert(/Erweitert: Startseiten automatisch finden/.test(await popup.locator('#discovered-urls-advanced > summary').textContent()), 'German discovery summary');
    console.log('OK — pagination helpers end to end (English + German).');
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
