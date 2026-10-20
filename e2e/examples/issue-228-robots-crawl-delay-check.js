// Issue #228: real-browser check of "Respect the site's robots.txt
// (Crawl-delay)" against the crawl-delay fixture (3 paginated pages, robots.txt
// asking for "Crawl-delay: 2"). The fixture logs when a generated script
// requests each page, so the check measures the real gaps:
//   1) without the checkbox the pages are requested back to back (< 1.5 s apart),
//   2) with it, every gap is at least ~2 s, and robots.txt was read once.
//
// Runs its own companion on port 5056, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-228-robots-crawl-delay-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const fixtureLog = async (fixture) => (await fetch(`${fixture.url}__log`)).json();
const gapsOf = (times) => times.slice(1).map((t, i) => t - times[i]);

(async () => {
  const companion = await startCompanion({ port: 5056 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5056 — stop it first.');
  const fixture = await startFixture('crawl-delay');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5056' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.offer >> nth=0 >> .name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Name');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    // Pagination: {url}?page={page}, three pages.
    await popupPage.click('#settings-section-toggle');
    await popupPage.check('#toggle-pagination');
    await popupPage.click('#btn-pagination-page-number');
    await popupPage.fill('#input-pagination-url-template', '{url}?page={page}');
    await popupPage.fill('#input-pagination-max-pages', '3');

    const generate = async () => {
      await focusFixture(fixturePage);
      await popupPage.click('#btn-generate');
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      await popupPage.click('#btn-back-to-config');
      await waitForIdleScreen(popupPage);
    };

    // 1) Checkbox off: no pacing.
    await fetch(`${fixture.url}__reset`);
    await generate();
    let log = await fixtureLog(fixture);
    if (log.pages.length !== 3) throw new Error(`expected 3 page requests without the checkbox, got ${log.pages.length}`);
    const quick = gapsOf(log.pages);
    console.log('Without the checkbox, gaps (s):', quick.map(g => g.toFixed(2)).join(', '));
    if (Math.max(...quick) > 1.5) throw new Error('pages were paced although the checkbox is off');
    if (log.robots !== 0) throw new Error('robots.txt was read although the checkbox is off');

    // 2) Checkbox on: every gap honors the Crawl-delay of 2 s.
    await popupPage.check('#toggle-respect-robots-delay');
    await popupPage.locator('#toggle-respect-robots-delay').screenshot({ path: path.join(__dirname, 'issue-228-robots-crawl-delay.png') });
    await fetch(`${fixture.url}__reset`);
    await generate();
    log = await fixtureLog(fixture);
    if (log.pages.length !== 3) throw new Error(`expected 3 page requests with the checkbox, got ${log.pages.length}`);
    const paced = gapsOf(log.pages);
    console.log('With the checkbox, gaps (s):', paced.map(g => g.toFixed(2)).join(', '), '— robots.txt reads:', log.robots);
    if (Math.min(...paced) < 1.9) throw new Error('the Crawl-delay of 2 s was not honored');
    if (log.robots !== 1) throw new Error(`expected robots.txt to be read once, got ${log.robots}`);

    console.log('OK — pages were requested back to back without the checkbox and ≥ 2 s apart with it (robots.txt read once).');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
