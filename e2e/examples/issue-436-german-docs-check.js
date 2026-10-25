// Issue #436: real-browser check of the German documentation and the language-aware
// "Learn more" links, in the real unpacked extension.
//   - with the panel in German, "Mehr erfahren" (here: next to "Benachrichtigungen & Prüfungen")
//     opens the GERMAN page at the GERMAN heading (docs/de/monitoring.html#sicherheitspruefungen
//     is reached from the English key "safetyChecks"), with its German heading, its German
//     screenshot and a navigation in German; no request leaves the extension;
//   - the language switch on the page leads to the English twin and back;
//   - with the panel in English or Spanish the same link opens the English page;
//   - a link inside a German page stays inside the German tree.
//
// Runs its own companion on port 5055, so a companion a human already has running on the
// default port is never used or touched.
//
// Usage: node e2e/examples/issue-436-german-docs-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    const origin = `chrome-extension://${browser.extensionId}/`;
    const requests = [];
    browser.context.on('request', (r) => requests.push(r.url()));

    const reopen = async (language) => {
      await popup.evaluate((l) => chrome.storage.local.set({ language: l, companionUrlOverride: 'http://localhost:5055' }), language);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
    };
    const openFromPanel = async () => {
      if (!(await popup.locator('#hardening-config').isVisible())) await popup.click('#monitoring-section-toggle');
      const helpButton = popup.locator('#hardening-config .help-host[data-help="help.hardening.severity"] .help-btn');
      await helpButton.click();
      const link = popup.locator(`#${await helpButton.getAttribute('aria-controls')} a.learn-more`);
      const [page] = await Promise.all([browser.context.waitForEvent('page'), link.click()]);
      await page.waitForLoadState('load');
      return page;
    };

    // 1) German panel → German page, German heading.
    await reopen('de');
    const de = await openFromPanel();
    assert(decodeURIComponent(de.url()) === `${origin}docs/de/monitoring.html#sicherheitsprüfungen`, `unexpected address: ${de.url()}`);
    assert((await de.locator('h1').textContent()) === 'Sicherheitsprüfungen und Benachrichtigungen', 'the German heading');
    assert(await de.locator('html').getAttribute('lang') === 'de', 'the page should declare German');
    assert(await de.locator('[id="sicherheitsprüfungen"]').isVisible(), 'the target heading should be visible');
    const imageOk = await de.evaluate(() => {
      const img = document.querySelector('img[src="images/monitoring-recommended.png"]');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    assert(imageOk, 'the German screenshot should load from the bundle');
    assert(/Erste Schritte/.test(await de.locator('nav.docs-nav').textContent()), 'the navigation should be in German');
    await de.screenshot({ path: path.join(__dirname, 'issue-436-german-page.png') });
    console.log('german panel: opened', de.url());

    // 2) A link inside the German page stays German; the language switch leads to the English twin and back.
    await de.locator('nav.docs-nav a', { hasText: 'Ausgabeformate' }).click();
    await de.waitForLoadState('load');
    assert(de.url() === `${origin}docs/de/output.html`, `navigation left the German tree: ${de.url()}`);
    await de.locator('.docs-lang a').click();
    await de.waitForLoadState('load');
    assert(de.url() === `${origin}docs/output.html`, `the language switch should lead to the English page: ${de.url()}`);
    assert((await de.locator('h1').textContent()).startsWith('Output formats'), 'the English heading');
    await de.locator('.docs-lang a').click();
    await de.waitForLoadState('load');
    assert(de.url() === `${origin}docs/de/output.html`, 'and back to German');
    const outside = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.includes('localhost:5055') && !u.includes('127.0.0.1'));
    assert(outside.length === 0, `the docs reached outside the extension: ${JSON.stringify(outside)}`);
    await de.close();
    console.log('german tree: navigation and language switch stay in the extension');

    // 3) English and Spanish panels open the English page.
    for (const language of ['en', 'es']) {
      await reopen(language);
      const page = await openFromPanel();
      assert(page.url() === `${origin}docs/monitoring.html#safety-checks`, `${language}: unexpected address ${page.url()}`);
      await page.close();
    }
    console.log('english and spanish panels: the English page');

    console.log('OK — "Mehr erfahren" opens the German documentation at the German heading when the panel is German.');
  } catch (err) {
    const t = await browser.context.pages().at(-1).locator('#error-toast').textContent().catch(() => null);
    if (t) console.error('Toast:', t.replace(/\s+/g, ' ').slice(0, 300));
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await fixture.stop?.();
    await companion.stop?.();
  }
})().catch((err) => { console.error(err); process.exit(1); });
