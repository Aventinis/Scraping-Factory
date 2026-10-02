// Issue #252: verify the new Output Blueprints "upload a sample file" input
// in a real Chromium browser with the real unpacked extension — picking a
// file should fill the paste textarea (without auto-parsing), and the
// existing "Parse & fill fields" button should then populate the field list
// exactly like it already does for a pasted sample.
//
// Usage: node e2e/examples/issue-252-blueprint-file-upload.js
const fs = require('fs');
const os = require('os');
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

  const sampleFilePath = path.join(os.tmpdir(), 'sf-blueprint-sample.csv');
  fs.writeFileSync(sampleFilePath, 'Title,Price,Sku');

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);

    const popupPage = await openPopup(browser.context, browser.extensionId);
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#settings-section-toggle');
    await popupPage.click('#btn-manage-blueprints');
    await popupPage.click('#btn-blueprint-new');

    const modal = popupPage.locator('#modal-blueprint-edit');
    if (!(await modal.isVisible())) throw new Error('Expected #modal-blueprint-edit to be visible after "+ New blueprint"');

    const fileInput = popupPage.locator('#input-blueprint-import-file');
    if (!(await fileInput.isVisible())) throw new Error('Expected #input-blueprint-import-file to be visible');

    const screenshotBefore = path.join(__dirname, 'issue-252-before.png');
    await modal.screenshot({ path: screenshotBefore });
    console.log(`Screenshot (before picking a file) saved to ${screenshotBefore}`);

    await fileInput.setInputFiles(sampleFilePath);

    const textareaValue = await popupPage.locator('#input-blueprint-import-sample').inputValue();
    console.log(`Textarea value after picking the file: "${textareaValue}"`);
    if (textareaValue !== 'Title,Price,Sku') {
      throw new Error(`Expected the textarea to be filled with the file's content, got "${textareaValue}"`);
    }

    const fieldInputsBeforeParse = await popupPage.locator('.blueprint-field-name-input').all();
    const valuesBeforeParse = await Promise.all(fieldInputsBeforeParse.map((el) => el.inputValue()));
    console.log(`Field list before pressing "Parse & fill fields": ${JSON.stringify(valuesBeforeParse)}`);
    if (valuesBeforeParse.some((v) => v !== '')) {
      throw new Error('Expected the field list to stay untouched until "Parse & fill fields" is pressed (no auto-parse)');
    }

    const screenshotAfterPick = path.join(__dirname, 'issue-252-after-pick.png');
    await modal.screenshot({ path: screenshotAfterPick });
    console.log(`Screenshot (after picking a file, before parsing) saved to ${screenshotAfterPick}`);

    await popupPage.click('#btn-blueprint-import-parse');

    const fieldInputsAfterParse = await popupPage.locator('.blueprint-field-name-input').all();
    const valuesAfterParse = await Promise.all(fieldInputsAfterParse.map((el) => el.inputValue()));
    console.log(`Field list after pressing "Parse & fill fields": ${JSON.stringify(valuesAfterParse)}`);
    if (JSON.stringify(valuesAfterParse) !== JSON.stringify(['Title', 'Price', 'Sku'])) {
      throw new Error(`Expected ['Title','Price','Sku'], got ${JSON.stringify(valuesAfterParse)}`);
    }

    const screenshotAfterParse = path.join(__dirname, 'issue-252-after-parse.png');
    await modal.screenshot({ path: screenshotAfterParse });
    console.log(`Screenshot (after parsing) saved to ${screenshotAfterParse}`);

    console.log('OK — the file-upload input fills the textarea without auto-parsing, and "Parse & fill fields" applies it correctly.');
  } finally {
    fs.unlinkSync(sampleFilePath);
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('ISSUE #252 CHECK FAILED:', err.message);
  process.exit(1);
});
