// Issue #180: a minimal end-to-end smoke test proving the harness itself
// works — launches the real extension, starts the companion and the
// speisekarte fixture, opens the popup, and confirms #url-display shows the
// fixture's URL (not the popup's own chrome-extension:// URL), which is the
// one behavior focusFixture()/harness.js exists to get right. Also a
// runnable template for a real feature/bug check: copy this file, swap the
// fixture/selectors, and drive whatever click/assert sequence the change
// needs.
//
// Usage: node e2e/examples/speisekarte-smoke.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  console.log('Starting companion...');
  const companion = await startCompanion();
  console.log(companion.alreadyRunning ? '  (already running)' : '  started');

  console.log('Starting speisekarte fixture...');
  const fixture = await startFixture('speisekarte');
  console.log(`  serving at ${fixture.url}`);

  console.log('Launching browser with the unpacked extension...');
  const browser = await launchBrowser();
  console.log(`  extension id: ${browser.extensionId}`);

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);

    const popupPage = await openPopup(browser.context, browser.extensionId);
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    const urlDisplayText = await popupPage.locator('#url-display').textContent();
    console.log(`#url-display reads: "${urlDisplayText}"`);
    if (!urlDisplayText || !urlDisplayText.includes(String(new URL(fixture.url).port))) {
      throw new Error(`Expected #url-display to show the fixture URL (${fixture.url}), got "${urlDisplayText}"`);
    }

    const screenshotPath = path.join(__dirname, 'speisekarte-smoke.png');
    await popupPage.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);
    console.log('OK — the popup correctly saw the fixture page as the current tab.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
