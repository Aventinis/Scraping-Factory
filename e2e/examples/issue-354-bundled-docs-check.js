// Issue #354 Part B: real-browser check of the bundled documentation and the
// "Learn more" links, in the real unpacked extension.
//   - a "Learn more" link in the side panel opens the matching page of the
//     BUNDLED documentation in a new tab: a chrome-extension:// address (no
//     internet needed — every request the page makes stays inside the
//     extension), with the page's heading, its image, the navigation and a
//     working link to another page;
//   - a help popover with a doc key ("Checks after every run") offers the link
//     too and lands on the right heading;
//   - the link follows the language (de: "Mehr erfahren");
//   - the long hints are one line now (the retry hint reads as one short line);
//   - a release-channel build contains the docs as well;
//   - the Monitoring section stays within the panel at 320/400 px.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-354-bundled-docs-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
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
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    const origin = `chrome-extension://${browser.extensionId}/`;

    // 1) A hint link opens the bundled page in a new tab.
    await popup.click('#monitoring-section-toggle');
    const hintLink = popup.locator('.monitoring-intro a.learn-more');
    assert(await hintLink.isVisible(), 'the Monitoring intro should carry a "Learn more" link');
    assert((await hintLink.textContent()) === 'Learn more', 'unexpected link text');
    const requests = [];
    browser.context.on('request', (r) => requests.push(r.url()));
    const [docPage] = await Promise.all([browser.context.waitForEvent('page'), hintLink.click()]);
    await docPage.waitForLoadState('load');
    assert(docPage.url() === `${origin}docs/monitoring.html`, `unexpected address: ${docPage.url()}`);
    assert((await docPage.locator('h1').textContent()) === 'Safety checks and alerts', 'unexpected heading');
    assert(await docPage.locator('h2#safety-checks').count() === 1, 'the page should carry the heading anchors');
    const imageOk = await docPage.evaluate(() => {
      const img = document.querySelector('img[src="images/monitoring-recommended.png"]');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    assert(imageOk, 'the screenshot on the page should load from the bundle');
    assert(await docPage.locator('nav.docs-nav a').count() >= 10, 'the page should list the other pages in its navigation');
    await docPage.screenshot({ path: path.join(__dirname, 'issue-354-docs-page.png') });
    console.log('hint link: opened', docPage.url());

    // 2) A link between pages stays inside the bundle.
    await docPage.locator('nav.docs-nav a', { hasText: 'Output formats' }).click();
    await docPage.waitForLoadState('load');
    assert(docPage.url() === `${origin}docs/output.html`, `navigation went to ${docPage.url()}`);
    assert(await docPage.locator('h2#output-layouts').count() === 1, 'the output page should carry its headings');
    const outside = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    assert(outside.length === 0, `the docs reached outside the extension: ${JSON.stringify(outside)}`);
    console.log('navigation: stays in the extension, no outside request');
    await docPage.close();

    // 3) A help popover offers the link and lands on the heading.
    await focusFixture(fixturePage);
    if (!(await popup.locator('#hardening-config').isVisible())) await popup.click('#monitoring-section-toggle');
    const helpButton = popup.locator('#hardening-config .help-host[data-help="help.hardening.severity"] .help-btn');
    await helpButton.click();
    const popoverLink = popup.locator(`#${await helpButton.getAttribute('aria-controls')} a.learn-more`);
    assert(await popoverLink.isVisible(), 'the popover should offer a "Learn more" link');
    const [docPage2] = await Promise.all([browser.context.waitForEvent('page'), popoverLink.click()]);
    await docPage2.waitForLoadState('load');
    assert(docPage2.url() === `${origin}docs/monitoring.html#safety-checks`, `unexpected address: ${docPage2.url()}`);
    assert(await docPage2.locator('#safety-checks').isVisible(), 'the target heading should be visible');
    await docPage2.close();
    console.log('popover link: monitoring.html#safety-checks');

    // 4) The long hints are one short line now.
    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-retry');
    const retryHint = await popup.locator('#retry-config .preview-summary span[data-i18n="idle.retryHint"]').textContent();
    assert(retryHint.length <= 160, `the retry hint should be one short line, got ${retryHint.length} characters`);
    assert(retryHint === 'Retries after a connection error, a timeout or one of these status codes; other errors such as 404 fail at once.', `unexpected retry hint: ${retryHint}`);
    const retryLink = popup.locator('#retry-config a.learn-more[data-doc="retry"]');
    const [docPage3] = await Promise.all([browser.context.waitForEvent('page'), retryLink.click()]);
    await docPage3.waitForLoadState('load');
    assert(docPage3.url() === `${origin}docs/network-settings.html#retry-on-transient-errors`, `unexpected address: ${docPage3.url()}`);
    assert((await docPage3.locator('#retry-on-transient-errors').textContent()).includes('Retry on transient errors'), 'the retry section should be on the page');
    await docPage3.close();
    console.log('retry: one-line hint, link to the retry section');
    await popup.uncheck('#toggle-retry');

    // 5) The link follows the language.
    await popup.evaluate(() => chrome.storage.local.set({ language: 'de' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await popup.click('#monitoring-section-toggle');
    assert((await popup.locator('.monitoring-intro a.learn-more').textContent()) === 'Mehr erfahren', 'the link should read "Mehr erfahren" in German');
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    console.log('german: "Mehr erfahren"');

    // 6) The Monitoring section stays inside the panel with the links in it.
    for (const width of [320, 400]) {
      await popup.setViewportSize({ width, height: 1200 });
      if (!(await popup.locator('#hardening-config').isVisible())) await popup.click('#monitoring-section-toggle');
      const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 4, `width ${width}px: horizontal overflow ${overflow}px`);
      console.log(`width ${width}px: overflow ${overflow}px`);
    }
    await popup.setViewportSize({ width: 420, height: 1200 });
    await popup.screenshot({ path: path.join(__dirname, 'issue-354-learn-more.png') });

    // 7) A release-channel build carries the documentation too.
    const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-release-'));
    execFileSync(process.execPath, [path.join(__dirname, '../../extension/build.js'), '--channel', 'release', '--outdir', releaseDir], { stdio: 'pipe' });
    assert(fs.existsSync(path.join(releaseDir, 'docs/monitoring.html')) && fs.existsSync(path.join(releaseDir, 'docs/images/monitoring-recommended.png')), 'the release build should contain docs/');
    console.log('release build: docs/ present');

    console.log('OK — "Learn more" opens the bundled documentation offline; the long hints are one line.');
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
