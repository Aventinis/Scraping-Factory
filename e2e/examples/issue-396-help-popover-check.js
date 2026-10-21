// Issue #396: real-browser check of the reusable help popover and the
// "Advanced" disclosure, in the real unpacked extension.
//
// Help popover (reference uses: "Send custom request headers" and "Append to
// the existing output file", both in the Settings section):
//   - a "?" button sits next to each toggle; clicking it opens a panel with the
//     text and the example, WITHOUT toggling the checkbox it sits inside;
//   - a click elsewhere closes it; opening a second one closes the first;
//   - keyboard: Tab reaches the button, Enter/Space opens, Escape closes and
//     returns the focus to the button;
//   - readable at side-panel widths of 280/320/400 px: the panel stays inside
//     the viewport, no horizontal overflow (screenshots written next to this file);
//   - the text follows the language (de) and works in dark mode.
// "Advanced" disclosure: collapsed by default, an opened section is remembered
// across a reload (chrome.storage.local), per section id.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-396-help-popover-check.js
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

    await popup.click('#settings-section-toggle');
    const headersBtn = popup.locator('#request-headers-section .help-btn');
    const appendBtn = popup.locator('#append-output-row .help-btn');
    const isOpen = async (btn) => (await btn.getAttribute('aria-expanded')) === 'true'
      && await popup.locator(`#${await btn.getAttribute('aria-controls')}`).isVisible();

    // Every declared host got its button.
    const hosts = await popup.locator('.help-host').count();
    assert(hosts >= 2 && hosts === await popup.locator('.help-btn').count(), `expected a "?" per help host, got ${await popup.locator('.help-btn').count()} for ${hosts}`);

    // 1) Mouse: opens without toggling the checkbox.
    assert(!(await isOpen(headersBtn)), 'popover should start closed');
    const checkbox = popup.locator('#toggle-request-headers');
    const checkedBefore = await checkbox.isChecked();
    await headersBtn.click();
    assert(await isOpen(headersBtn), 'clicking "?" should open the popover');
    assert(await checkbox.isChecked() === checkedBefore, 'clicking "?" must not toggle the checkbox it sits next to');
    const headersPanel = popup.locator(`#${await headersBtn.getAttribute('aria-controls')}`);
    const text = await headersPanel.locator('.help-popover-text').textContent();
    const example = await headersPanel.locator('.help-popover-example').textContent();
    assert(/Extra headers/.test(text), `unexpected help text: ${text}`);
    assert(example === 'Accept-Language: de-CH', `unexpected example: ${example}`);
    console.log('mouse: opened, checkbox untouched');

    // 2) Only one at a time.
    await appendBtn.click();
    assert(await isOpen(appendBtn) && !(await isOpen(headersBtn)), 'opening a second popover should close the first');

    // 3) A click elsewhere closes it.
    await popup.click('#url-display');
    assert(!(await isOpen(appendBtn)), 'a click elsewhere should close the popover');
    console.log('one-at-a-time and click-outside: ok');

    // 4) Keyboard: Tab from the checkbox lands on the "?" button; Enter opens, Escape closes + refocuses.
    await checkbox.focus();
    await popup.keyboard.press('Tab');
    const focusedIsHelp = await popup.evaluate(() => document.activeElement && document.activeElement.classList.contains('help-btn'));
    assert(focusedIsHelp, 'Tab from the checkbox should reach the "?" button');
    await popup.keyboard.press('Enter');
    assert(await isOpen(headersBtn), 'Enter should open the popover');
    await popup.keyboard.press('Escape');
    assert(!(await isOpen(headersBtn)), 'Escape should close the popover');
    const refocused = await popup.evaluate(() => document.activeElement && document.activeElement.classList.contains('help-btn'));
    assert(refocused, 'Escape should return the focus to the "?" button');
    await popup.keyboard.press('Space');
    assert(await isOpen(headersBtn), 'Space should open the popover');
    await popup.keyboard.press('Escape');
    console.log('keyboard: Tab / Enter / Space / Escape ok');

    // 5) Side-panel widths: the panel stays inside the viewport. Screenshots at each width.
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 900 });
      await headersBtn.scrollIntoViewIfNeeded();
      // The panel itself has a min-width of 280px plus a scrollbar, so the page
      // can scroll horizontally at 280px regardless of this feature (see
      // issue-222's check) — what matters is that the popover adds nothing.
      const baseline = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await headersBtn.click();
      const box = await headersPanel.boundingBox();
      const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`width ${width}px: panel ${Math.round(box.x)}..${Math.round(box.x + box.width)}, horizontal overflow ${overflow}px (${baseline}px without the popover)`);
      assert(box.x >= 0 && box.x + box.width <= width + 0.5, `panel runs outside the ${width}px viewport`);
      assert(overflow <= baseline, `the popover adds horizontal scrolling at ${width}px (${baseline}px -> ${overflow}px)`);
      await popup.locator('#request-headers-section').screenshot({ path: path.join(__dirname, `issue-396-help-popover-${width}.png`) });
      await headersBtn.click();
    }
    await popup.setViewportSize({ width: 420, height: 900 });

    // 6) Language follows, open panel included.
    await headersBtn.click();
    await popup.selectOption('#lang-select', 'de');
    await popup.waitForFunction(() => /Zusätzliche Header/.test(document.querySelector('#request-headers-section + .help-popover, .help-popover')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
    assert(await isOpen(headersBtn), 'an open popover should stay open across a language change');
    const german = await headersPanel.locator('.help-popover-text').textContent();
    assert(/Zusätzliche Header/.test(german), `help text did not switch to German: ${german}`);
    assert((await headersBtn.getAttribute('aria-label')) === 'Hilfe', 'the button label should be German');
    await popup.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await popup.locator('#request-headers-section').screenshot({ path: path.join(__dirname, 'issue-396-help-popover-dark-de.png') });
    await popup.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await popup.selectOption('#lang-select', 'en');
    await popup.click('#url-display');
    console.log('language switch + dark theme: ok');

    // 7) "Advanced" disclosure: collapsed by default, remembered per section across a reload.
    const addDisclosure = () => popup.evaluate(() => {
      const details = SFAdvancedDisclosureUI.createAdvancedDisclosure('e2e-rare-options');
      details.querySelector('.advanced-disclosure-body').textContent = 'Rarely needed option';
      document.getElementById('settings-section-content').appendChild(details);
      return SFAdvancedDisclosureUI.initAdvancedDisclosures();
    });
    await addDisclosure();
    const summary = popup.locator('details[data-advanced="e2e-rare-options"] > summary');
    assert(!(await popup.locator('details[data-advanced="e2e-rare-options"]').evaluate((d) => d.open)), 'the disclosure should start collapsed');
    await summary.scrollIntoViewIfNeeded();
    await summary.click();
    await popup.locator('details[data-advanced="e2e-rare-options"]').evaluate((d) => d.open || Promise.reject(new Error('click did not open it')));
    await popup.waitForTimeout(300);
    const stored = await popup.evaluate(() => chrome.storage.local.get('advancedSections'));
    assert(JSON.stringify(stored.advancedSections) === '{"e2e-rare-options":true}', `unexpected stored state: ${JSON.stringify(stored)}`);
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await popup.click('#settings-section-toggle');
    await addDisclosure();
    assert(await popup.locator('details[data-advanced="e2e-rare-options"]').evaluate((d) => d.open), 'an opened section should be open again after a reload');
    await popup.evaluate(() => {
      const other = SFAdvancedDisclosureUI.createAdvancedDisclosure('e2e-other-section');
      document.getElementById('settings-section-content').appendChild(other);
      return SFAdvancedDisclosureUI.initAdvancedDisclosures();
    });
    assert(!(await popup.locator('details[data-advanced="e2e-other-section"]').evaluate((d) => d.open)), 'another section must stay collapsed');
    await popup.locator('details[data-advanced="e2e-rare-options"]').scrollIntoViewIfNeeded();
    await popup.locator('#settings-section-content').screenshot({ path: path.join(__dirname, 'issue-396-advanced-disclosure.png') });
    console.log('advanced disclosure: remembered per section across a reload');

    console.log('OK — help popover works with mouse and keyboard at 280/320/400 px, and the Advanced disclosure remembers its state.');
  } catch (err) {
    const pages = browser.context.pages();
    const toast = await pages[pages.length - 1].locator('#error-toast-message').textContent().catch(() => null);
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
