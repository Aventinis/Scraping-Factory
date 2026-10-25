// Issue #510: real-browser check that the Script name and Output file name fields stay empty and show their defaults as placeholders
// (speisekarte fixture, "From website" for the script and "Same as the script name" for the output):
//   nothing typed → both fields empty, both placeholders the host name, and the script and data file carry that name;
//   typing a script name needs no deleting first, the output placeholder follows it live, and both files take it;
//   a typed output name wins; clearing a field returns to the default.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-510-name-placeholders-check.js
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
    await popup.evaluate(() => chrome.storage.local.set({
      language: 'en', companionUrlOverride: 'http://localhost:5055',
      globalSettings: { includeOutputFile: true, scriptNameMode: 'hostname', outputNameMode: 'script' },
    }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    await popup.click('#btn-add-field');
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Gericht');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);

    const script = popup.locator('#input-script-filename');
    const output = popup.locator('#input-output-filename');
    const host = '127_0_0_1';

    assert(await script.inputValue() === '' && await output.inputValue() === '', 'both fields start empty');
    assert(await script.getAttribute('placeholder') === host, `the script placeholder is the host name, got ${await script.getAttribute('placeholder')}`);
    assert(await output.getAttribute('placeholder') === host, 'the output placeholder follows the script default');
    await popup.screenshot({ path: path.join(__dirname, 'issue-510-placeholders.png') });

    // Generates, then returns the names of the script and the data file the done screen offers.
    const run = async () => {
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      const [dataFile] = await Promise.all([popup.waitForEvent('download'), popup.click('#btn-download-output')]);
      const [scriptFile] = await Promise.all([popup.waitForEvent('download'), popup.click('#btn-download')]);
      const names = { script: scriptFile.suggestedFilename(), data: dataFile.suggestedFilename() };
      await popup.click('#btn-back-to-config');
      await waitForIdleScreen(popup);
      return names;
    };

    let names = await run();
    assert(names.script === `${host}.py` && names.data === `${host}.csv`, `defaults expected, got ${JSON.stringify(names)}`);

    // Typing needs no deleting first; the output placeholder follows live.
    await script.click();
    await popup.keyboard.type('mein-skript');
    assert(await script.inputValue() === 'mein-skript', 'the typed name is exactly what was typed');
    assert(await output.getAttribute('placeholder') === 'mein-skript', 'the output placeholder follows the typed script name');
    names = await run();
    assert(names.script === 'mein-skript.py' && names.data === 'mein-skript.csv', `typed script name expected, got ${JSON.stringify(names)}`);

    // A typed output name wins.
    await output.fill('daten');
    names = await run();
    assert(names.script === 'mein-skript.py' && names.data === 'daten.csv', `typed output name expected, got ${JSON.stringify(names)}`);

    // Clearing both returns to the defaults.
    await script.fill('');
    await output.fill('');
    assert(await script.getAttribute('placeholder') === host && await output.getAttribute('placeholder') === host, 'placeholders return to the defaults');
    names = await run();
    assert(names.script === `${host}.py` && names.data === `${host}.csv`, `defaults again expected, got ${JSON.stringify(names)}`);

    console.log('OK — empty fields with default placeholders; defaults, typed names and clearing all produce the expected files.');
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
