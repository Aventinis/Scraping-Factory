// Issue #507: real-browser check of the ONE data-point search: "Find data point" looks in the recorded requests AND in the
// page's own JSON data, with no separate button.
//   1) embedded-json-menu (no recording at all): one hit, labelled "Embedded in the page"; the REAL trial run follows it;
//   2) api-nested-and-post (recorded POST): one hit, labelled "Recorded request"; the trial run follows it;
//   3) embedded-json-menu /hybrid (same data embedded AND fetched): both hits in one list, recorded first; confirming
//      the embedded one yields an embedded-JSON configuration whose trial run holds the values.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-507-unified-search-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withPage(fixtureName, pagePath, run) {
  const fixture = await startFixture(fixtureName);
  const browser = await launchBrowser();
  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url + pagePath);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({
      language: 'en', companionUrlOverride: 'http://localhost:5055', globalSettings: { includeDataPreview: true },
    }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await run({ popup, fixturePage });
  } catch (err) {
    const toast = await (await browser.context.pages()).at(-1)?.locator('#error-toast-message').textContent().catch(() => null);
    if (toast) console.error('Toast:', toast);
    throw err;
  } finally {
    await browser.close();
    await fixture.stop();
  }
}

const sources = (popup) => popup.evaluate(() => [...document.querySelectorAll('#api-candidates-list .api-candidate-url')].map((el) => el.textContent));

async function useCandidate(popup, index) {
  await popup.locator('#api-candidates-list .api-candidate-confirm').nth(index).click();
  await popup.waitForSelector('#screen-api-config:not(.hidden)');
  await popup.click('#btn-api-config-confirm');
  await waitForIdleScreen(popup);
}

async function generateAndRead(popup, fixturePage) {
  await focusFixture(fixturePage);
  await popup.click('#btn-generate');
  await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
  await popup.waitForSelector('#data-preview-text:not(.hidden), #data-preview-table-wrap:not(.hidden)');
  return popup.evaluate(() => {
    const text = document.getElementById('data-preview-text');
    return text && !text.classList.contains('hidden') ? text.textContent : document.getElementById('data-preview-table-wrap').textContent;
  });
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');

  try {
    // 1) Embedded JSON, no recording.
    await withPage('embedded-json-menu', '', async ({ popup, fixturePage }) => {
      await popup.click('#btn-mode-api');
      assert(await popup.locator('#btn-embedded-json-search').count() === 0, 'the separate embedded-JSON button must be gone');
      assert(!(await popup.isDisabled('#btn-api-search')), 'the search is available without any recording');
      await popup.click('#btn-api-search');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('.menu-item >> nth=0 >> .item-name');
      await popup.waitForSelector('#api-candidates-list .api-candidate-confirm', { state: 'visible' });
      const labels = await sources(popup);
      assert(labels.length === 1 && labels[0].startsWith('Embedded in the page'), `one embedded hit expected, got ${JSON.stringify(labels)}`);
      await popup.screenshot({ path: path.join(__dirname, 'issue-507-embedded.png') });
      await useCandidate(popup, 0);
      const sample = await generateAndRead(popup, fixturePage);
      assert(sample.includes('Hausgemachte Leberknödelsuppe'), `the trial run should hold the clicked value, got ${sample.slice(0, 300)}`);
    });

    // 2) Recorded request.
    await withPage('api-nested-and-post', '', async ({ popup, fixturePage }) => {
      await popup.click('#btn-mode-api');
      await popup.click('#btn-api-capture');
      await fixturePage.click('#btn-reload-search');
      await fixturePage.waitForSelector('#result-search .product-title');
      await popup.click('#btn-api-capture');
      await focusFixture(fixturePage);
      await popup.click('#btn-api-search');
      await fixturePage.click('#result-search .product-title >> nth=0');
      await popup.waitForSelector('#api-candidates-list .api-candidate-confirm', { state: 'visible' });
      const labels = await sources(popup);
      assert(labels.length === 1 && labels[0].startsWith('Recorded request: POST'), `one recorded hit expected, got ${JSON.stringify(labels)}`);
      await useCandidate(popup, 0);
      const sample = await generateAndRead(popup, fixturePage);
      assert(sample.includes('Smartphone X'), `the trial run should hold the clicked value, got ${sample.slice(0, 300)}`);
    });

    // 3) Both sources.
    await withPage('embedded-json-menu', 'hybrid', async ({ popup, fixturePage }) => {
      await popup.click('#btn-mode-api');
      await popup.click('#btn-api-capture');
      await fixturePage.click('#btn-reload');
      await fixturePage.waitForTimeout(800);
      await popup.click('#btn-api-capture');
      await focusFixture(fixturePage);
      await popup.click('#btn-api-search');
      await fixturePage.waitForTimeout(500);
      await fixturePage.click('li.product >> nth=0 >> .product-title');
      await popup.waitForSelector('#api-candidates-list .api-candidate-confirm', { state: 'visible' });
      const labels = await sources(popup);
      assert(labels.length === 2, `both hits expected in one list, got ${JSON.stringify(labels)}`);
      assert(labels[0].startsWith('Recorded request: GET') && labels[1].startsWith('Embedded in the page'), `recorded hit first, then the embedded one: ${JSON.stringify(labels)}`);
      await popup.screenshot({ path: path.join(__dirname, 'issue-507-both.png') });
      await useCandidate(popup, 1);
      const sample = await generateAndRead(popup, fixturePage);
      assert(sample.includes('Smartphone X') && sample.includes('Laptop Alpha'), `the embedded configuration should yield all products, got ${sample.slice(0, 300)}`);
    });

    console.log('OK — one search finds embedded JSON (no recording), recorded requests, and both in one list; the real trial runs followed.');
  } finally {
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
