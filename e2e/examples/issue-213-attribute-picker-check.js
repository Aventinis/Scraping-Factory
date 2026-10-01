// Ad hoc real-browser check for the Issue #213 follow-up: the attribute
// field is now a <select> populated with the clicked element's own
// attributes (name: value preview options), auto-preselecting a guessed
// resource-URL attribute — replacing the old free-text input. This reveals
// the modal directly and injects realistic options (the same shape
// populateAttributeSelect produces) purely to check the *rendering* — the
// selection/guessing logic itself already has full unit+integration
// coverage in container-tree.test.js/popup.test.js.
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

(async () => {
  const companion = await startCompanion();
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);

    const popupPage = await openPopup(browser.context, browser.extensionId);
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-mode-container');
    await popupPage.evaluate(() => {
      document.getElementById('modal-field-extended').classList.remove('hidden');
      document.getElementById('select-field-mode').value = 'attribute';
      document.getElementById('field-attribute-row').classList.remove('hidden');
      const select = document.getElementById('select-field-attribute');
      select.innerHTML = [
        '<option value="class">class: menu-item-image</option>',
        '<option value="src" selected>src: /images/dish1.jpg</option>',
        '<option value="alt">alt: Hausgemachte Leberknödelsuppe</option>',
      ].join('');
    });

    const select = popupPage.locator('#select-field-attribute');
    console.log('select value:', await select.inputValue());
    console.log('select visible:', await select.isVisible());

    const screenshotPath = path.join(__dirname, 'issue-213-attribute-picker.png');
    await popupPage.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
