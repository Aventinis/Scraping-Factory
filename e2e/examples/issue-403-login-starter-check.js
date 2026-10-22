// Issue #403: real-browser check of the "Login form" starter on the login-flow
// fixture (a demo login: nordlicht / Fjord2026!).
//   - the Browser actions section explains itself ("?" overview popover) and its
//     intro points at the starter;
//   - one click on "Login form" adds four role-named cards (user name, password,
//     login button, logged-in marker) with the variable names prefilled; picking the
//     four elements on the page is all that is left, and the hint goes away after;
//   - times are in seconds, the rare options are in a collapsed "Advanced";
//   - the REAL Generate logs in with the typed test values and scrapes the
//     dashboard value behind the login;
//   - German wording and no horizontal overflow at 280/320/400 px.
//
// Runs its own companion on port 5055, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-403-login-starter-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');
  const fixture = await startFixture('login-flow');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({ language: 'en', globalSettings: { includeDataPreview: true }, companionUrlOverride: 'http://localhost:5055' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);

    // 1) Overview popover + intro.
    await popup.click('#btn-engine-browser');
    const section = popup.locator('#browser-actions-section');
    assert(/typically a login/.test(await section.locator('.browser-actions-hint').first().textContent()), 'intro should mention a login');
    const helpBtn = section.locator('.row-label .help-btn');
    await helpBtn.click();
    const panel = popup.locator(`#${await helpBtn.getAttribute('aria-controls')}`);
    assert(/fill in the user name, fill in the password, click the login button/.test(await panel.locator('.help-popover-text').textContent()), 'overview text');
    await popup.keyboard.press('Escape');

    // 2) The starter: four cards, role-named, variables prefilled.
    await popup.click('#btn-add-login-flow');
    const cards = popup.locator('#browser-actions-list .browser-action-card');
    assert(await cards.count() === 4, 'the starter should add four cards');
    const titles = await cards.locator('.browser-action-header .row-label').allTextContents();
    assert(JSON.stringify(titles) === JSON.stringify(['Fill in the user name', 'Fill in the password', 'Click the login button', 'Wait until you are logged in']), `card titles: ${JSON.stringify(titles)}`);
    assert(await cards.nth(0).locator('.browser-action-env-name').inputValue() === 'SITE_USERNAME', 'user variable');
    assert(await cards.nth(1).locator('.browser-action-env-name').inputValue() === 'SITE_PASSWORD', 'password variable');
    assert(await cards.nth(3).locator('.browser-action-timeout').inputValue() === '10', 'wait defaults to 10 seconds');
    assert(await popup.locator('#login-flow-hint').isVisible(), 'the "click the four elements" hint should show');
    const pickLabels = await popup.locator('.btn-pick-action-selector').allTextContents();
    assert(pickLabels[0] === 'Select the user name field' && pickLabels[2] === 'Select the login button', `pick labels: ${JSON.stringify(pickLabels)}`);

    // 3) Advanced is collapsed and holds the click target; a scroll card keeps rounds visible.
    const clickAdvanced = cards.nth(2).locator('details.advanced-disclosure');
    assert(!(await clickAdvanced.evaluate((el) => el.open)), 'the click options should start collapsed');
    assert(!(await cards.nth(2).locator('.browser-action-click-target').isVisible()), 'the click target is hidden while collapsed');
    await popup.screenshot({ path: path.join(__dirname, 'issue-403-login-starter-cards.png'), fullPage: true });

    // 4) Pick the four elements on the page. The logged-in marker only exists after
    //    login, so show the dashboard for the pick and put the login form back after.
    const pick = async (index, selector) => {
      await popup.locator('.btn-pick-action-selector').nth(index).click();
      await focusFixture(fixturePage);
      await fixturePage.click(selector);
      await waitForIdleScreen(popup);
      await popup.waitForFunction((i) => {
        const el = document.querySelectorAll('#browser-actions-list .field-selector')[i];
        return el && !/No element/.test(el.textContent);
      }, index);
    };
    await pick(0, '#username');
    await pick(1, '#password');
    await pick(2, '#login-submit');
    await fixturePage.evaluate(() => {
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('dashboard-view').classList.remove('hidden');
    });
    await pick(3, '.welcome-title');
    // …and a data field from behind the login.
    await popup.click('#btn-add-field');
    await focusFixture(fixturePage);
    await fixturePage.click('.stat-value >> nth=0');
    await popup.waitForSelector('#modal-field-name:not(.hidden)');
    await popup.fill('#input-field-name', 'Kontostand');
    await popup.click('#btn-field-confirm');
    await waitForIdleScreen(popup);
    await fixturePage.reload(); // the login form again, as a script would meet it
    assert(!(await popup.locator('#login-flow-hint').isVisible()), 'the hint should be gone once all four elements are picked');
    const selectors = await popup.locator('#browser-actions-list .field-selector').allTextContents();
    assert(selectors.length === 4 && selectors.every((s) => s && !/No element/.test(s)), `all four elements should be picked: ${JSON.stringify(selectors)}`);

    // 5) Widths.
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 900 });
      const { widest, blockRight } = await popup.evaluate(() => {
        const block = document.getElementById('browser-actions-section');
        return {
          blockRight: block.getBoundingClientRect().right,
          widest: Math.max(...Array.from(block.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right)),
        };
      });
      if (widest > blockRight + 1) {
        const offenders = await popup.evaluate(() => {
          const block = document.getElementById('browser-actions-section');
          const right = block.getBoundingClientRect().right;
          return Array.from(block.querySelectorAll('*')).filter((el) => el.getBoundingClientRect().right > right + 1)
            .map((el) => `${el.tagName}.${el.className}`.slice(0, 80));
        });
        console.log('offenders:', offenders.slice(0, 8));
      }
      assert(widest <= blockRight + 1, `browser actions overflow at ${width}px (${widest} > ${blockRight})`);
    }
    await popup.setViewportSize({ width: 1280, height: 720 });

    // 6) Real Generate: log in with the typed test values, read the dashboard value.
    for (const [i, value] of [[0, 'nordlicht'], [1, 'Fjord2026!']]) {
      await popup.locator('.browser-action-test-value').nth(i).fill(value);
      await popup.locator('.browser-action-test-value').nth(i).blur(); // committed on change
    }
    await focusFixture(fixturePage);
    await popup.click('#btn-generate');
    await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
    const cells = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
    assert(cells.some((row) => row[0] === '2.348,17 €'), `the script should have logged in and scraped the balance, got ${JSON.stringify(cells)}`);
    console.log('the script logged in with the starter actions and read', JSON.stringify(cells[0]));
    await popup.click('#btn-back-to-config');
    await waitForIdleScreen(popup);

    // 7) German wording.
    await popup.evaluate(() => chrome.storage.local.set({ language: 'de' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    assert((await popup.locator('#btn-add-login-flow').textContent()) === '+ Login-Formular (4 Schritte)', 'German starter button');
    const deTitles = await popup.locator('#browser-actions-list .browser-action-header .row-label').allTextContents();
    assert(deTitles[0] === 'Benutzernamen eintragen', `German card title: ${deTitles[0]}`);
    console.log('OK — login starter end to end (English + German).');
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
