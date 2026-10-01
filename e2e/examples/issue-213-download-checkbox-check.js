// Ad hoc real-browser check for Issue #213's new "Download this resource"
// checkbox (#toggle-field-download inside #field-attribute-row,
// modal-field-extended, container mode). Exercises the actual production
// change-listener wired in container-tree-ui.js by revealing the modal
// directly (no need to drive the full click-based element-selection flow
// against the fixture page for a check that's purely about this one
// select's own show/hide wiring).
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

    // Reveal modal-field-extended directly — the check below is about the
    // mode-select's own change-listener wiring (container-tree-ui.js),
    // which behaves identically regardless of how the modal became visible.
    await popupPage.evaluate(() => {
      document.getElementById('modal-field-extended').classList.remove('hidden');
    });

    const attributeRow = popupPage.locator('#field-attribute-row');
    const downloadToggle = popupPage.locator('#toggle-field-download');

    const hiddenInTextMode = await attributeRow.evaluate((el) => el.classList.contains('hidden'));
    console.log(`(1) #field-attribute-row hidden while mode=text: ${hiddenInTextMode}`);

    await popupPage.selectOption('#select-field-mode', 'attribute');
    const hiddenInAttributeMode = await attributeRow.evaluate((el) => el.classList.contains('hidden'));
    const attributeInputVisible = await popupPage.locator('#input-field-attribute').isVisible();
    const downloadToggleVisible = await downloadToggle.isVisible();
    console.log(`(2) #field-attribute-row hidden after switching to attribute: ${hiddenInAttributeMode} (expect false)`);
    console.log(`    attribute input visible: ${attributeInputVisible}, download checkbox visible: ${downloadToggleVisible}`);

    const initiallyChecked = await downloadToggle.isChecked();
    console.log(`(3) download checkbox initially checked: ${initiallyChecked} (expect false)`);

    await downloadToggle.check();
    await popupPage.selectOption('#select-field-mode', 'text');
    await popupPage.selectOption('#select-field-mode', 'attribute');
    const stillThereNoError = await downloadToggle.isVisible();
    console.log(`(4) switched away and back without error, checkbox still visible: ${stillThereNoError}`);

    const screenshotPath = path.join(__dirname, 'issue-213-download-checkbox.png');
    await popupPage.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);

    const allGood = !hiddenInTextMode === false // i.e. hiddenInTextMode === true
      && hiddenInTextMode === true
      && hiddenInAttributeMode === false
      && attributeInputVisible
      && downloadToggleVisible
      && initiallyChecked === false
      && stillThereNoError;
    console.log(allGood ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED — see output above');
    if (!allGood) process.exitCode = 1;
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
