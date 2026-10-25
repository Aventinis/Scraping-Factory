// Issue #509: real-browser check of the default output file name (Settings) on the speisekarte fixture. The name of the downloaded
// data file shows what the trial run wrote:
//   setting untouched → output.csv; "Same as the script name" → <script>.csv; "Custom name" → <custom>.csv; a typed name always
//   wins; and the setting is not part of a saved configuration's export (it keeps what the user typed).
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-509-default-output-name-check.js
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
    const setSettings = async (extra) => {
      await popup.evaluate((patch) => chrome.storage.local.set({
        language: 'en', companionUrlOverride: 'http://localhost:5055',
        globalSettings: { includeOutputFile: true, includeDataPreview: true, ...patch },
      }), extra);
      await popup.reload();
      await focusFixture(fixturePage);
      await waitForIdleScreen(popup);
    };

    await setSettings({});
    await popup.click('#btn-add-field');
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Gericht');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);
    await popup.fill('#input-script-filename', 'speisekarte-demo');

    // Runs the script and returns the name of the data file the done screen offers.
    const runAndGetFileName = async () => {
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('#btn-download-output')]);
      const name = download.suggestedFilename();
      await popup.click('#btn-back-to-config');
      await waitForIdleScreen(popup);
      return name;
    };

    assert(await runAndGetFileName() === 'output.csv', 'with the setting untouched the data file stays output.csv');

    // The Settings screen: choose "Same as the script name".
    await popup.click('#btn-open-settings');
    await popup.waitForSelector('#screen-settings:not(.hidden)');
    await popup.click('#btn-output-name-mode-script');
    await popup.screenshot({ path: path.join(__dirname, 'issue-509-settings.png') });
    await popup.click('#btn-settings-back, #btn-close-settings').catch(() => {});
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    assert(await popup.inputValue('#input-script-filename') === 'speisekarte-demo', 'the script name survives the reload');
    assert(await runAndGetFileName() === 'speisekarte-demo.csv', '"Same as the script name" names the data file after the script');

    // A typed name wins.
    await popup.fill('#input-output-filename', 'mein-name');
    assert(await runAndGetFileName() === 'mein-name.csv', 'a typed name always wins');
    await popup.fill('#input-output-filename', '');

    // "Custom name".
    await setSettings({ outputNameMode: 'fixed', outputNameFixed: 'daily data' });
    assert(await popup.inputValue('#input-script-filename') === 'speisekarte-demo', 'the script name survives the reload');
    assert(await runAndGetFileName() === 'daily_data.csv', 'a custom default names the data file (sanitized like a typed one)');

    // The default is never written into the field the user types in (and so not into a saved configuration or its export).
    const storedName = await popup.evaluate(async () => {
      const stored = await chrome.storage.session.get(['outputFileName']);
      return stored.outputFileName ?? '';
    });
    assert(storedName === '', 'the default must not be written into the stored output file name field');

    console.log('OK — default output file name: output.csv untouched, <script>.csv, <custom>.csv, typed name wins.');
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
