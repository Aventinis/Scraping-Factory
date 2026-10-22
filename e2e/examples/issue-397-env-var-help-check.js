// Issue #397: real-browser check of the shared environment-variable help and
// validation, on the four places a variable name can be typed on the idle screen
// (proxy, change detection, custom request headers, a login Fill action):
//   - every place has the same "What is an environment variable?" line and its "?"
//     popover shows the same text (SMTP_PASSWORD, setx / export);
//   - an invalid name is flagged right away with a message and aria-invalid, a valid
//     one clears it — in every place;
//   - the labels and placeholders carry an example, in German too;
//   - Generate with an invalid name is stopped with a warning before any request;
//   - no horizontal overflow added at 280/320/400 px (screenshots next to this file).
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-397-env-var-help-check.js
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
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // A field so Generate is enabled later.
    await popup.click('#btn-add-field');
    await fixturePage.waitForTimeout(500);
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Gericht');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);

    // Open every place a variable name can be typed.
    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-proxy');
    await popup.check('#toggle-request-headers');
    await popup.click('#monitoring-section-toggle');
    await popup.check('#toggle-change-detection');
    await popup.click('#btn-engine-browser');
    await popup.click('#btn-add-action-fill');

    // Each place: [name, locator of its input, locator of its row container]
    const places = [
      ['proxy', popup.locator('#input-proxy-env-var')],
      ['change detection (SMTP password)', popup.locator('#input-cd-smtp-password')],
      ['change detection (sender)', popup.locator('#input-cd-email-from')],
      ['Fill action', popup.locator('.browser-action-env-name').first()],
    ];
    // custom header: a row with the "Environment variable" kind
    const headerRow = popup.locator('#request-headers-list .request-header-row').first();
    await headerRow.locator('.request-header-name').fill('X-Api-Key');
    await headerRow.locator('.request-header-name').blur();
    await headerRow.locator('.request-header-kind').selectOption('env');
    places.push(['request header', popup.locator('#request-headers-list .request-header-value').first()]);

    // 1) The same explanation + popover everywhere.
    const helpTexts = new Set();
    const notes = popup.locator('.env-var-note:visible');
    const noteCount = await notes.count();
    assert(noteCount >= 4, `expected an explanation line for proxy, change detection, request headers and the Fill action, got ${noteCount}`);
    for (let i = 0; i < noteCount; i++) {
      const note = notes.nth(i);
      assert((await note.locator('span').first().textContent()) === 'What is an environment variable?', 'unexpected explanation label');
      const btn = note.locator('.help-btn');
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const panel = popup.locator(`#${await btn.getAttribute('aria-controls')}`);
      assert(await panel.isVisible(), `popover ${i} should open`);
      helpTexts.add(`${await panel.locator('.help-popover-text').textContent()}|${await panel.locator('.help-popover-example').textContent()}`);
      await popup.keyboard.press('Escape');
    }
    assert(helpTexts.size === 1, `every place should show the same help, got ${helpTexts.size} variants`);
    const [helpText, helpExample] = [...helpTexts][0].split('|');
    assert(/runs the script/.test(helpText) && /SMTP_PASSWORD/.test(helpText) && /not in the browser/.test(helpText), `unexpected help text: ${helpText}`);
    assert(/setx SMTP_PASSWORD/.test(helpExample) && /export SMTP_PASSWORD/.test(helpExample), `the example should show setx and export: ${helpExample}`);
    console.log(`${noteCount} places show the same "What is an environment variable?" popover`);

    // 2) Invalid -> message, valid -> gone, in every place.
    for (const [name, input] of places) {
      await input.scrollIntoViewIfNeeded();
      await input.fill('MY VAR');
      assert((await input.getAttribute('aria-invalid')) === 'true', `${name}: an invalid name should be flagged`);
      const message = input.locator('xpath=ancestor::*[contains(@class,"output-settings-row") or contains(@class,"browser-action-field-row") or contains(@class,"request-header-row")][1]/following-sibling::*[1]');
      assert(/letters, digits and underscores/.test(await message.textContent()), `${name}: expected the invalid-characters message, got "${await message.textContent()}"`);
      await input.fill('1BAD');
      assert(/can't start with a digit/.test(await message.textContent()), `${name}: expected the starts-with-digit message`);
      await input.fill('SOME_VARIABLE');
      assert((await input.getAttribute('aria-invalid')) === null, `${name}: a valid name should clear the flag`);
      assert(await popup.locator('.env-var-error').count() === 0 || !(await message.evaluate((el) => el.classList.contains('env-var-error'))), `${name}: the message should be gone`);
    }
    console.log('invalid names flagged with a message in every place, cleared by a valid one');

    // 3) Labels / placeholders carry examples.
    assert((await popup.locator('#input-proxy-env-var').getAttribute('placeholder')) === 'e.g. PROXY_LIST', 'proxy placeholder');
    assert((await popup.locator('#input-cd-smtp-password').getAttribute('placeholder')) === 'e.g. SMTP_PASSWORD', 'SMTP password placeholder');
    assert(/Variable holding the SMTP password/.test(await popup.locator('label[for="input-cd-smtp-password"]').textContent()), 'SMTP password label');

    // 4) Generate with an invalid name stops before any request.
    await popup.fill('#input-proxy-env-var', 'PROXY LIST');
    await popup.fill('#input-cd-smtp-password', '');
    await popup.fill('#input-cd-email-from', '');
    await popup.locator('.browser-action-env-name').first().fill('');
    await popup.locator('#request-headers-list .request-header-value').first().fill('');
    await popup.evaluate(() => document.getElementById('error-toast').classList.add('hidden'));
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#error-toast:not(.hidden)', { timeout: 10000 });
    const warning = await popup.locator('#error-toast-message').textContent();
    assert(/Fix the environment variable name first/.test(warning) && /“PROXY LIST”/.test(warning), `unexpected generate warning: ${warning}`);
    assert(/toast-warn/.test((await popup.locator('#error-toast').getAttribute('class')) || ''), 'the warning should be amber');
    assert(await popup.locator('#screen-idle').isVisible(), 'the panel should stay on the configuration');
    console.log('generate with an invalid name: stopped with a warning, still on the configuration');

    // 5) Widths.
    await popup.fill('#input-proxy-env-var', 'PROXY_LIST');
    await popup.fill('#input-cd-smtp-password', 'bad name');
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 1100 });
      const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`width ${width}px: horizontal overflow ${overflow}px`);
      assert(overflow <= (width === 280 ? 44 : width === 320 ? 4 : 0), `env-var markup adds horizontal scrolling at ${width}px (${overflow}px)`);
      await popup.locator('#change-detection-config').scrollIntoViewIfNeeded();
      await popup.locator('#change-detection-config').screenshot({ path: path.join(__dirname, `issue-397-change-detection-${width}.png`) });
    }
    await popup.setViewportSize({ width: 420, height: 1100 });

    // 6) German.
    await popup.evaluate(() => chrome.storage.local.set({ language: 'de' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await popup.click('#settings-section-toggle');
    await popup.check('#toggle-proxy');
    assert(/Variable mit der Proxy-Liste/.test(await popup.locator('label[for="input-proxy-env-var"]').textContent()), 'German proxy label');
    assert((await popup.locator('#input-proxy-env-var').getAttribute('placeholder')) === 'z. B. PROXY_LIST', 'German placeholder');
    await popup.fill('#input-proxy-env-var', 'PROXY-LISTE');
    assert(/nur Buchstaben, Ziffern und Unterstriche/.test(await popup.locator('.env-var-error').first().textContent()), 'German validation message');
    console.log('german labels, placeholders and validation message');

    console.log('OK — one explanation and one validation on every environment-variable input.');
  } catch (err) {
    const t = await browser.context.pages().at(-1).locator('#error-toast').textContent().catch(() => null);
    if (t) console.error('Toast:', t.replace(/\s+/g, ' ').slice(0, 200));
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
